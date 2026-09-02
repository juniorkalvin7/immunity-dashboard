const vpnDataEl = document.getElementById("vpn-data");
let vpnSessions = vpnDataEl ? JSON.parse(vpnDataEl.textContent || "[]") : [];
const ipsecDataEl = document.getElementById("ipsec-data");
let ipsecTunnels = ipsecDataEl ? JSON.parse(ipsecDataEl.textContent || "[]") : [];

function populateActivitySelect(select, values, defaultLabel) {
  if (!select) return;
  const current = select.value;
  select.replaceChildren(new Option(defaultLabel, ""));
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).forEach((value) => select.add(new Option(value, value)));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

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
  populateActivitySelect(vpnFirewall, rows.map((u) => u.host_name), "Todos os firewalls");
  populateActivitySelect(vpnUser, rows.map((u) => u.username), "Todos os usuários");
  filterVpnUsers();
}

function renderIpsec(data) {
  if (!ipsecDataEl) return;
  document.getElementById("ipsec-up-total").textContent = data.summary.ipsec_up;
  document.getElementById("ipsec-down-total").textContent = data.summary.ipsec_down;
  const problems = (data.problems || []).filter((p) => /ipsec|tunnel|vpn/i.test(p.name || ""));
  document.getElementById("ipsec-problem-total").textContent = problems.length;
  ipsecTunnels = data.ipsec_tunnels || [];
  populateActivitySelect(ipsecFirewall, ipsecTunnels.map((tunnel) => tunnel.host_name), "Todos os firewalls");
  filterIpsecTunnels();
}

const vpnSearch = document.getElementById("vpn-user-search");
const vpnFirewall = document.getElementById("vpn-user-firewall");
const vpnUser = document.getElementById("vpn-user-name");

function filterVpnUsers() {
  const needle = (vpnSearch?.value || "").trim().toLowerCase();
  renderVpnUsers(vpnSessions.filter((session) => {
    if (vpnFirewall?.value && session.host_name !== vpnFirewall.value) return false;
    if (vpnUser?.value && session.username !== vpnUser.value) return false;
    return !needle || `${session.source_ip || ""} ${session.assigned_ip || ""} ${session.session_id || ""}`.toLowerCase().includes(needle);
  }));
}

[vpnSearch, vpnFirewall, vpnUser].forEach((control) => control?.addEventListener("input", filterVpnUsers));

const ipsecSearch = document.getElementById("ipsec-search");
const ipsecFirewall = document.getElementById("ipsec-firewall-filter");
const ipsecStatus = document.getElementById("ipsec-status-filter");

function filterIpsecTunnels() {
  if (!ipsecDataEl) return;
  const needle = (ipsecSearch?.value || "").trim().toLowerCase();
  const rows = ipsecTunnels.filter((tunnel) => {
    if (ipsecFirewall?.value && tunnel.host_name !== ipsecFirewall.value) return false;
    if (ipsecStatus?.value && tunnel.status !== ipsecStatus.value) return false;
    return !needle || (tunnel.tunnel_name || "").toLowerCase().includes(needle);
  });
  document.getElementById("ipsec-result-count").textContent = `${rows.length} túneis`;
  document.getElementById("ipsec-tunnel-rows").innerHTML = rows.map((tunnel) => `<tr class="vpn-tunnel-row is-${tunnel.status}"><td><span class="vpn-state ${tunnel.status === "up" ? "is-up" : "is-down"}">${escapeHtml(tunnel.status.toUpperCase())}</span></td><td class="fw-name">${escapeHtml(tunnel.host_name)}</td><td>${escapeHtml(tunnel.tunnel_name)}</td><td class="mono-dim">${escapeHtml(tunnel.duration || "—")}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">Nenhum túnel encontrado com esses filtros</td></tr>';
}

[ipsecSearch, ipsecFirewall, ipsecStatus].forEach((control) => control?.addEventListener("input", filterIpsecTunnels));

if (vpnDataEl) {
  applyVpnUsers(vpnSessions);
}
if (ipsecDataEl) {
  populateActivitySelect(ipsecFirewall, ipsecTunnels.map((tunnel) => tunnel.host_name), "Todos os firewalls");
  filterIpsecTunnels();
}

startPolling(async () => {
  const data = await fetchJson("/api/firewalls");
  if (vpnDataEl) applyVpnUsers(data.sslvpn_sessions || []);
  renderIpsec(data);
});
