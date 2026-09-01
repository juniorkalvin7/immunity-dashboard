const vpnDataEl = document.getElementById("vpn-data");
let vpnSessions = vpnDataEl ? JSON.parse(vpnDataEl.textContent || "[]") : [];

function renderVpnUsers(rows) {
  const tbody = document.getElementById("vpn-user-rows");
  if (!tbody) return;
  document.getElementById("vpn-user-count").textContent = `${rows.length} sessões`;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Nenhum usuário conectado agora</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((u) => `<tr><td><span class="vpn-state is-up">ATIVO</span></td><td class="fw-name">${escapeHtml(u.username || "—")}</td><td>${escapeHtml(u.host_name || "—")}</td><td class="metric">${escapeHtml(u.source_ip || "—")}</td><td class="metric">${escapeHtml(u.assigned_ip || "—")}</td><td>${escapeHtml(u.service_type || u.access_mode || "SSL VPN")}</td><td class="mono-dim">${escapeHtml(u.connected_since || "—")}</td><td class="metric">${fmtBytes(u.download_bytes || 0)}</td><td class="metric">${fmtBytes(u.upload_bytes || 0)}</td></tr>`).join("");
}

function applyVpnUsers(rows) {
  vpnSessions = rows;
  const totalEl = document.getElementById("vpn-users-total");
  if (totalEl) totalEl.textContent = rows.length;
  const total = rows.reduce((sum, u) => sum + Number(u.download_bytes || 0) + Number(u.upload_bytes || 0), 0);
  const traffic = document.getElementById("vpn-users-traffic");
  if (traffic) traffic.textContent = fmtBytes(total);
  if (vpnSearch) vpnSearch.dispatchEvent(new Event("input")); else renderVpnUsers(rows);
}

function renderIpsec(data) {
  const fleetRows = document.getElementById("ipsec-firewall-rows");
  if (!fleetRows) return;
  document.getElementById("ipsec-up-total").textContent = data.summary.ipsec_up;
  document.getElementById("ipsec-down-total").textContent = data.summary.ipsec_down;
  const problems = (data.problems || []).filter((p) => /ipsec|tunnel|vpn/i.test(p.name || ""));
  document.getElementById("ipsec-problem-total").textContent = problems.length;
  fleetRows.innerHTML = (data.fleet || []).map((fw) => `<tr><td class="fw-name">${escapeHtml(fw.name)}</td><td>${escapeHtml(fw.model)}</td><td class="mono-dim">${escapeHtml(fw.firmware)}</td><td class="mono-dim">${escapeHtml(fw.uptime)}</td><td><span class="vpn-number is-up">${fw.ipsec_up || 0}</span></td><td><span class="vpn-number ${fw.ipsec_down ? "is-down" : ""}">${fw.ipsec_down || 0}</span></td><td><span class="vpn-state ${fw.ipsec_down ? "is-down" : "is-up"}">${fw.ipsec_down ? "ATENÇÃO" : "OK"}</span></td></tr>`).join("") || '<tr><td colspan="7" class="empty">Nenhum firewall encontrado</td></tr>';
  document.getElementById("ipsec-problem-rows").innerHTML = problems.map((p) => `<tr><td>${sevBadgeHtml(p.severity_name)}</td><td class="fw-name">${escapeHtml(p.host_name)}</td><td>${escapeHtml(p.name)}</td><td class="mono-dim">${escapeHtml(p.since)}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">Todos os túneis estão operacionais</td></tr>';
}

const vpnSearch = document.getElementById("vpn-user-search");
if (vpnSearch) vpnSearch.addEventListener("input", () => {
  const needle = vpnSearch.value.trim().toLowerCase();
  renderVpnUsers(vpnSessions.filter((u) => `${u.username || ""} ${u.host_name || ""} ${u.source_ip || ""} ${u.assigned_ip || ""}`.toLowerCase().includes(needle)));
});

if (vpnDataEl) {
  applyVpnUsers(vpnSessions);
}

startPolling(async () => {
  const data = await fetchJson("/api/firewalls");
  if (vpnDataEl) applyVpnUsers(data.sslvpn_sessions || []);
  renderIpsec(data);
});
