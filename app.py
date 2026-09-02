"""Antigen Netviso operations dashboard.

Server-rendered (Jinja2) pages for a fast first paint, plus small JSON
endpoints under /api/* that the page JS polls for live refresh. The Zabbix
API token stays server-side in zbx.py - the browser only ever talks to this
app, never to Zabbix directly.
"""
import json

from flask import Flask, jsonify, redirect, render_template, request, url_for

from services import firewalls, incidents, resources

app = Flask(__name__)


def _safe_embed_json(data: dict) -> str:
    """JSON for embedding inside a <script> tag - escapes "</" so a value
    containing e.g. a literal "</script>" can't break out of the tag."""
    return json.dumps(data).replace("</", "<\\/")


@app.route("/")
def index():
    return redirect(url_for("home_page"))


@app.route("/home")
def home_page():
    overview_data = _overview_data()
    incident_data = _incidentes_data()
    return render_template(
        "home.html",
        active_page="home",
        overview_json=_safe_embed_json(overview_data),
        incidentes_json=_safe_embed_json(incident_data),
    )


@app.route("/overview")
def overview_page():
    return redirect(url_for("home_page"))


@app.route("/incidentes")
def incidentes_page():
    return redirect(url_for("home_page", _anchor="incidents"))


@app.route("/recursos")
def recursos_page():
    data = _recursos_data()
    return render_template(
        "recursos.html", active_page="recursos", initial_json=_safe_embed_json(data)
    )


@app.route("/vpn-users")
def vpn_users_page():
    data = _firewalls_data()
    return render_template("vpn_users.html", active_page="vpn_users", **data)


@app.route("/vpn-ipsec")
def vpn_ipsec_page():
    data = _firewalls_data()
    data["ipsec_problems"] = [
        problem for problem in data["problems"]
        if any(term in problem.get("name", "").lower() for term in ("ipsec", "tunnel", "vpn"))
    ]
    return render_template("vpn_ipsec.html", active_page="vpn_ipsec", **data)


@app.route("/firewalls")
def firewalls_page():
    return redirect(url_for("vpn_ipsec_page"))


@app.route("/api/incidentes")
def api_incidentes():
    return jsonify(_incidentes_data())


@app.route("/api/recursos")
def api_recursos():
    return jsonify(_recursos_data())


@app.route("/api/overview")
def api_overview():
    return jsonify(_overview_data())


@app.route("/api/statusbar")
def api_statusbar():
    incident_list = incidents.get_incidents()
    summary = incidents.get_summary(incident_list)
    health = incidents.get_environment_health(incident_list)
    availability = resources.get_global_availability()
    service_problems = summary["total"]
    return jsonify(
        {
            "hosts": {
                "down": availability["down_hosts"],
                "alert": health["hosts_with_problems"],
                "ok": health["healthy_hosts"],
            },
            "services": {
                "critical": summary["by_severity"]["disaster"] + summary["by_severity"]["high"],
                "average": summary["by_severity"]["average"],
                "warning": summary["by_severity"]["warning"],
                "ok": max(0, availability["monitored_items"] - service_problems),
            },
        }
    )


@app.route("/api/firewalls")
def api_firewalls():
    return jsonify(_firewalls_data())


@app.route("/api/incidentes/<eventid>/ack", methods=["POST"])
def api_ack_incidente(eventid):
    message = (request.get_json(silent=True) or {}).get("message", "")
    try:
        incidents.acknowledge(eventid, message)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as-is
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True})


@app.route("/api/incidentes/<eventid>/unack", methods=["POST"])
def api_unack_incidente(eventid):
    message = (request.get_json(silent=True) or {}).get("message", "")
    try:
        incidents.unacknowledge_many([eventid], message)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as-is
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True})


@app.route("/api/recursos/<eventid>/details")
def api_recurso_details(eventid):
    try:
        return jsonify(incidents.get_event_details(eventid, request.args.get("hours", 24)))
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 502


@app.route("/api/recursos/trigger/<triggerid>/details")
def api_recurso_trigger_details(triggerid):
    eventid = request.args.get("eventid")
    try:
        if eventid:
            detail = incidents.get_event_details(eventid, request.args.get("hours", 24))
        else:
            detail = resources.get_trigger_details(triggerid, request.args.get("hours", 24))
        detail["maintenances"] = incidents.get_host_maintenances(detail.get("hostid"))
        return jsonify(detail)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 502


@app.route("/api/recursos/item/<itemid>/details")
def api_recurso_item_details(itemid):
    try:
        detail = resources.get_item_details(itemid, request.args.get("hours", 24))
        detail["maintenances"] = incidents.get_host_maintenances(detail.get("hostid"))
        return jsonify(detail)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 502


@app.route("/api/recursos/ack", methods=["POST"])
def api_recursos_ack():
    payload = request.get_json(silent=True) or {}
    try:
        incidents.acknowledge_many(payload.get("eventids") or [], payload.get("message", ""))
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True})


@app.route("/api/recursos/unack", methods=["POST"])
def api_recursos_unack():
    payload = request.get_json(silent=True) or {}
    try:
        incidents.unacknowledge_many(payload.get("eventids") or [], payload.get("message", ""))
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True})


@app.route("/api/recursos/maintenance", methods=["POST"])
def api_recursos_maintenance():
    payload = request.get_json(silent=True) or {}
    try:
        result = incidents.schedule_maintenance(
            payload.get("hostids") or [], payload.get("minutes", 60),
            payload.get("name", "Manutenção ANTIGEN"), payload.get("description", ""),
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True, "result": result})


@app.route("/api/recursos/maintenance/remove", methods=["POST"])
def api_recursos_remove_maintenance():
    payload = request.get_json(silent=True) or {}
    try:
        incidents.remove_maintenances(payload.get("maintenanceids") or [])
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True})


def _incidentes_data() -> dict:
    incident_list = incidents.get_incidents()
    groups = sorted({inc["group_name"] for inc in incident_list if inc["group_name"] != "—"})
    return {
        "incidents": incident_list,
        "summary": incidents.get_summary(incident_list),
        "groups": groups,
        "trend_24h": incidents.get_new_last_24h(),
        "health": incidents.get_environment_health(incident_list),
        "top_critical": incidents.get_top_critical(incident_list),
    }


def _recursos_data() -> dict:
    records = incidents.get_incidents()
    catalog = resources.get_monitored_resources(records)
    enriched = catalog["resources"]
    return {
        "resources": enriched,
        "groups": sorted({row["group_name"] for row in enriched if row["group_name"] != "—"}),
        "status_counts": catalog["status_counts"],
        "summary": {
            "total": len(enriched),
            "active": sum(row["has_problem"] for row in enriched),
            "unhandled": sum(row["has_problem"] and not row["acknowledged"] for row in enriched),
            "resource_problems": sum(row["is_resource_problem"] for row in enriched),
            "critical": sum(row["status_name"] in ("critical", "down", "unreachable") for row in enriched),
        },
    }


def _firewalls_data() -> dict:
    hosts = firewalls.get_hosts()
    fleet = firewalls.get_fleet(hosts)
    return {
        "fleet": fleet,
        "summary": firewalls.get_summary(fleet),
        "sslvpn_sessions": firewalls.get_sslvpn_sessions(hosts),
        "ipsec_tunnels": firewalls.get_ipsec_tunnels(hosts),
        "problems": firewalls.get_firewall_problems(hosts),
    }


def _overview_data() -> dict:
    incident_list = incidents.get_incidents()
    incident_summary = incidents.get_summary(incident_list)
    health = incidents.get_environment_health(incident_list)
    hosts = firewalls.get_hosts()
    fleet = firewalls.get_fleet(hosts)
    firewall_summary = firewalls.get_summary(fleet)

    group_counts = {}
    for incident in incident_list:
        group = incident.get("group_name") or "—"
        group_counts[group] = group_counts.get(group, 0) + 1

    critical = sorted(
        [incident for incident in incident_list if incident["severity"] >= 4],
        key=lambda incident: (-incident["severity"], int(incident["clock"])),
    )[:6]

    return {
        "incidents": incident_list,
        "summary": incident_summary,
        "health": health,
        "firewalls": firewall_summary,
        "critical": critical,
        "top_groups": [
            {"name": name, "count": count}
            for name, count in sorted(group_counts.items(), key=lambda item: (-item[1], item[0]))[:5]
        ],
        "resources": resources.get_resource_pressure(),
    }


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
