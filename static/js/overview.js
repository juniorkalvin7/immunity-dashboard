function loadOverviewInitial() {
  const el = document.getElementById("overview-initial-data");
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch (_) { return null; }
}

function setOverviewText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderOverview(data) {
  const summary = data.summary;
  const health = data.health;
  const firewalls = data.firewalls;
  const criticalCount = (summary.by_severity.disaster || 0) + (summary.by_severity.high || 0);

  setOverviewText("ov-health", health.health_pct + "%");
  setOverviewText("ov-health-detail", `${health.healthy_hosts} de ${health.total_hosts} hosts saudáveis`);
  setOverviewText("ov-incidents", summary.total);
  setOverviewText("ov-unack", `${summary.unacknowledged} não reconhecidos`);
  setOverviewText("ov-critical", criticalCount);
  setOverviewText("ov-firewalls", firewalls.count);
  setOverviewText("ov-ipsec", `${firewalls.ipsec_down} túneis indisponíveis`);
  setOverviewText("ov-vpn", firewalls.sslvpn_users);
  setOverviewText("ov-vpn-card", firewalls.sslvpn_users);
  setOverviewText("ov-ipsec-up", firewalls.ipsec_up);
  setOverviewText("ov-ipsec-down", firewalls.ipsec_down);
  setOverviewText("ov-gauge-value", health.health_pct + "%");
  setOverviewText("ov-host-total", health.total_hosts);
  setOverviewText("ov-host-ok", health.healthy_hosts);
  setOverviewText("ov-host-bad", health.hosts_with_problems);
  setOverviewText("ov-critical-counter", `${criticalCount} crítico${criticalCount === 1 ? "" : "s"}`);

  const healthColor = health.health_pct >= 90 ? "var(--ok)" : health.health_pct >= 70 ? "var(--warn)" : "var(--bad)";
  document.getElementById("ov-health").style.color = healthColor;
  document.getElementById("ov-gauge-value").style.color = healthColor;
  document.getElementById("ov-gauge").style.setProperty("--health-angle", `${health.health_pct * 3.6}deg`);
  document.getElementById("ov-gauge").style.setProperty("--health-color", healthColor);

  renderOverviewSeverity(summary.by_severity);
  renderOverviewCritical(data.critical || []);
  renderOverviewGroups(data.top_groups || []);
  hydrateIcons(document.getElementById("page-overview"));
}

function renderOverviewSeverity(counts) {
  const levels = [
    ["disaster", "Disaster", "var(--sev-disaster)"],
    ["high", "High", "var(--sev-high)"],
    ["average", "Average", "var(--sev-average)"],
    ["warning", "Warning", "var(--sev-warning)"],
    ["information", "Information", "var(--sev-information)"],
  ];
  const total = levels.reduce((sum, level) => sum + Number(counts[level[0]] || 0), 0) || 1;
  document.getElementById("ov-severity-stack").innerHTML = levels.map(([key,, color]) => {
    const pct = Number(counts[key] || 0) / total * 100;
    return pct ? `<span style="width:${pct}%;background:${color}"></span>` : "";
  }).join("");
  document.getElementById("ov-severity-list").innerHTML = levels.map(([key, label, color]) => `
    <div><i style="background:${color}"></i><span>${label}</span><strong>${counts[key] || 0}</strong><small>${Math.round((counts[key] || 0) / total * 100)}%</small></div>
  `).join("");
}

function renderOverviewCritical(items) {
  const root = document.getElementById("ov-critical-list");
  if (!items.length) {
    root.innerHTML = '<div class="overview-empty"><span data-icon="checkCircle"></span><strong>Nenhum incidente crítico</strong><small>O ambiente não possui alertas High ou Disaster ativos.</small></div>';
    return;
  }
  root.innerHTML = items.map((item) => `
    <a class="overview-critical-item" href="/incidentes" title="${escapeHtml(item.name)}">
      <span class="sev-solid sev-solid-${item.severity_name}">${escapeHtml(item.severity_name)}</span>
      <span class="overview-critical-copy"><strong>${escapeHtml(item.host_name)}</strong><small>${escapeHtml(item.name)}</small></span>
      <span class="overview-critical-duration">${escapeHtml(item.duration)}</span>
      <span class="overview-critical-arrow">→</span>
    </a>
  `).join("");
}

function renderOverviewGroups(groups) {
  const root = document.getElementById("ov-groups");
  if (!groups.length) {
    root.innerHTML = '<div class="overview-empty"><strong>Sem incidentes ativos</strong></div>';
    return;
  }
  const max = Math.max(...groups.map((group) => group.count), 1);
  root.innerHTML = groups.map((group, index) => `
    <div class="overview-group-row">
      <span class="overview-group-rank">${String(index + 1).padStart(2, "0")}</span>
      <div><strong title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</strong><span><i style="width:${group.count / max * 100}%"></i></span></div>
      <b>${group.count}</b>
    </div>
  `).join("");
}

const overviewInitial = loadOverviewInitial();
if (overviewInitial) renderOverview(overviewInitial);

startPolling(async () => renderOverview(await fetchJson("/api/overview")));
