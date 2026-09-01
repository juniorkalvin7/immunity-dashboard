"""Global incidents (problems) across every host Zabbix monitors."""
import time

import zbx

SEVERITY_NAMES = ["not_classified", "information", "warning", "average", "high", "disaster"]


def _severity_name(severity) -> str:
    try:
        return SEVERITY_NAMES[int(severity)]
    except (ValueError, IndexError):
        return "information"


def _duration(clock) -> str:
    diff = max(0, int(time.time()) - int(clock))
    days, rem = divmod(diff, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def get_incidents() -> list[dict]:
    """All active problems, across all hosts, newest first."""
    problems = zbx.call(
        "problem.get",
        {"output": "extend", "selectTags": "extend", "sortfield": ["eventid"], "sortorder": "DESC"},
    )
    if not problems:
        return []

    eventids = [p["eventid"] for p in problems]
    events = zbx.call(
        "event.get",
        {"output": ["eventid"], "eventids": eventids, "selectHosts": ["hostid", "name"]},
    )
    host_by_event = {e["eventid"]: (e["hosts"][0] if e["hosts"] else None) for e in events}

    hostids = list({h["hostid"] for e in events for h in e["hosts"]})
    group_by_host = {}
    if hostids:
        hosts = zbx.call(
            "host.get",
            {"output": ["hostid"], "hostids": hostids, "selectHostGroups": ["name"]},
        )
        for h in hosts:
            groups = h.get("hostgroups") or []
            group_by_host[h["hostid"]] = groups[0]["name"] if groups else "—"

    incidents = []
    for p in problems:
        host = host_by_event.get(p["eventid"])
        incidents.append(
            {
                "eventid": p["eventid"],
                "name": p["name"],
                "severity": int(p["severity"]),
                "severity_name": _severity_name(p["severity"]),
                "acknowledged": p["acknowledged"] == "1",
                "clock": p["clock"],
                "duration": _duration(p["clock"]),
                "hostid": host["hostid"] if host else None,
                "host_name": host["name"] if host else "—",
                "group_name": group_by_host.get(host["hostid"], "—") if host else "—",
                "tags": [t["value"] or t["tag"] for t in (p.get("tags") or [])],
            }
        )
    return incidents


def acknowledge(eventid: str, message: str = "") -> None:
    """Acknowledge a single event. action=2 -> "acknowledge event" per the
    Zabbix API's event.acknowledge bitmask (1=close, 2=ack, 4=add message,
    8=change severity, 16=unack)."""
    action = 2
    params = {"eventids": [eventid], "action": action}
    if message:
        params["message"] = message
        params["action"] = action | 4
    zbx.call("event.acknowledge", params)


def get_summary(incidents: list[dict]) -> dict:
    by_sev = {name: 0 for name in SEVERITY_NAMES}
    unacknowledged = 0
    for inc in incidents:
        by_sev[inc["severity_name"]] += 1
        if not inc["acknowledged"]:
            unacknowledged += 1
    return {
        "total": len(incidents),
        "by_severity": by_sev,
        "unacknowledged": unacknowledged,
    }


def get_new_last_24h() -> dict:
    """How many NEW problems (of each severity) opened in the last 24h.

    This is a real, honestly-labelled number - Zabbix doesn't keep a stored
    snapshot of "counts 24h ago" to diff against, so rather than fake a
    point-in-time comparison this counts actual problem-open events
    (source=trigger, object=trigger, value=PROBLEM) in the last 24h.
    """
    since = int(time.time()) - 86400
    events = zbx.call(
        "event.get",
        {"output": ["eventid", "severity"], "time_from": since, "value": 1, "source": 0, "object": 0},
    )
    by_sev = {name: 0 for name in SEVERITY_NAMES}
    for e in events:
        by_sev[_severity_name(e["severity"])] += 1
    return by_sev


def get_environment_health(incidents: list[dict]) -> dict:
    """"Healthy" here means "currently has zero active problems" - a host
    with an unrelated warning still counts as not-healthy, which is a
    stricter (and honestly computable) bar than an ICMP-style up/down flag
    that most of these hosts aren't even polled for."""
    all_hosts = zbx.call("host.get", {"output": ["hostid"], "filter": {"status": 0}})
    total = len(all_hosts)
    hosts_with_problems = {inc["hostid"] for inc in incidents if inc["hostid"]}
    with_problems = len(hosts_with_problems)
    healthy = max(0, total - with_problems)
    return {
        "total_hosts": total,
        "healthy_hosts": healthy,
        "hosts_with_problems": with_problems,
        "health_pct": round(healthy / total * 100, 1) if total else 0.0,
    }


def get_top_critical(incidents: list[dict]) -> dict | None:
    """The single most urgent unacknowledged incident, for the alert banner.
    Highest severity first, then oldest (longest-running) first."""
    candidates = [i for i in incidents if not i["acknowledged"] and i["severity"] >= 4]
    if not candidates:
        return None
    return sorted(candidates, key=lambda i: (-i["severity"], int(i["clock"])))[0]
