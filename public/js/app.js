function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

let moduleReturnTarget = null;

async function loadAdminDashboard() {
  try {
    const response = await fetch(`/admin-dashboard-data?t=${Date.now()}`);
    const data = await response.json();
    if (!data.ok) return;
    const s = data.stats || {};
    setText("dashTotal", s.totalUnits || 0);
    setText("dashProgress", s.inProgress || 0);
    setText("dashInspect", s.awaitingInspection || 0);
    setText("dashReady", s.ready || 0);
  } catch (error) {
    console.log("Dashboard error:", error.message);
  }
}

function showPage(pageId, subtitle, navButton) {
  document.querySelectorAll(".os-page").forEach(page => page.classList.remove("active"));
  const page = document.getElementById(pageId);
  if (page) page.classList.add("active");
  document.querySelectorAll(".os-nav button").forEach(button => button.classList.remove("active"));
  if (navButton) navButton.classList.add("active");
  setText("pageSubtitle", subtitle);
  moduleReturnTarget = null;

  if (pageId === "dashboardPage") {
    const frame = document.getElementById("dashboardFrame");
    if (frame) frame.src = "/dashboard.html";
  }
}

function getOSModule(moduleName) {
  if (!window.OS || !OS.modules) return null;
  return OS.modules[moduleName] || null;
}

function openOSModule(moduleName) {
  const module = getOSModule(moduleName);
  if (!module) {
    console.warn("Módulo no encontrado:", moduleName);
    showComingSoon(moduleName);
    return;
  }

  if (module.permission !== "public" && !OS.can(module.permission) && !OS.can("all")) {
    OS.notify({ type: "warning", title: "Acceso denegado", message: "No tienes permiso para abrir este módulo." });
    return;
  }

  openModule(module.title, module.url);
}

function openDirectModule(title, url) {
  openModule(title, url);
}

function openModule(title, url, options = {}) {
  setText("moduleTitle", title);
  setText("moduleUrl", url);
  moduleReturnTarget = options.returnUrl
    ? { title: options.returnTitle || "Regresar", url: options.returnUrl }
    : null;

  const frame = document.getElementById("moduleFrame");
  if (frame) frame.src = url;

  document.querySelectorAll(".os-page").forEach(page => page.classList.remove("active"));
  const modulePage = document.getElementById("modulePage");
  if (modulePage) modulePage.classList.add("active");
  setText("pageSubtitle", title);
}

function backToDashboard() {
  if (moduleReturnTarget) {
    const target = moduleReturnTarget;
    moduleReturnTarget = null;
    openModule(target.title, target.url);
    return;
  }

  const frame = document.getElementById("moduleFrame");
  if (frame) frame.src = "about:blank";
  document.querySelectorAll(".os-page").forEach(page => page.classList.remove("active"));
  const dashboard = document.getElementById("dashboardPage");
  if (dashboard) dashboard.classList.add("active");
  const dashboardFrame = document.getElementById("dashboardFrame");
  if (dashboardFrame) dashboardFrame.src = "/dashboard.html";
  document.querySelectorAll(".os-nav button").forEach(button => button.classList.remove("active"));
  const homeButton = document.querySelector(".os-nav button");
  if (homeButton) homeButton.classList.add("active");
  setText("pageSubtitle", "Dashboard");
}

function showComingSoon(name) {
  OS.notify({ type: "info", title: "Próximamente", message: `${name} estará disponible próximamente en 417 Maid OS.` });
}

function protectAppShell() {
  if (!window.OS) return;
  setTimeout(() => {
    if (!OS.user) {
      window.location.href = "/launch";
      return;
    }
    const allowed = OS.can("operations") || OS.can("rooms") || OS.can("reports") || OS.can("all");
    if (!allowed) window.location.href = "/launch";
  }, 600);
}

function notifyOpsUpdate(event) {
  if (!window.OS || !OS.notify) return;
  const unit = event?.unit || event?.room || "";
  const employee = event?.employee || event?.person || event?.name || "Operación";
  const action = event?.action || event?.type || "Nueva actividad";
  let title = "Nueva actividad";
  let type = "info";

  if (String(action).includes("DONE")) { title = "Unidad terminada"; type = "success"; }
  else if (String(action).includes("READY")) { title = "Ready for Guest"; type = "success"; }
  else if (String(action).includes("ISSUE") || String(action).includes("REPORT")) { title = "Nuevo reporte"; type = "warning"; }
  else if (String(action).includes("START")) { title = "Actividad iniciada"; type = "info"; }

  OS.notify({ type, title, message: unit ? `${employee} · ${unit}` : "Actividad actualizada" });
}

window.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type !== "417-open-module") return;
  if (!data.url || !String(data.url).startsWith("/")) return;

  openModule(data.title || "Módulo", data.url, {
    returnTitle: data.returnTitle,
    returnUrl: data.returnUrl,
  });
});

loadAdminDashboard();
setInterval(loadAdminDashboard, 30000);

try {
  const socket = io();
  socket.on("ops-update", event => {
    loadAdminDashboard();
    notifyOpsUpdate(event);
    if (window.OSStore) OSStore.push("timeline", event, 300);
    if (window.OSEvents) OSEvents.emit("ops-update", event);
    const dashboardFrame = document.getElementById("dashboardFrame");
    if (dashboardFrame?.contentWindow?.refreshAll) dashboardFrame.contentWindow.refreshAll();
  });

  socket.on("system-notification", notification => {
    if (!window.OS || !OS.notify) return;
    OS.notify({ type: notification.type || "info", title: notification.title || "Notificación", message: notification.message || "" });
  });
} catch (error) {
  console.log(error);
}

window.addEventListener("os-user-loaded", protectAppShell);
protectAppShell();

setTimeout(() => {
  OS.notify({
    type: "info",
    title: "OS Store",
    message: OSStore?.data?.session?.user?.name
      ? `Sesión cargada: ${OSStore.data.session.user.name}`
      : "Store cargado, pero sin usuario todavía."
  });
}, 2000);
