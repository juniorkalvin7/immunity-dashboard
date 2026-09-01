let resourceData = [];
let resourceGroups = [];
let resourceView = "all";
let resourcePage = 1;
let resourcePageSize = 30;
let resourceSort = { key: "severity", dir: "desc" };
const resourceFilters = { search: "", group: "", severity: "" };

function loadResourcesInitial() {
  const el = document.getElementById("recursos-initial-data");
  try { return el ? JSON.parse(el.textContent) : null; } catch (_) { return null; }
}

function resourceKind(row) {
  const text = `${row.name} ${(row.tags || []).join(" ")}`.toLowerCase();
  if (/cpu|load/.test(text)) return ["CPU", "cpu"];
  if (/memory|memória|memoria|swap/.test(text)) return ["Memória", "memory"];
  if (/disk|disco|storage|filesystem|file system/.test(text)) return ["Disco", "disk"];
  if (/vpn|ipsec/.test(text)) return ["VPN", "link"];
  if (/interface|port|network|rede|unreachable|offline|down/.test(text)) return ["Disponibilidade", "serverOff"];
  if (/service|serviço|servico|not running/.test(text)) return ["Serviço", "settings"];
  return ["Monitor", "activity"];
}

function applyResources(data) {
  resourceData = data.resources || [];
  resourceGroups = data.groups || [];
  document.getElementById("res-total").textContent = data.summary.total;
  document.getElementById("res-unhandled").textContent = data.summary.unhandled;
  document.getElementById("res-resource").textContent = data.summary.resource_problems;
  document.getElementById("res-critical").textContent = data.summary.critical;
  document.getElementById("tab-unhandled").textContent = data.summary.unhandled;
  document.getElementById("tab-resource").textContent = data.summary.resource_problems;
  const group = document.getElementById("res-group");
  const selected = group.value;
  group.innerHTML = '<option value="">Todos os grupos</option>' + resourceGroups.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if (resourceGroups.includes(selected)) group.value = selected;
  renderResources();
}

function filteredResources() {
  const query = resourceFilters.search.toLowerCase().trim();
  return resourceData.filter((row) => {
    if (resourceView === "unhandled" && row.acknowledged) return false;
    if (resourceView === "resource" && !row.is_resource_problem) return false;
    if (resourceFilters.group && row.group_name !== resourceFilters.group) return false;
    if (resourceFilters.severity && String(row.severity) !== resourceFilters.severity) return false;
    if (query && !`${row.host_name} ${row.group_name} ${row.name} ${(row.tags || []).join(" ")}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function sortedResources(rows) {
  const direction = resourceSort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let left = a[resourceSort.key], right = b[resourceSort.key];
    if (resourceSort.key === "clock" || resourceSort.key === "severity") { left = Number(left); right = Number(right); }
    if (resourceSort.key === "acknowledged") { left = left ? 1 : 0; right = right ? 1 : 0; }
    return typeof left === "string" ? left.localeCompare(right) * direction : (left - right) * direction;
  });
}

function renderResources() {
  const filtered = filteredResources();
  const sorted = sortedResources(filtered);
  const totalPages = Math.max(1, Math.ceil(sorted.length / resourcePageSize));
  resourcePage = Math.min(resourcePage, totalPages);
  const start = (resourcePage - 1) * resourcePageSize;
  const rows = sorted.slice(start, start + resourcePageSize);
  document.getElementById("res-results").textContent = `${filtered.length} resultado${filtered.length === 1 ? "" : "s"}`;
  const body = document.getElementById("resource-rows");
  body.innerHTML = rows.length ? rows.map((row) => {
    const [kind, icon] = resourceKind(row);
    return `<tr class="resource-row sev-row-${row.severity_name}">
      <td><span class="sev-solid sev-solid-${row.severity_name}">${escapeHtml(row.severity_name)}</span></td>
      <td><strong class="resource-host" title="${escapeHtml(row.host_name)}">${escapeHtml(row.host_name)}</strong></td>
      <td><span class="resource-group" title="${escapeHtml(row.group_name)}">${escapeHtml(row.group_name)}</span></td>
      <td><span class="resource-kind"><i data-icon="${icon}"></i>${kind}</span></td>
      <td><span class="resource-info" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span></td>
      <td><span class="duration-cell">${ICONS.clock}${escapeHtml(row.duration)}</span></td>
      <td>${row.acknowledged ? '<span class="status-chip status-ok">'+ICONS.checkCircle+'Reconhecido</span>' : '<span class="status-chip status-new">'+ICONS.circle+'Não tratado</span>'}</td>
      <td>${row.acknowledged ? "—" : `<button class="ack-btn" data-eventid="${row.eventid}">Reconhecer</button>`}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="8" class="empty">Nenhum recurso encontrado nesta visão</td></tr>';
  hydrateIcons(body);
  body.querySelectorAll(".ack-btn").forEach((button) => button.addEventListener("click", acknowledgeResource));
  renderResourcePagination(filtered.length, totalPages);
}

function renderResourcePagination(total, pages) {
  const start = total ? (resourcePage - 1) * resourcePageSize + 1 : 0;
  const end = Math.min(resourcePage * resourcePageSize, total);
  document.getElementById("resource-pagination").innerHTML = `<span>${start}–${end} de ${total}</span><div><button id="res-prev" ${resourcePage === 1 ? "disabled" : ""}>←</button><strong>${resourcePage} / ${pages}</strong><button id="res-next" ${resourcePage === pages ? "disabled" : ""}>→</button><select id="res-page-size"><option ${resourcePageSize===15?"selected":""}>15</option><option ${resourcePageSize===30?"selected":""}>30</option><option ${resourcePageSize===50?"selected":""}>50</option></select></div>`;
  document.getElementById("res-prev").onclick = () => { resourcePage--; renderResources(); };
  document.getElementById("res-next").onclick = () => { resourcePage++; renderResources(); };
  document.getElementById("res-page-size").onchange = (event) => { resourcePageSize = Number(event.target.value); resourcePage = 1; renderResources(); };
}

async function acknowledgeResource(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch(`/api/incidentes/${button.dataset.eventid}/ack`, { method: "POST" });
    if (!response.ok) throw new Error("Falha ao reconhecer");
    const row = resourceData.find((item) => item.eventid === button.dataset.eventid);
    if (row) row.acknowledged = true;
    renderResources();
  } catch (error) { button.disabled = false; setConnStatus(false, error.message); }
}

document.querySelectorAll("#resource-view-tabs button").forEach((button) => button.addEventListener("click", () => {
  resourceView = button.dataset.view; resourcePage = 1;
  document.querySelectorAll("#resource-view-tabs button").forEach((item) => item.classList.toggle("is-active", item === button));
  renderResources();
}));
document.getElementById("res-search").addEventListener("input", (event) => { resourceFilters.search = event.target.value; resourcePage = 1; renderResources(); });
document.getElementById("res-group").addEventListener("change", (event) => { resourceFilters.group = event.target.value; resourcePage = 1; renderResources(); });
document.getElementById("res-severity").addEventListener("change", (event) => { resourceFilters.severity = event.target.value; resourcePage = 1; renderResources(); });
document.querySelectorAll("#resource-table th[data-sort]").forEach((header) => header.addEventListener("click", () => { const key = header.dataset.sort; resourceSort = resourceSort.key === key ? { key, dir: resourceSort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }; renderResources(); }));

const resourcesInitial = loadResourcesInitial();
if (resourcesInitial) applyResources(resourcesInitial);
startPolling(async () => applyResources(await fetchJson("/api/recursos")));
