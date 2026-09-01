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
            "sortfield": "lastvalue",
            "sortorder": "DESC",
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
    return sorted(rows, key=lambda row: row["value"], reverse=True)[:LIMIT_PER_RESOURCE]


def _top_memory() -> list[dict]:
    rows_by_host = {}
    for item in _resource_items("vm.memory"):
        key = item.get("key_", "")
        value = _number(item.get("lastvalue"))
        if value is None:
            continue
        if key == "vm.memory.utilization":
            used = value
        elif "pavailable" in key:
            used = 100.0 - value
        else:
            continue
        rows_by_host[item.get("hostid")] = _row(item, used)
    return sorted(rows_by_host.values(), key=lambda row: row["value"], reverse=True)[:LIMIT_PER_RESOURCE]


def _top_disk() -> list[dict]:
    rows_by_host = {}
    for item in _resource_items("vfs.fs.size["):
        key = item.get("key_", "")
        if ",pused]" not in key:
            continue
        value = _number(item.get("lastvalue"))
        if value is None:
            continue
        mount = key[len("vfs.fs.size[") : key.rfind(",pused]")]
        row = _row(item, value, mount)
        current = rows_by_host.get(item.get("hostid"))
        if current is None or row["value"] > current["value"]:
            rows_by_host[item.get("hostid")] = row
    return sorted(rows_by_host.values(), key=lambda row: row["value"], reverse=True)[:LIMIT_PER_RESOURCE]


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
    cpu = _top_cpu()
    memory = _top_memory()
    disk = _top_disk()
    down = _down_hosts()
    return {
        "cpu": cpu,
        "memory": memory,
        "disk": disk,
        "down_hosts": down[:LIMIT_PER_RESOURCE],
        "counts": {
            "cpu": sum(row["value"] >= CRITICAL_THRESHOLD for row in cpu),
            "memory": sum(row["value"] >= CRITICAL_THRESHOLD for row in memory),
            "disk": sum(row["value"] >= CRITICAL_THRESHOLD for row in disk),
            "down": len(down),
        },
        "threshold": CRITICAL_THRESHOLD,
    }
