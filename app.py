"""Antigen Netviso operations dashboard.

Server-rendered (Jinja2) pages for a fast first paint, plus small JSON
endpoints under /api/* that the page JS polls for live refresh. The Zabbix
API token stays server-side in zbx.py - the browser only ever talks to this
app, never to Zabbix directly.
"""
import json

from flask import Flask, jsonify, redirect, render_template, request, url_for

from services import firewalls, incidents

app = Flask(__name__)


def _safe_embed_json(data: dict) -> str:
    """JSON for embedding inside a <script> tag - escapes "</" so a value
    containing e.g. a literal "</script>" can't break out of the tag."""
    return json.dumps(data).replace("</", "<\\/")


@app.route("/")
def index():
    return redirect(url_for("incidentes_page"))


@app.route("/incidentes")
def incidentes_page():
    data = _incidentes_data()
    return render_template(
        "incidentes.html", active_page="incidentes", initial_json=_safe_embed_json(data)
    )


@app.route("/firewalls")
def firewalls_page():
    data = _firewalls_data()
    return render_template("firewalls.html", active_page="firewalls", **data)


@app.route("/api/incidentes")
def api_incidentes():
    return jsonify(_incidentes_data())


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


def _firewalls_data() -> dict:
    hosts = firewalls.get_hosts()
    fleet = firewalls.get_fleet(hosts)
    return {
        "fleet": fleet,
        "summary": firewalls.get_summary(fleet),
        "sslvpn_sessions": firewalls.get_sslvpn_sessions(hosts),
        "problems": firewalls.get_firewall_problems(hosts),
    }


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
