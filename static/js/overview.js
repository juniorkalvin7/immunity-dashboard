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
  const pressure = data.resources || { cpu: [], memory: [], disk: [], down_hosts: [], counts: {} };

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
  const healthKpi = document.getElementById("ov-health");
  if (healthKpi) healthKpi.style.color = healthColor;
  document.getElementById("ov-gauge-value").style.color = healthColor;
  document.getElementById("ov-gauge").style.setProperty("--health-angle", `${health.health_pct * 3.6}deg`);
  document.getElementById("ov-gauge").style.setProperty("--health-color", healthColor);

  renderOverviewSeverity(summary.by_severity);
  renderOverviewCritical(data.critical || []);
  renderOverviewGroups(data.top_groups || []);
  renderResourcePressure(pressure);
  hydrateIcons(document.getElementById("page-overview"));
}

function resourceState(cardName, count) {
  const card = document.querySelector(`[data-resource-status="${cardName}"]`);
  if (!card) return;
  card.classList.toggle("has-problem", Number(count) > 0);
  card.classList.toggle("is-healthy", Number(count) === 0);
}

function resourceUsageState(cardName, value) {
  const card = document.querySelector(`[data-resource-status="${cardName}"]`);
  if (!card) return;
  card.classList.remove("has-problem", "has-warning", "is-healthy");
  card.classList.add(value >= 85 ? "has-problem" : value >= 70 ? "has-warning" : "is-healthy");
}

function pressureBar(value) {
  const segments = 28;
  const active = Math.round(Math.max(0, Math.min(100, value)) / 100 * segments);
  return `<span class="segment-bar" aria-label="${value}%">${Array.from({ length: segments }, (_, i) => `<i class="${i < active ? "is-active" : ""}"></i>`).join("")}</span>`;
}

function pressureRows(rows, kind) {
  if (!rows.length) return '<div class="pressure-empty">Sem dados disponíveis</div>';
  return rows.map((row) => `
    <div class="pressure-row ${row.value >= 85 ? "is-critical" : row.value >= 70 ? "is-warning" : ""}">
      <span class="pressure-host" title="${escapeHtml(row.host_name)}">${escapeHtml(row.host_name)}</span>
      ${pressureBar(row.value)}
      <strong>${row.value.toFixed(1)}%</strong>
      ${kind === "disk" && row.detail ? `<small title="${escapeHtml(row.detail)}">${escapeHtml(row.detail)}</small>` : ""}
    </div>
  `).join("");
}

function renderResourcePressure(pressure) {
  const counts = pressure.counts || {};
  const cpuTop = (pressure.cpu || [])[0];
  const memoryTop = (pressure.memory || [])[0];
  const diskTop = (pressure.disk || [])[0];
  setOverviewText("ov-cpu-critical", cpuTop ? `${cpuTop.value.toFixed(1)}%` : "–");
  setOverviewText("ov-memory-critical", memoryTop ? `${memoryTop.value.toFixed(1)}%` : "–");
  setOverviewText("ov-disk-critical", diskTop ? `${diskTop.value.toFixed(1)}%` : "–");
  setOverviewText("ov-hosts-down", counts.down || 0);
  setOverviewText("ov-cpu-detail", cpuTop ? cpuTop.host_name : "Sem dados disponíveis");
  setOverviewText("ov-memory-detail", memoryTop ? memoryTop.host_name : "Sem dados disponíveis");
  setOverviewText("ov-disk-detail", diskTop ? `${diskTop.host_name}${diskTop.detail ? ` · ${diskTop.detail}` : ""}` : "Sem dados disponíveis");
  setOverviewText("ov-down-detail", counts.down ? "Exigem ação imediata" : "Todos comunicando");
  resourceUsageState("cpu", cpuTop ? cpuTop.value : 0);
  resourceUsageState("memory", memoryTop ? memoryTop.value : 0);
  resourceUsageState("disk", diskTop ? diskTop.value : 0);
  resourceState("down", counts.down || 0);

  document.getElementById("ov-pressure-cpu").innerHTML = pressureRows(pressure.cpu || [], "cpu");
  document.getElementById("ov-pressure-memory").innerHTML = pressureRows(pressure.memory || [], "memory");
  document.getElementById("ov-pressure-disk").innerHTML = pressureRows(pressure.disk || [], "disk");
  const downRoot = document.getElementById("ov-pressure-down");
  downRoot.innerHTML = (pressure.down_hosts || []).length
    ? pressure.down_hosts.map((host) => `<div class="down-host-row"><span class="down-pulse"></span><div><strong>${escapeHtml(host.host_name)}</strong><small title="${escapeHtml(host.error)}">${escapeHtml(host.error)}</small></div><b>DOWN</b></div>`).join("")
    : '<div class="pressure-empty pressure-empty-ok"><span data-icon="checkCircle"></span>Todos os hosts estão comunicando</div>';
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
