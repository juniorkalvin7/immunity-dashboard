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
    return redirect(url_for("overview_page"))


@app.route("/overview")
def overview_page():
    data = _overview_data()
    return render_template(
        "overview.html", active_page="overview", initial_json=_safe_embed_json(data)
    )


@app.route("/incidentes")
def incidentes_page():
    data = _incidentes_data()
    return render_template(
        "incidentes.html", active_page="incidentes", initial_json=_safe_embed_json(data)
    )


@app.route("/recursos")
def recursos_page():
    data = _recursos_data()
    return render_template(
        "recursos.html", active_page="recursos", initial_json=_safe_embed_json(data)
    )


@app.route("/firewalls")
def firewalls_page():
    data = _firewalls_data()
    return render_template("firewalls.html", active_page="firewalls", **data)


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
    resource_terms = (
        "cpu", "memory", "memória", "memoria", "disk", "disco", "storage",
        "filesystem", "file system", "swap", "load", "interface", "port",
        "vpn", "ipsec", "service", "serviço", "servico", "unreachable",
        "offline", "not running", "down",
    )

    enriched = []
    for record in records:
        searchable = " ".join(
            [record.get("name", ""), record.get("host_name", ""), *(record.get("tags") or [])]
        ).lower()
        enriched.append(
            {
                **record,
                "is_resource_problem": any(term in searchable for term in resource_terms),
            }
        )

    return {
        "resources": enriched,
        "groups": sorted({row["group_name"] for row in enriched if row["group_name"] != "—"}),
        "summary": {
            "total": len(enriched),
            "unhandled": sum(not row["acknowledged"] for row in enriched),
            "resource_problems": sum(row["is_resource_problem"] for row in enriched),
            "critical": sum(row["severity"] >= 4 for row in enriched),
        },
    }


def _firewalls_data() -> dict:
    hosts = firewalls.get_hosts()
    fleet = firewalls.get_fleet(hosts)
    return {
        "fleet": fleet,
        "summary": firewalls.get_summary(fleet),
        "sslvpn_sessions": firewalls.get_sslvpn_sessions(hosts),
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
