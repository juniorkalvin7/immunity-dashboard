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

  renderResourcePressure(pressure);
  renderProactiveOverview(data, pressure, criticalCount);
  hydrateIcons(document.getElementById("page-overview"));
}

function renderProactiveOverview(data, pressure, criticalCount) {
  const summary = data.summary;
  const firewalls = data.firewalls;
  const downCount = Number((pressure.counts || {}).down || 0);
  const connectivityCount = downCount + Number(firewalls.ipsec_down || 0);
  const capacity = [
    ...(pressure.cpu || []).map((row) => ({ ...row, type: "CPU", icon: "cpu" })),
    ...(pressure.memory || []).map((row) => ({ ...row, type: "MEMÓRIA", icon: "memory" })),
    ...(pressure.disk || []).map((row) => ({ ...row, type: "DISCO", icon: "disk" })),
  ].filter((row) => row.value >= 70).sort((a, b) => b.value - a.value);

  setOverviewText("ov-queue-critical", criticalCount);
  setOverviewText("ov-queue-unack", summary.unacknowledged);
  setOverviewText("ov-queue-capacity", capacity.length);
  setOverviewText("ov-queue-connectivity", connectivityCount);
  setOverviewText("ov-vpn-users", Number(firewalls.sslvpn_users || 0));
  setOverviewText("ov-vpn-users-detail", Number(firewalls.sslvpn_users || 0));
  setOverviewText("ov-ipsec-up", Number(firewalls.ipsec_up || 0));
  setOverviewText("ov-ipsec-down", Number(firewalls.ipsec_down || 0));
  setOverviewText("ov-ipsec-down-detail", Number(firewalls.ipsec_down || 0));
  setOverviewText("ov-capacity-counter", `${capacity.length} risco${capacity.length === 1 ? "" : "s"}`);
  setHomeKpiState("critical", criticalCount);
  setHomeKpiState("down", downCount);
  setHomeKpiState("unack", summary.unacknowledged);
  setHomeKpiState("capacity", capacity.length);
  setHomeKpiState("ipsec", Number(firewalls.ipsec_down || 0));

  renderPriorityActions(data, pressure, capacity);
  renderCapacityRisks(capacity);
  renderUnacknowledged((data.incidents || []).filter((item) => !item.acknowledged));
}

function setHomeKpiState(name, count) {
  const card = document.querySelector(`[data-home-state="${name}"]`);
  if (!card) return;
  card.classList.toggle("is-clear", Number(count) === 0);
}

function renderPriorityActions(data, pressure, capacity) {
  const actions = [];
  (pressure.down_hosts || []).forEach((host) => actions.push({ level: 6, type: "HOST DOWN", title: host.host_name, detail: host.error || "Sem comunicação", icon: "serverOff", href: "/home#incidents" }));
  if (Number(data.firewalls.ipsec_down || 0) > 0) actions.push({ level: 5, type: "VPN IPSEC", title: `${data.firewalls.ipsec_down} túneis indisponíveis`, detail: "Verifique conectividade e negociação dos túneis", icon: "linkOff", href: "/vpn-ipsec" });
  capacity.filter((row) => row.value >= 85).forEach((row) => actions.push({ level: 4, type: row.type, title: row.host_name, detail: `${row.value.toFixed(1)}% utilizado${row.detail ? ` · ${row.detail}` : ""}`, icon: row.icon, href: "#capacity-risks" }));
  (data.critical || []).forEach((item) => actions.push({ level: item.severity, type: item.severity_name.toUpperCase(), title: item.host_name, detail: item.name, duration: item.duration, icon: "alertTriangle", href: "/home#incidents" }));
  actions.sort((a, b) => b.level - a.level);

  const root = document.getElementById("ov-proactive-actions");
  if (!actions.length) {
    root.innerHTML = '<div class="proactive-empty"><span data-icon="checkCircle"></span><div><strong>Nenhuma ação imediata</strong><small>O ambiente não possui falhas críticas ou riscos de capacidade.</small></div></div>';
    return;
  }
  root.innerHTML = actions.slice(0, 8).map((action, index) => `
    <a class="proactive-action ${action.level >= 5 ? "is-critical" : "is-warning"}" href="${action.href}">
      <span class="action-rank">${String(index + 1).padStart(2, "0")}</span>
      <span class="action-icon" data-icon="${action.icon}"></span>
      <span class="action-copy"><small>${escapeHtml(action.type)}</small><strong>${escapeHtml(action.title)}</strong><span>${escapeHtml(action.detail)}</span></span>
      ${action.duration ? `<span class="action-duration">${escapeHtml(action.duration)}</span>` : ""}
      <b>→</b>
    </a>`).join("");
}

function renderCapacityRisks(items) {
  const root = document.getElementById("ov-capacity-risks");
  if (!items.length) {
    root.innerHTML = '<div class="proactive-empty"><span data-icon="checkCircle"></span><div><strong>Capacidade sob controle</strong><small>Nenhum recurso ultrapassou 70%.</small></div></div>';
    return;
  }
  root.innerHTML = items.slice(0, 10).map((item) => `
    <div class="capacity-risk ${item.value >= 85 ? "is-critical" : "is-warning"}">
      <span class="capacity-type" data-icon="${item.icon}"></span>
      <div><small>${item.type}</small><strong>${escapeHtml(item.host_name)}</strong>${pressureBar(item.value)}</div>
      <b>${item.value.toFixed(1)}%</b>
    </div>`).join("");
}

function renderUnacknowledged(items) {
  const root = document.getElementById("ov-unack-list");
  const sorted = [...items].sort((a, b) => b.severity - a.severity || Number(a.clock) - Number(b.clock));
  if (!sorted.length) {
    root.innerHTML = '<div class="proactive-empty"><span data-icon="checkCircle"></span><div><strong>Fila reconhecida</strong><small>Não existem incidentes aguardando reconhecimento.</small></div></div>';
    return;
  }
  root.innerHTML = sorted.slice(0, 8).map((item) => `
    <a class="unack-item" href="/home#incidents">
      <span class="sev-solid sev-solid-${item.severity_name}">${escapeHtml(item.severity_name)}</span>
      <span><strong>${escapeHtml(item.host_name)}</strong><small>${escapeHtml(item.name)}</small></span>
      <b>${escapeHtml(item.duration)}</b>
    </a>`).join("");
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
    <a class="overview-critical-item" href="/home#incidents" title="${escapeHtml(item.name)}">
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
