// Shared helpers used by every page's JS. No Zabbix calls happen here or
// anywhere in the browser - each page's script only polls this app's own
// /api/* endpoints (see app.py), which hold the Zabbix token server-side.

const REFRESH_MS = 30000;

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtBytes(n) {
  n = Number(n);
  if (!n && n !== 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

function pctBarClass(pct) {
  if (pct >= 90) return "bad";
  if (pct >= 75) return "warn";
  return "";
}

function metricBarHtml(pct) {
  const p = Number(pct);
  if (isNaN(p)) return '<span class="metric">—</span>';
  const cls = pctBarClass(p);
  return `<span class="metric-bar"><span class="${cls}" style="width:${Math.min(p, 100)}%"></span></span><span class="metric">${p}%</span>`;
}

function sevBadgeHtml(name) {
  return `<span class="sev sev-${name}">${name.replace("_", " ")}</span>`;
}

function setConnStatus(ok, errorMessage) {
  const dotClass = "dot " + (ok ? "dot-ok" : "dot-bad");
  const sidebarDot = document.getElementById("conn-dot");
  const liveDot = document.getElementById("live-dot");
  if (sidebarDot) sidebarDot.className = dotClass;
  if (liveDot) liveDot.className = dotClass;

  const errEl = document.getElementById("error-msg");
  if (errEl) errEl.textContent = ok ? "" : "erro: " + errorMessage;

  const lastUpdate = document.getElementById("last-update");
  if (lastUpdate) lastUpdate.textContent = ok ? "atualizado agora" : "falha ao atualizar";
}

// Fills in any <td data-bytes="1234"> cell with a human-readable size -
// used for values rendered server-side on first paint (see firewalls.html).
function hydrateByteCells(root = document) {
  root.querySelectorAll("[data-bytes]").forEach((el) => {
    el.textContent = fmtBytes(el.dataset.bytes);
  });
}

// Fills in any <span data-icon="name"> with the matching ICONS[name] SVG.
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const svg = ICONS[el.dataset.icon];
    if (svg) el.innerHTML = svg;
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Polls `loadAndRender` every REFRESH_MS, updating connection status/timestamp
// around it. Call once immediately on page load, then let it repeat.
function startPolling(loadAndRender) {
  async function tick() {
    try {
      await loadAndRender();
      setConnStatus(true);
    } catch (e) {
      setConnStatus(false, e.message);
    }
  }
  tick();
  setInterval(tick, REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", () => {
  hydrateByteCells();
  hydrateIcons();
});
