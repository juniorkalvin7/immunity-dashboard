// ---------- state ----------

let allIncidents = [];
let groups = [];
let latestPayload = null;

const ALL_SEVERITIES = ["disaster", "high", "average", "warning", "information"];

const filters = {
  search: "",
  severities: new Set(ALL_SEVERITIES),
  group: "",
  unackOnly: false,
};

let sortState = { key: "severity", dir: "desc" };
let page = 1;
let pageSize = 20;

// ---------- data plumbing ----------

function loadInitialData() {
  const el = document.getElementById("incidentes-initial-data");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch (e) {
    return null;
  }
}

function applyData(data) {
  latestPayload = data;
  allIncidents = data.incidents;
  groups = data.groups;
  page = 1;
  renderSummary(data.summary);
  renderTrends(data.trend_24h);
  renderPriority(data.summary);
  renderHealth(data.health);
  renderAlertBanner(data.top_critical);
  populateGroupSelect();
  renderTable();
}

function populateGroupSelect() {
  const select = document.getElementById("filter-group");
  const current = select.value;
  select.innerHTML =
    '<option value="">todos os grupos</option>' +
    groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  if (groups.includes(current)) select.value = current;
}

// ---------- filtering + sorting ----------

function getFiltered() {
  const search = filters.search.trim().toLowerCase();
  return allIncidents.filter((inc) => {
    if (!filters.severities.has(inc.severity_name)) return false;
    if (filters.group && inc.group_name !== filters.group) return false;
    if (filters.unackOnly && inc.acknowledged) return false;
    if (search) {
      const haystack = (inc.host_name + " " + inc.name + " " + (inc.tags || []).join(" ")).toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function getSorted(list) {
  const { key, dir } = sortState;
  const mult = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === "clock") { av = Number(av); bv = Number(bv); }
    if (key === "acknowledged") { av = av ? 1 : 0; bv = bv ? 1 : 0; }
    if (typeof av === "string") return av.localeCompare(bv) * mult;
    return (av - bv) * mult;
  });
}

// ---------- rendering: top panels ----------

function renderSummary(summary) {
  const badge = document.getElementById("notif-badge");
  if (badge) {
    badge.hidden = summary.unacknowledged === 0;
    badge.textContent = summary.unacknowledged > 99 ? "99+" : summary.unacknowledged;
  }
  const totalEl = document.getElementById("inc-total");
  if (!totalEl) return;
  totalEl.textContent = summary.total;
  document.getElementById("inc-disaster").textContent = summary.by_severity.disaster;
  document.getElementById("inc-high").textContent = summary.by_severity.high;
  document.getElementById("inc-average").textContent = summary.by_severity.average;
  document.getElementById("inc-warning").textContent = summary.by_severity.warning;
  document.getElementById("inc-unack").textContent = summary.unacknowledged;

}

function renderTrends(trend) {
  const map = { total: null, disaster: "disaster", high: "high", average: "average", warning: "warning" };
  const totalNew = (trend.disaster || 0) + (trend.high || 0) + (trend.average || 0) + (trend.warning || 0) + (trend.information || 0);
  setTrend("trend-total", totalNew);
  setTrend("trend-disaster", trend.disaster);
  setTrend("trend-high", trend.high);
  setTrend("trend-average", trend.average);
  setTrend("trend-warning", trend.warning);
}

function setTrend(elId, count) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!count) {
    el.textContent = "sem novos nas últimas 24h";
    el.classList.remove("trend-up");
  } else {
    el.textContent = `+${count} novos nas últimas 24h`;
    el.classList.add("trend-up");
  }
}

function renderPriority(summary) {
  if (!document.getElementById("priority-bar")) return;
  const segments = [
    { key: "disaster", label: "Disaster", color: "var(--sev-disaster)" },
    { key: "high", label: "High", color: "var(--sev-high)" },
    { key: "average", label: "Average", color: "var(--sev-average)" },
    { key: "warning", label: "Warning", color: "var(--sev-warning)" },
  ];
  const total = segments.reduce((sum, s) => sum + (summary.by_severity[s.key] || 0), 0) || 1;

  document.getElementById("priority-bar").innerHTML = segments
    .map((s) => {
      const count = summary.by_severity[s.key] || 0;
      const pct = (count / total) * 100;
      return count > 0
        ? `<span class="priority-bar-segment" style="width:${pct}%;background:${s.color}"></span>`
        : "";
    })
    .join("");

  document.getElementById("priority-legend").innerHTML =
    segments
      .map((s) => `<div class="priority-legend-item"><span class="n" style="color:${s.color}">${summary.by_severity[s.key] || 0}</span><span class="l">${s.label}</span></div>`)
      .join("") +
    `<div class="priority-legend-item"><span class="n">${summary.unacknowledged}</span><span class="l">Não reconhecidos</span></div>`;
}

function renderHealth(health) {
  if (!health || !document.getElementById("health-pct")) return;
  document.getElementById("health-pct").textContent = health.health_pct + "%";
  document.getElementById("health-pct").style.color =
    health.health_pct >= 90 ? "var(--ok)" : health.health_pct >= 70 ? "var(--warn)" : "var(--bad)";
  document.getElementById("health-total").textContent = health.total_hosts;
  document.getElementById("health-ok").textContent = health.healthy_hosts;
  document.getElementById("health-bad").textContent = health.hosts_with_problems;
}

function renderAlertBanner(top) {
  const banner = document.getElementById("alert-banner");
  if (!banner) return;
  if (!top) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const criticalCount = allIncidents.filter((i) => i.severity >= 4 && !i.acknowledged).length;
  document.getElementById("alert-title").textContent =
    `${criticalCount} incidente${criticalCount === 1 ? "" : "s"} crítico${criticalCount === 1 ? "" : "s"} exig${criticalCount === 1 ? "e" : "em"} ação`;
  document.getElementById("alert-desc").textContent = `${top.name} em ${top.host_name}`;
}

// ---------- rendering: table ----------

function tagsHtml(tags) {
  if (!tags || tags.length === 0) return "";
  return tags
    .slice(0, 3)
    .map((t) => `<span class="tag-pill" title="${escapeHtml(t)}">${escapeHtml(t)}</span>`)
    .join("");
}

function statusHtml(inc) {
  return inc.acknowledged
    ? `<span class="status-chip status-ok">${ICONS.checkCircle}Reconhecido</span>`
    : `<span class="status-chip status-new">${ICONS.circle}Novo</span>`;
}

function actionHtml(inc) {
  return `<button class="ack-btn ${inc.acknowledged ? "is-unack" : ""}" data-eventid="${inc.eventid}" data-mode="${inc.acknowledged ? "unack" : "ack"}">${inc.acknowledged ? "Desreconhecer" : "Reconhecer"}</button>`;
}

function renderTable() {
  const filtered = getFiltered();
  const sorted = getSorted(filtered);
  const tbody = document.getElementById("inc-rows");

  document.getElementById("filter-count").textContent = `${filtered.length} resultados`;

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  if (page > totalPages) page = totalPages;
  const start = (page - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">nenhum incidente encontrado</td></tr>';
  } else {
    tbody.innerHTML = pageItems
      .map((inc) => {
        return `<tr class="sev-row-${inc.severity_name}" data-eventid="${inc.eventid}">
          <td><span class="sev-solid sev-solid-${inc.severity_name}">${inc.severity_name}</span></td>
          <td class="fw-name truncate" title="${escapeHtml(inc.host_name)}">${escapeHtml(inc.host_name)}</td>
          <td class="mono-dim truncate" title="${escapeHtml(inc.group_name)}">${escapeHtml(inc.group_name)}</td>
          <td class="truncate" title="${escapeHtml(inc.name)}">${escapeHtml(inc.name)}</td>
          <td class="tags-cell">${tagsHtml(inc.tags)}</td>
          <td class="mono-dim"><span class="duration-cell">${ICONS.clock}${escapeHtml(inc.duration)}</span></td>
          <td>${statusHtml(inc)}</td>
          <td>${actionHtml(inc)}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll(".ack-btn").forEach((btn) => btn.addEventListener("click", onAcknowledgeClick));
  }

  renderPagination(sorted.length, totalPages);
}

function renderPagination(totalItems, totalPages) {
  const el = document.getElementById("pagination");
  if (totalItems === 0) {
    el.innerHTML = "";
    return;
  }
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  const pageButtons = [];
  for (let p = 1; p <= totalPages; p++) {
    if (totalPages > 7 && Math.abs(p - page) > 2 && p !== 1 && p !== totalPages) {
      if (pageButtons[pageButtons.length - 1] !== "…") pageButtons.push("…");
      continue;
    }
    pageButtons.push(p);
  }

  el.innerHTML = `
    <span>${start}–${end} de ${totalItems} incidentes</span>
    <div class="pagination-pages">
      <button class="page-btn" id="page-prev" ${page === 1 ? "disabled" : ""}>${ICONS.chevronLeft}</button>
      ${pageButtons
        .map((p) =>
          p === "…"
            ? `<span class="mono-dim">…</span>`
            : `<button class="page-btn ${p === page ? "is-active" : ""}" data-page="${p}">${p}</button>`
        )
        .join("")}
      <button class="page-btn" id="page-next" ${page === totalPages ? "disabled" : ""}>${ICONS.chevronRight}</button>
    </div>
    <span>Itens por página:
      <select class="page-size-select" id="page-size-select">
        <option value="10" ${pageSize === 10 ? "selected" : ""}>10</option>
        <option value="20" ${pageSize === 20 ? "selected" : ""}>20</option>
        <option value="50" ${pageSize === 50 ? "selected" : ""}>50</option>
      </select>
    </span>
  `;

  document.getElementById("page-prev").addEventListener("click", () => { page--; renderTable(); });
  document.getElementById("page-next").addEventListener("click", () => { page++; renderTable(); });
  el.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => { page = Number(btn.dataset.page); renderTable(); });
  });
  document.getElementById("page-size-select").addEventListener("change", (e) => {
    pageSize = Number(e.target.value);
    page = 1;
    renderTable();
  });
}

// ---------- interactions ----------

async function onAcknowledgeClick(ev) {
  const btn = ev.currentTarget;
  const eventid = btn.dataset.eventid;
  const unacknowledging = btn.dataset.mode === "unack";
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const res = await fetch(`/api/incidentes/${eventid}/${unacknowledging ? "unack" : "ack"}`, { method: "POST" });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || "falha ao reconhecer");
    const inc = allIncidents.find((i) => i.eventid === eventid);
    if (inc) {
      inc.acknowledged = !unacknowledging;
      const summaryEl = document.getElementById("inc-unack");
      if (summaryEl) summaryEl.textContent = Math.max(0, Number(summaryEl.textContent) + (unacknowledging ? 1 : -1));
    }
    renderTable();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = unacknowledging ? "Desreconhecer" : "Reconhecer";
    setConnStatus(false, e.message);
  }
}

function updateAllToggleState() {
  const allBtn = document.querySelector('.sev-toggle[data-sev="all"]');
  allBtn.classList.toggle("is-active", filters.severities.size === ALL_SEVERITIES.length);
}

function setupFilterBar() {
  document.getElementById("filter-search").addEventListener("input", (e) => {
    filters.search = e.target.value;
    page = 1;
    renderTable();
  });

  document.getElementById("filter-group").addEventListener("change", (e) => {
    filters.group = e.target.value;
    page = 1;
    renderTable();
  });

  document.getElementById("filter-unack").addEventListener("change", (e) => {
    filters.unackOnly = e.target.checked;
    page = 1;
    renderTable();
  });

  document.querySelectorAll(".sev-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sev = btn.dataset.sev;
      if (sev === "all") {
        filters.severities = new Set(ALL_SEVERITIES);
        document.querySelectorAll(".sev-toggle").forEach((b) => b.classList.add("is-active"));
      } else {
        if (filters.severities.has(sev)) {
          filters.severities.delete(sev);
          btn.classList.remove("is-active");
        } else {
          filters.severities.add(sev);
          btn.classList.add("is-active");
        }
        updateAllToggleState();
      }
      page = 1;
      renderTable();
    });
  });

  document.querySelectorAll("#inc-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      } else {
        sortState = { key, dir: "desc" };
      }
      document.querySelectorAll("#inc-table th[data-sort]").forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
      th.classList.add(sortState.dir === "asc" ? "sort-asc" : "sort-desc");
      renderTable();
    });
  });

  const alertCta = document.getElementById("alert-cta");
  if (alertCta) alertCta.addEventListener("click", () => {
    filters.severities = new Set(["disaster", "high"]);
    document.querySelectorAll(".sev-toggle").forEach((b) => {
      const sev = b.dataset.sev;
      b.classList.toggle("is-active", sev === "disaster" || sev === "high");
    });
    updateAllToggleState();
    page = 1;
    renderTable();
    document.getElementById("inc-table").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

window.applyIncidentShortcut = function applyIncidentShortcut(mode) {
  filters.search = "";
  document.getElementById("filter-search").value = "";
  filters.group = "";
  document.getElementById("filter-group").value = "";
  filters.unackOnly = mode === "unack";
  document.getElementById("filter-unack").checked = filters.unackOnly;
  filters.severities = new Set(mode === "critical" ? ["disaster", "high"] : ALL_SEVERITIES);
  document.querySelectorAll(".sev-toggle").forEach((button) => {
    const severity = button.dataset.sev;
    button.classList.toggle("is-active", mode === "critical" ? severity === "disaster" || severity === "high" : true);
  });
  updateAllToggleState();
  page = 1;
  renderTable();
};

// ---------- boot ----------

setupFilterBar();

const initial = loadInitialData();
if (initial) applyData(initial);

startPolling(async () => {
  const data = await fetchJson("/api/incidentes");
  applyData(data);
});
