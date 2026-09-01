function renderFwSummary(summary, problemCount) {
  document.getElementById("stat-hosts").textContent = summary.count;
  document.getElementById("stat-ipsec-up").textContent = summary.ipsec_up;
  const downEl = document.getElementById("stat-ipsec-down");
  downEl.textContent = summary.ipsec_down;
  downEl.className = "stat-value " + (summary.ipsec_down > 0 ? "is-bad" : "is-ok");
  document.getElementById("stat-sslvpn").textContent = summary.sslvpn_users;
  const probEl = document.getElementById("stat-problems");
  probEl.textContent = problemCount;
  probEl.className = "stat-value " + (problemCount > 0 ? "is-bad" : "is-ok");
}

function renderFleet(fleet) {
  const tbody = document.getElementById("fw-rows");
  if (fleet.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">nenhum firewall encontrado</td></tr>';
    return;
  }
  tbody.innerHTML = fleet
    .map((fw) => {
      const ipsecCell =
        !fw.ipsec_up && !fw.ipsec_down
          ? '<span class="mono-dim">—</span>'
          : `<span class="ipsec-cell"><span class="up">${fw.ipsec_up} up</span><span class="sep">/</span><span class="down">${fw.ipsec_down} down</span></span>`;
      const sslvpnCell = fw.sslvpn_users
        ? `<span class="badge badge-active">${fw.sslvpn_users}</span>`
        : '<span class="badge badge-zero">0</span>';
      return `<tr>
        <td class="fw-name">${escapeHtml(fw.name)}</td>
        <td class="fw-model">${escapeHtml(fw.model)}</td>
        <td class="mono-dim">${escapeHtml(fw.firmware)}</td>
        <td class="mono-dim">${escapeHtml(fw.uptime)}</td>
        <td>${metricBarHtml(fw.memory_pct)}</td>
        <td>${metricBarHtml(fw.disk_pct)}</td>
        <td>${metricBarHtml(fw.swap_pct)}</td>
        <td>${ipsecCell}</td>
        <td>${sslvpnCell}</td>
      </tr>`;
    })
    .join("");
}

function renderSslvpnSessions(sessions) {
  const tbody = document.getElementById("sslvpn-rows");
  if (sessions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">nenhum usuário conectado</td></tr>';
    return;
  }
  tbody.innerHTML = sessions
    .map(
      (u) => `<tr>
        <td class="mono-dim">${escapeHtml(u.host_name)}</td>
        <td class="fw-name">${escapeHtml(u.username)}</td>
        <td class="metric">${escapeHtml(u.source_ip)}</td>
        <td class="metric">${escapeHtml(u.assigned_ip)}</td>
        <td class="mono-dim">${escapeHtml(u.connected_since)}</td>
        <td class="metric">${fmtBytes(u.download_bytes)}</td>
        <td class="metric">${fmtBytes(u.upload_bytes)}</td>
      </tr>`
    )
    .join("");
}

function renderFwProblems(problems) {
  const tbody = document.getElementById("problems-rows");
  if (problems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">nenhum problema ativo</td></tr>';
    return;
  }
  tbody.innerHTML = problems
    .map(
      (p) => `<tr>
        <td>${sevBadgeHtml(p.severity_name)}</td>
        <td class="mono-dim">${escapeHtml(p.host_name)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td class="mono-dim">${escapeHtml(p.since)}</td>
      </tr>`
    )
    .join("");
}

startPolling(async () => {
  const data = await fetchJson("/api/firewalls");
  renderFwSummary(data.summary, data.problems.length);
  renderFleet(data.fleet);
  renderSslvpnSessions(data.sslvpn_sessions);
  renderFwProblems(data.problems);
});
