"""Thin client for the Zabbix JSON-RPC API.

The API token is read from the ZABBIX_API_TOKEN environment variable (see
immunity-dashboard.service). Kept server-side only - the browser never sees it,
it only ever talks to our own /api/* endpoints.
"""
import itertools
import os

import requests

API_URL = os.environ.get("ZABBIX_API_URL", "http://127.0.0.1/api_jsonrpc.php")
API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")

_id_counter = itertools.count(1)


class ZabbixError(RuntimeError):
    pass


def call(method: str, params: dict | None = None, timeout: int = 15):
    if not API_TOKEN:
        raise ZabbixError("ZABBIX_API_TOKEN is not set")

    response = requests.post(
        API_URL,
        json={"jsonrpc": "2.0", "method": method, "params": params or {}, "id": next(_id_counter)},
        headers={
            "Content-Type": "application/json-rpc",
            "Authorization": f"Bearer {API_TOKEN}",
        },
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise ZabbixError(data["error"].get("data") or data["error"].get("message"))
    return data["result"]
