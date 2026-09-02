const HOME_TAB_KEY = "antigen.home.tab";

function openHomeTab(name, updateHash = false) {
  const target = document.querySelector(`[data-home-pane="${name}"]`);
  if (!target) return;
  document.querySelectorAll("[data-home-pane]").forEach((pane) => {
    const active = pane === target;
    pane.hidden = !active;
    pane.classList.toggle("is-active", active);
  });
  document.querySelectorAll("[data-home-tab]").forEach((button) => {
    const active = button.dataset.homeTab === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  sessionStorage.setItem(HOME_TAB_KEY, name);
  if (updateHash) history.replaceState(null, "", name === "operations" ? location.pathname : `#${name}`);
}

document.querySelectorAll("[data-home-tab]").forEach((button) => button.addEventListener("click", () => openHomeTab(button.dataset.homeTab, true)));
document.querySelectorAll("[data-home-tab-target]").forEach((element) => element.addEventListener("click", (event) => {
  event.preventDefault();
  openHomeTab(element.dataset.homeTabTarget, true);
  if (element.dataset.incidentShortcut && window.applyIncidentShortcut) window.applyIncidentShortcut(element.dataset.incidentShortcut);
}));

const hashTab = location.hash.replace("#", "");
openHomeTab(["operations", "capacity", "incidents"].includes(hashTab) ? hashTab : (sessionStorage.getItem(HOME_TAB_KEY) || "operations"));
window.addEventListener("hashchange", () => {
  const tab = location.hash.replace("#", "");
  if (["operations", "capacity", "incidents"].includes(tab)) openHomeTab(tab);
});
