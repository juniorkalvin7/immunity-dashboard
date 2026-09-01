"""Operational resource pressure for the overview page.

The queries deliberately use standard Zabbix agent item-key prefixes so the
dashboard works across Linux and Windows templates without template IDs.
"""
import zbx

CRITICAL_THRESHOLD = 85.0
LIMIT_PER_RESOURCE = 7


def _safe_call(method: str, params: dict) -> list:
    try:
        return zbx.call(method, params)
    except Exception:  # a missing resource metric must not break the dashboard
        return []


def _number(value):
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def _resource_items(prefix: str) -> list[dict]:
    return _safe_call(
        "item.get",
        {
            "output": ["itemid", "hostid", "name", "key_", "lastvalue", "lastclock", "units"],
            "search": {"key_": prefix},
            "startSearch": True,
            "searchWildcardsEnabled": True,
            "filter": {"status": 0, "state": 0},
            "selectHosts": ["hostid", "name"],
        },
    )


def _percent_items() -> list[dict]:
    """All live percentage items from monitored hosts.

    Filtering by unit/monitoring state is much more reliable than Zabbix's
    server-side key search across heterogeneous agent, SNMP and VMware
    templates. Classification happens locally below.
    """
    return _safe_call(
        "item.get",
        {
            "output": ["itemid", "hostid", "name", "key_", "lastvalue", "lastclock", "units"],
            "filter": {"status": 0, "state": 0, "units": "%"},
            "monitored": True,
            "selectHosts": ["hostid", "name"],
        },
    )


def _row(item: dict, value: float, detail: str = "") -> dict:
    hosts = item.get("hosts") or []
    return {
        "hostid": item.get("hostid"),
        "host_name": hosts[0].get("name", "—") if hosts else "—",
        "value": max(0.0, min(100.0, value)),
        "detail": detail,
    }


def _top_cpu() -> list[dict]:
    rows = []
    seen = set()
    for item in _resource_items("system.cpu.util"):
        key = item.get("key_", "")
        # Prefer the common total CPU item; skip individual cores/states.
        if key not in ("system.cpu.util", "system.cpu.util[,user]", "system.cpu.util[,system]"):
            continue
        hostid = item.get("hostid")
        if hostid in seen:
            continue
        value = _number(item.get("lastvalue"))
        if value is None:
            continue
        seen.add(hostid)
        rows.append(_row(item, value))
    return sorted(rows, key=lambda row: row["value"], reverse=True)


def _top_memory(percent_items: list[dict]) -> list[dict]:
    rows_by_host = {}
    for item in percent_items:
        key = item.get("key_", "").lower()
        name = item.get("name", "").lower()
        is_memory = (
            (key.startswith("vm.memory") and any(token in key for token in ("util", "pused", "usage")))
            or "memory utilization" in name
            or "memory usage" in name
            or "utilização de memória" in name
            or "uso de memória" in name
        )
        if not is_memory or any(token in key for token in ("swap", "cache", "heap")):
            continue
        value = _number(item.get("lastvalue"))
        if value is None:
            continue
        used = 100.0 - value if "pavailable" in key or "available" in name else value
        rows_by_host[item.get("hostid")] = _row(item, used)
    return sorted(rows_by_host.values(), key=lambda row: row["value"], reverse=True)


def _top_disk(percent_items: list[dict]) -> list[dict]:
    rows_by_host = {}
    for item in percent_items:
        key = item.get("key_", "").lower()
        name = item.get("name", "").lower()
        is_disk = (
            ("vfs.fs" in key and "pused" in key)
            or "space utilization" in name
            or "filesystem utilization" in name
            or "file system utilization" in name
            or "utilização de disco" in name
            or "uso de espaço" in name
        )
        is_performance_counter = any(
            token in f"{key} {name}"
            for token in ("perf_counter", "physicaldisk", "idle time", "disk busy", "disk activity")
        )
        if not is_disk or is_performance_counter or "inode" in key or "inode" in name:
            continue
        value = _number(item.get("lastvalue"))
        if value is None:
            continue
        open_bracket = key.find("[")
        comma = key.rfind(",")
        mount = key[open_bracket + 1 : comma] if open_bracket >= 0 and comma > open_bracket else item.get("name", "")
        row = _row(item, value, mount)
        current = rows_by_host.get(item.get("hostid"))
        if current is None or row["value"] > current["value"]:
            rows_by_host[item.get("hostid")] = row
    return sorted(rows_by_host.values(), key=lambda row: row["value"], reverse=True)


def _down_hosts() -> list[dict]:
    hosts = _safe_call(
        "host.get",
        {
            "output": ["hostid", "name", "active_available", "error"],
            "filter": {"status": 0},
            "selectInterfaces": ["available", "error", "ip", "type", "main"],
        },
    )
    result = []
    for host in hosts:
        interfaces = host.get("interfaces") or []
        failed = [interface for interface in interfaces if str(interface.get("available")) == "2"]
        interface_down = bool(interfaces) and len(failed) == len(interfaces)
        active_down = str(host.get("active_available")) == "2"
        if not interface_down and not active_down:
            continue
        error = host.get("error") or next((interface.get("error") for interface in failed if interface.get("error")), "Sem resposta")
        result.append({"hostid": host["hostid"], "host_name": host["name"], "error": error})
    return result


def get_resource_pressure() -> dict:
    percent_items = _percent_items()
    cpu = _top_cpu()
    memory = _top_memory(percent_items)
    disk = _top_disk(percent_items)
    down = _down_hosts()
    return {
        "cpu": cpu[:LIMIT_PER_RESOURCE],
        "memory": memory[:LIMIT_PER_RESOURCE],
        "disk": disk[:LIMIT_PER_RESOURCE],
        "down_hosts": down[:LIMIT_PER_RESOURCE],
        "counts": {
            "cpu": sum(row["value"] >= CRITICAL_THRESHOLD for row in cpu),
            "memory": sum(row["value"] >= CRITICAL_THRESHOLD for row in memory),
            "disk": sum(row["value"] >= CRITICAL_THRESHOLD for row in disk),
            "down": len(down),
        },
        "threshold": CRITICAL_THRESHOLD,
    }


def get_global_availability() -> dict:
    """Small, cheap counters used by the global operations strip."""
    count = _safe_call(
        "item.get",
        {"countOutput": True, "monitored": True, "filter": {"status": 0}},
    )
    try:
        monitored_items = int(count)
    except (TypeError, ValueError):
        monitored_items = 0
    return {
        "down_hosts": len(_down_hosts()),
        "monitored_items": monitored_items,
    }
