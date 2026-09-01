// State
let allIncidents = [];
let groups = [];

const filters = {
  search: "",
  severities: new Set(["disaster", "high", "average", "warning", "information"]),
  group: "",
  unackOnly: false,
};

let sortState = { key: "severity", dir: "desc" };

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
  allIncidents = data.incidents;
  groups = data.groups;
  renderSummary(data.summary);
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
      const haystack = (inc.host_name + " " + inc.name).toLowerCase();
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

// ---------- rendering ----------

function renderSummary(summary) {
  document.getElementById("inc-total").textContent = summary.total;
  document.getElementById("inc-disaster").textContent = summary.by_severity.disaster;
  document.getElementById("inc-high").textContent = summary.by_severity.high;
  document.getElementById("inc-average").textContent = summary.by_severity.average;
  document.getElementById("inc-warning").textContent = summary.by_severity.warning;
  document.getElementById("inc-unack").textContent = summary.unacknowledged;
}

function tagsHtml(tags) {
  if (!tags || tags.length === 0) return "";
  return tags
    .slice(0, 3)
    .map((t) => `<span class="tag-pill" title="${escapeHtml(t)}">${escapeHtml(t)}</span>`)
    .join("");
}

function statusHtml(inc) {
  if (inc.acknowledged) {
    return '<span class="mono-dim">✓ reconhecido</span>';
  }
  return `<button class="ack-btn" data-eventid="${inc.eventid}">reconhecer</button>`;
}

function renderTable() {
  const filtered = getFiltered();
  const sorted = getSorted(filtered);
  const tbody = document.getElementById("inc-rows");

  document.getElementById("filter-count").textContent =
    filtered.length === allIncidents.length
      ? `${allIncidents.length} incidentes`
      : `${filtered.length} de ${allIncidents.length} incidentes`;

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">nenhum incidente encontrado</td></tr>';
    return;
  }

  tbody.innerHTML = sorted
    .map((inc) => {
      return `<tr class="sev-row-${inc.severity_name}" data-eventid="${inc.eventid}">
        <td>${sevBadgeHtml(inc.severity_name)}</td>
        <td class="fw-name truncate" title="${escapeHtml(inc.host_name)}">${escapeHtml(inc.host_name)}</td>
        <td class="mono-dim truncate" title="${escapeHtml(inc.group_name)}">${escapeHtml(inc.group_name)}</td>
        <td class="truncate" title="${escapeHtml(inc.name)}">${escapeHtml(inc.name)}</td>
        <td class="tags-cell">${tagsHtml(inc.tags)}</td>
        <td class="mono-dim">${escapeHtml(inc.duration)}</td>
        <td>${statusHtml(inc)}</td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".ack-btn").forEach((btn) => {
    btn.addEventListener("click", onAcknowledgeClick);
  });
}

// ---------- interactions ----------

async function onAcknowledgeClick(ev) {
  const btn = ev.currentTarget;
  const eventid = btn.dataset.eventid;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const res = await fetch(`/api/incidentes/${eventid}/ack`, { method: "POST" });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || "falha ao reconhecer");
    const inc = allIncidents.find((i) => i.eventid === eventid);
    if (inc) {
      inc.acknowledged = true;
      const summary = document.getElementById("inc-unack");
      summary.textContent = Math.max(0, Number(summary.textContent) - 1);
    }
    renderTable();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "reconhecer";
    setConnStatus(false, e.message);
  }
}

function setupFilterBar() {
  document.getElementById("filter-search").addEventListener("input", (e) => {
    filters.search = e.target.value;
    renderTable();
  });

  document.getElementById("filter-group").addEventListener("change", (e) => {
    filters.group = e.target.value;
    renderTable();
  });

  document.getElementById("filter-unack").addEventListener("change", (e) => {
    filters.unackOnly = e.target.checked;
    renderTable();
  });

  document.querySelectorAll(".sev-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sev = btn.dataset.sev;
      if (filters.severities.has(sev)) {
        filters.severities.delete(sev);
        btn.classList.remove("is-active");
      } else {
        filters.severities.add(sev);
        btn.classList.add("is-active");
      }
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
}

// ---------- boot ----------

setupFilterBar();

const initial = loadInitialData();
if (initial) applyData(initial);

startPolling(async () => {
  const data = await fetchJson("/api/incidentes");
  applyData(data);
});
