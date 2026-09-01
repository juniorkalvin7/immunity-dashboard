"""Sophos firewall fleet: SNMP health, IPsec tunnels, SSL VPN live users."""
import json
import re
import time

import zbx

TEMPLATE_ID = "10835"  # IMMUNITY Sophos Firewall SNMP

ITEM_KEYS = [
    "sfos.device.name",
    "sfos.device.model",
    "sfos.device.firmware",
    "sfos.system.uptime",
    "sfos.memory.used.percent",
    "sfos.storage.used.percent",
    "sfos.swap.used.percent",
    "sfos.ipsec.total.up",
    "sfos.ipsec.total.down",
    "sfos.sslvpn.users",
]

SSLVPN_RAW_PREFIX = "sophos_webadmin_sslvpn.py"
EXTERNAL_CHECK_TYPE = 10
IPSEC_TUNNEL_RE = re.compile(r"ipsec tunnel\s+(.+?)\s+is down", re.IGNORECASE)


def _fmt_uptime(seconds) -> str:
    seconds = int(seconds or 0)
    if not seconds:
        return "—"
    days, rem = divmod(seconds, 86400)
    hours, _ = divmod(rem, 3600)
    if days:
        return f"{days}d {hours}h"
    minutes = (rem % 3600) // 60
    return f"{hours}h {minutes}m"


def get_hosts() -> list[dict]:
    return zbx.call(
        "host.get",
        {"output": ["hostid", "host", "name"], "templateids": [TEMPLATE_ID], "sortfield": "name"},
    )


def get_fleet(hosts: list[dict]) -> list[dict]:
    """One row per firewall: identity + IPsec/SSL VPN/resource metrics."""
    hostids = [h["hostid"] for h in hosts]
    if not hostids:
        return []

    items = zbx.call(
        "item.get",
        {
            "output": ["hostid", "key_", "lastvalue"],
            "hostids": hostids,
            "filter": {"key_": ITEM_KEYS},
        },
    )
    by_host: dict[str, dict] = {}
    for it in items:
        by_host.setdefault(it["hostid"], {})[it["key_"]] = it["lastvalue"]

    fleet = []
    for h in hosts:
        m = by_host.get(h["hostid"], {})
        fleet.append(
            {
                "hostid": h["hostid"],
                "name": m.get("sfos.device.name") or h["name"],
                "model": m.get("sfos.device.model") or "—",
                "firmware": m.get("sfos.device.firmware") or "—",
                "uptime": _fmt_uptime(m.get("sfos.system.uptime")),
                "memory_pct": _to_int(m.get("sfos.memory.used.percent")),
                "disk_pct": _to_int(m.get("sfos.storage.used.percent")),
                "swap_pct": _to_int(m.get("sfos.swap.used.percent")),
                "ipsec_up": _to_int(m.get("sfos.ipsec.total.up")),
                "ipsec_down": _to_int(m.get("sfos.ipsec.total.down")),
                "sslvpn_users": _to_int(m.get("sfos.sslvpn.users")),
            }
        )
    return fleet


def _to_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def get_sslvpn_sessions(hosts: list[dict]) -> list[dict]:
    """Flat list of every connected SSL VPN user across all firewalls."""
    hostids = [h["hostid"] for h in hosts]
    if not hostids:
        return []
    host_name = {h["hostid"]: h["name"] for h in hosts}

    items = zbx.call(
        "item.get",
        {
            "output": ["hostid", "key_", "lastvalue"],
            "hostids": hostids,
            # Zabbix's "search" param on key_ has been unreliable in practice
            # (silently returns nothing) - filter by item type instead and
            # match the key prefix ourselves.
            "filter": {"type": EXTERNAL_CHECK_TYPE},
        },
    )

    sessions = []
    for it in items:
        if not it["key_"].startswith(SSLVPN_RAW_PREFIX):
            continue
        try:
            payload = json.loads(it["lastvalue"])
        except (ValueError, TypeError):
            continue
        if not payload.get("ok") or not isinstance(payload.get("users"), list):
            continue
        for user in payload["users"]:
            sessions.append({"host_name": host_name.get(it["hostid"], "—"), **user})
    return sessions


def get_ipsec_tunnels(hosts: list[dict]) -> list[dict]:
    """Return every named IPsec tunnel trigger, including healthy tunnels."""
    hostids = [host["hostid"] for host in hosts]
    if not hostids:
        return []
    triggers = zbx.call(
        "trigger.get",
        {
            "output": ["triggerid", "description", "value", "priority", "lastchange", "state"],
            "hostids": hostids,
            "monitored": True,
            "skipDependent": False,
            "expandDescription": True,
            "selectHosts": ["hostid", "name"],
        },
    )
    tunnels = []
    for trigger in triggers:
        match = IPSEC_TUNNEL_RE.search(trigger.get("description", ""))
        if not match:
            continue
        trigger_hosts = trigger.get("hosts") or []
        if not trigger_hosts:
            continue
        status = "unknown" if str(trigger.get("state")) == "1" else ("down" if str(trigger.get("value")) == "1" else "up")
        changed = int(trigger.get("lastchange") or 0)
        tunnels.append(
            {
                "triggerid": str(trigger["triggerid"]),
                "hostid": trigger_hosts[0].get("hostid"),
                "host_name": trigger_hosts[0].get("name", "—"),
                "tunnel_name": match.group(1).strip(),
                "status": status,
                "lastchange": changed,
                "duration": _fmt_uptime(max(0, int(time.time()) - changed)) if changed else "—",
            }
        )
    return sorted(tunnels, key=lambda row: (row["status"] != "down", row["host_name"], row["tunnel_name"]))


def get_firewall_problems(hosts: list[dict]) -> list[dict]:
    hostids = [h["hostid"] for h in hosts]
    if not hostids:
        return []
    host_name = {h["hostid"]: h["name"] for h in hosts}

    problems = zbx.call(
        "problem.get",
        {"output": "extend", "hostids": hostids, "sortfield": ["eventid"], "sortorder": "DESC"},
    )
    if not problems:
        return []

    eventids = [p["eventid"] for p in problems]
    events = zbx.call("event.get", {"output": ["eventid"], "eventids": eventids, "selectHosts": ["hostid"]})
    host_by_event = {e["eventid"]: (e["hosts"][0]["hostid"] if e["hosts"] else None) for e in events}

    from .incidents import _severity_name  # reuse the same severity naming

    result = []
    for p in problems:
        hostid = host_by_event.get(p["eventid"])
        result.append(
            {
                "eventid": p["eventid"],
                "name": p["name"],
                "severity": int(p["severity"]),
                "severity_name": _severity_name(p["severity"]),
                "since": time.strftime("%d/%m/%Y %H:%M", time.localtime(int(p["clock"]))),
                "host_name": host_name.get(hostid, "—"),
            }
        )
    return result


def get_summary(fleet: list[dict]) -> dict:
    return {
        "count": len(fleet),
        "ipsec_up": sum(f["ipsec_up"] or 0 for f in fleet),
        "ipsec_down": sum(f["ipsec_down"] or 0 for f in fleet),
        "sslvpn_users": sum(f["sslvpn_users"] or 0 for f in fleet),
    }
