"""Operational resource pressure for the overview page.

The queries deliberately use standard Zabbix agent item-key prefixes so the
dashboard works across Linux and Windows templates without template IDs.
"""
import zbx
import time

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


RESOURCE_TERMS = (
    "cpu", "load", "memory", "memória", "memoria", "swap", "disk", "disco",
    "storage", "filesystem", "file system", "space", "inode", "interface",
    "network", "rede", "bandwidth", "latency", "packet loss",
)
AVAILABILITY_TERMS = (
    "unreachable", "unavailable", "not available", "host is down", "ping",
    "icmp", "availability", "disponibilidade", "link is down", "interface is down",
)


def _duration(clock) -> str:
    diff = max(0, int(time.time()) - int(clock or 0))
    days, rem = divmod(diff, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def _operational_status(trigger: dict, item: dict | None) -> str:
    text = f"{trigger.get('description', '')} {item.get('name', '') if item else ''}".lower()
    if str(trigger.get("state")) == "1" or (item and str(item.get("state")) == "1"):
        return "unknown"
    if item and int(item.get("lastclock") or 0) == 0:
        return "pending"
    if str(trigger.get("value")) == "0":
        return "up" if any(term in text for term in AVAILABILITY_TERMS) else "ok"
    if "unreachable" in text or "sem resposta" in text:
        return "unreachable"
    if any(term in text for term in ("host is down", "link is down", "interface is down", "offline")):
        return "down"
    return "critical" if int(trigger.get("priority") or 0) >= 4 else "warning"


def _item_status(item: dict) -> str:
    if str(item.get("state")) == "1":
        return "unknown"
    text = f"{item.get('name', '')} {item.get('key_', '')}".lower()
    return "up" if any(term in text for term in AVAILABILITY_TERMS) else "ok"


def _catalog_value(value, limit: int = 240) -> str:
    """Keep the catalogue payload small; the drawer fetches the full value."""
    text = "" if value is None else str(value)
    return text if len(text) <= limit else f"{text[:limit - 1]}…"


def get_monitored_resources(active_incidents: list[dict]) -> dict:
    """Return monitored items that have actually produced data.

    Items are the truthful equivalent of Centreon resources. Triggers enrich
    those items with problem state, but no trigger is required for an item to
    appear in the catalogue.
    """
    items = _safe_call(
        "item.get",
        {
            "output": ["itemid", "hostid", "name", "key_", "lastvalue", "lastclock", "units", "state", "value_type"],
            "monitored": True,
            "filter": {"status": 0},
            "selectHosts": ["hostid", "name"],
            "selectTags": "extend",
        },
    )
    items = [
        item for item in items
        if int(item.get("lastclock") or 0) > 0
        and item.get("lastvalue") not in (None, "")
        and (item.get("hosts") or [])
    ]
    triggers = _safe_call(
        "trigger.get",
        {
            "output": ["triggerid", "description", "value", "priority", "lastchange", "state", "error"],
            "monitored": True,
            "skipDependent": False,
            "expandDescription": True,
            "selectHosts": ["hostid", "name"],
            "selectItems": ["itemid", "name", "key_", "lastvalue", "lastclock", "units", "state", "value_type"],
            "selectTags": "extend",
            "sortfield": "priority",
            "sortorder": "DESC",
        },
    )
    hostids = sorted({str(item.get("hostid")) for item in items if item.get("hostid")})
    group_by_host = {}
    if hostids:
        hosts = _safe_call(
            "host.get",
            {"output": ["hostid"], "hostids": hostids, "selectHostGroups": ["name"]},
        )
        for host in hosts:
            groups = host.get("hostgroups") or []
            group_by_host[host["hostid"]] = groups[0]["name"] if groups else "—"

    incident_by_trigger = {
        str(incident.get("triggerid")): incident
        for incident in active_incidents if incident.get("triggerid")
    }
    trigger_by_item = {}
    for trigger in triggers:
        for index, trigger_item in enumerate(trigger.get("items") or []):
            itemid = str(trigger_item.get("itemid"))
            current = trigger_by_item.get(itemid)
            candidate = (trigger, index == 0)
            if current is None or str(trigger.get("value")) == "1":
                trigger_by_item[itemid] = candidate

    rows = []
    for item in items:
        host = (item.get("hosts") or [{}])[0]
        trigger, is_primary = trigger_by_item.get(str(item["itemid"]), (None, False))
        incident = incident_by_trigger.get(str(trigger["triggerid"])) if trigger and is_primary else None
        has_problem = bool(incident)
        status = _operational_status(trigger, item) if has_problem else _item_status(item)
        searchable = f"{item.get('name', '')} {item.get('key_', '')} {trigger.get('description', '') if trigger else ''}"
        is_capacity = any(term in searchable.lower() for term in RESOURCE_TERMS)
        clock = incident.get("clock") if incident else item.get("lastclock", 0)
        item_tags = item.get("tags") or []
        trigger_tags = trigger.get("tags") or [] if trigger else []
        tags = [tag.get("value") or tag.get("tag") for tag in item_tags + trigger_tags]
        rows.append(
            {
                "resource_id": f"item:{item['itemid']}",
                "itemid": str(item["itemid"]),
                "triggerid": str(trigger["triggerid"]) if has_problem else None,
                "eventid": incident.get("eventid") if incident else None,
                "hostid": host.get("hostid"),
                "host_name": host.get("name", "—"),
                "group_name": group_by_host.get(host.get("hostid"), "—"),
                "name": item.get("name", "—"),
                "problem_name": trigger.get("description", "") if has_problem else "",
                "status_name": status,
                "has_problem": has_problem,
                "severity": int(trigger.get("priority") or 0) if has_problem else 0,
                "severity_name": incident.get("severity_name") if incident else "not_classified",
                "acknowledged": incident.get("acknowledged", False) if incident else False,
                "clock": str(clock or 0),
                "duration": _duration(clock),
                "lastvalue": _catalog_value(item.get("lastvalue")),
                "units": item.get("units", ""),
                "item_name": item.get("name", ""),
                "item_key": item.get("key_", ""),
                "tags": list(dict.fromkeys(tag for tag in tags if tag)),
                "is_resource_problem": bool(incident) and is_capacity,
            }
        )
    status_counts = {name: 0 for name in ("ok", "up", "warning", "down", "critical", "unreachable", "unknown", "pending")}
    for row in rows:
        status_counts[row["status_name"]] += 1
    return {"resources": rows, "status_counts": status_counts}


def _item_history(item: dict, hours: int) -> list[dict]:
    raw = zbx.call(
        "history.get",
        {"output": "extend", "history": int(item.get("value_type", 0)), "itemids": [item["itemid"]], "time_from": int(time.time()) - hours * 3600, "sortfield": "clock", "sortorder": "ASC", "limit": 600},
    )
    history = []
    for point in raw:
        try:
            history.append({"clock": int(point["clock"]), "value": float(point["value"])})
        except (KeyError, TypeError, ValueError):
            continue
    return history


def get_item_details(itemid: str, hours: int = 24) -> dict:
    hours = max(1, min(int(hours), 24 * 31))
    found = zbx.call(
        "item.get",
        {
            "output": ["itemid", "hostid", "name", "key_", "lastvalue", "lastclock", "units", "state", "value_type"],
            "itemids": [itemid],
            "selectHosts": ["hostid", "name"],
            "selectTags": "extend",
        },
    )
    if not found:
        raise ValueError("Recurso não encontrado")
    item = found[0]
    host = (item.get("hosts") or [{}])[0]
    status = _item_status(item)
    clock = int(item.get("lastclock") or 0)
    return {
        "eventid": None,
        "triggerid": None,
        "name": item.get("name", "—"),
        "severity": 0,
        "severity_name": status,
        "status_name": status,
        "acknowledged": False,
        "clock": clock,
        "duration": _duration(clock),
        "hostid": host.get("hostid") or item.get("hostid"),
        "host_name": host.get("name", "—"),
        "tags": item.get("tags") or [],
        "trigger": None,
        "item": {"itemid": item.get("itemid"), "name": item.get("name"), "key": item.get("key_"), "lastvalue": item.get("lastvalue"), "units": item.get("units", "")},
        "timeline": [{"clock": clock, "type": "normal", "user": "Zabbix", "message": "Último valor coletado"}],
        "history": _item_history(item, hours),
        "period_hours": hours,
    }


def get_trigger_details(triggerid: str, hours: int = 24) -> dict:
    hours = max(1, min(int(hours), 24 * 31))
    triggers = zbx.call(
        "trigger.get",
        {
            "output": ["triggerid", "description", "expression", "priority", "lastchange", "comments", "opdata", "value", "state"],
            "triggerids": [triggerid],
            "expandDescription": True,
            "selectHosts": ["hostid", "name"],
            "selectItems": ["itemid", "name", "key_", "lastvalue", "units", "value_type", "lastclock", "state"],
            "selectTags": "extend",
        },
    )
    if not triggers:
        raise ValueError("Recurso não encontrado")
    trigger = triggers[0]
    host = (trigger.get("hosts") or [{}])[0]
    item = (trigger.get("items") or [None])[0]
    history = []
    if item:
        raw = zbx.call(
            "history.get",
            {"output": "extend", "history": int(item.get("value_type", 0)), "itemids": [item["itemid"]], "time_from": int(time.time()) - hours * 3600, "sortfield": "clock", "sortorder": "ASC", "limit": 600},
        )
        for point in raw:
            try:
                history.append({"clock": int(point["clock"]), "value": float(point["value"])})
            except (KeyError, TypeError, ValueError):
                continue
    status = _operational_status(trigger, item)
    return {
        "eventid": None,
        "triggerid": triggerid,
        "name": trigger.get("description", "—"),
        "severity": int(trigger.get("priority", 0)),
        "severity_name": status,
        "status_name": status,
        "acknowledged": False,
        "clock": int(trigger.get("lastchange", 0)),
        "duration": _duration(trigger.get("lastchange", 0)),
        "hostid": host.get("hostid"),
        "host_name": host.get("name", "—"),
        "tags": trigger.get("tags") or [],
        "trigger": {"id": triggerid, "expression": trigger.get("expression", "—"), "comments": trigger.get("comments", ""), "operational_data": trigger.get("opdata", "")},
        "item": ({"itemid": item.get("itemid"), "name": item.get("name"), "key": item.get("key_"), "lastvalue": item.get("lastvalue"), "units": item.get("units", "")} if item else None),
        "timeline": [{"clock": int(trigger.get("lastchange", 0)), "type": "normal", "user": "Zabbix", "message": f"Estado atual: {status.upper()}"}],
        "history": history,
        "period_hours": hours,
    }
