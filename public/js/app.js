function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

let moduleReturnTarget = null;
let dashboardRequest = null;
let dashboardLastLoadedAt = 0;
let dashboardRefreshTimer = null;
let shellProtected = false;

const DASHBOARD_CACHE_MS = 15000;
const DASHBOARD_TIMEOUT_MS = 12000;

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = DASHBOARD_TIMEOUT_MS) {
  if (window.OS && typeof OS.fetchJson === "function") {
    return OS.fetchJson(url, options);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `Error del servidor (${response.status})`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function updateDashboardStats(data) {
  const s = data?.stats || {};

  setText("dashTotal", s.totalUnits || 0);
  setText("dashProgress", s.inProgress || 0);
  setText("dashInspect", s.awaitingInspection || 0);
  setText("dashReady", s.ready || 0);
}

async function loadAdminDashboard(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    dashboardLastLoadedAt &&
    now - dashboardLastLoadedAt < DASHBOARD_CACHE_MS
  ) {
    return null;
  }

  if (dashboardRequest) {
    return dashboardRequest;
  }

  dashboardRequest = (async () => {
    try {
      const data = await fetchJsonWithTimeout("/admin-dashboard-data");

      if (!data?.ok) {
        return null;
      }

      updateDashboardStats(data);
      dashboardLastLoadedAt = Date.now();

      if (window.OSStore) {
        OSStore.set("stats", data.stats || {});
      }

      return data;
    } catch (error) {
      console.log("Dashboard error:", error.message);
      return null;
    } finally {
      dashboardRequest = null;
    }
  })();

  return dashboardRequest;
}

function scheduleDashboardRefresh(forceRefresh = true, delay = 180) {
  clearTimeout(dashboardRefreshTimer);

  dashboardRefreshTimer = setTimeout(() => {
    loadAdminDashboard(forceRefresh);
  }, delay);
}

function setFrameSource(frame, url, forceReload = false) {
  if (!frame || !url) return;

  const currentUrl = frame.getAttribute("src") || "";

  if (!forceReload && currentUrl === url) {
    return;
  }

  frame.src = url;
}

function showPage(pageId, subtitle, navButton) {
  document
    .querySelectorAll(".os-page")
    .forEach(page => page.classList.remove("active"));

  const page = document.getElementById(pageId);
  if (page) page.classList.add("active");

  document
    .querySelectorAll(".os-nav button")
    .forEach(button => button.classList.remove("active"));

  if (navButton) navButton.classList.add("active");

  setText("pageSubtitle", subtitle);
  moduleReturnTarget = null;

  if (pageId === "dashboardPage") {
    const frame = document.getElementById("dashboardFrame");
    setFrameSource(frame, "/dashboard.html");
    scheduleDashboardRefresh(false, 0);
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

  const hasAccess =
    module.permission === "public" ||
    OS.can(module.permission) ||
    OS.can("all");

  if (!hasAccess) {
    OS.notify({
      type: "warning",
      title: "Acceso denegado",
      message: "No tienes permiso para abrir este módulo.",
    });
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
    ? {
        title: options.returnTitle || "Regresar",
        url: options.returnUrl,
      }
    : null;

  const frame = document.getElementById("moduleFrame");
  setFrameSource(frame, url);

  document
    .querySelectorAll(".os-page")
    .forEach(page => page.classList.remove("active"));

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

  document
    .querySelectorAll(".os-page")
    .forEach(page => page.classList.remove("active"));

  const dashboard = document.getElementById("dashboardPage");
  if (dashboard) dashboard.classList.add("active");

  const dashboardFrame = document.getElementById("dashboardFrame");
  setFrameSource(dashboardFrame, "/dashboard.html");

  document
    .querySelectorAll(".os-nav button")
    .forEach(button => button.classList.remove("active"));

  const homeButton = document.querySelector(".os-nav button");
  if (homeButton) homeButton.classList.add("active");

  setText("pageSubtitle", "Dashboard");
  scheduleDashboardRefresh(false, 0);
}

function showComingSoon(name) {
  if (!window.OS || !OS.notify) return;

  OS.notify({
    type: "info",
    title: "Próximamente",
    message: `${name} estará disponible próximamente en 417 Maid OS.`,
  });
}

function redirectToLaunch() {
  window.location.replace("/launch");
}

function protectAppShell() {
  if (shellProtected) return;

  const user = window.OS?.user;

  if (!user) {
    return;
  }

  shellProtected = true;

  const allowed =
    OS.can("operations") ||
    OS.can("rooms") ||
    OS.can("reports") ||
    OS.can("all");

  if (!allowed) {
    redirectToLaunch();
  }
}

function notifyOpsUpdate(event) {
  if (!window.OS || !OS.notify) return;

  const unit = event?.unit || event?.room || "";
  const employee =
    event?.employee ||
    event?.person ||
    event?.name ||
    "Operación";

  const action = String(
    event?.action ||
    event?.type ||
    "Nueva actividad"
  ).toUpperCase();

  let title = "Nueva actividad";
  let type = "info";

  if (action.includes("DONE")) {
    title = "Unidad terminada";
    type = "success";
  } else if (action.includes("READY")) {
    title = "Ready for Guest";
    type = "success";
  } else if (
    action.includes("ISSUE") ||
    action.includes("REPORT")
  ) {
    title = "Nuevo reporte";
    type = "warning";
  } else if (action.includes("START")) {
    title = "Actividad iniciada";
    type = "info";
  }

  OS.notify({
    type,
    title,
    message: unit
      ? `${employee} · ${unit}`
      : "Actividad actualizada",
  });
}

function refreshDashboardFrame(event = null) {
  const dashboardFrame = document.getElementById("dashboardFrame");
  const contentWindow = dashboardFrame?.contentWindow;

  if (!contentWindow) return;

  if (typeof contentWindow.applyRealtimeUpdate === "function" && event) {
    contentWindow.applyRealtimeUpdate(event);
    return;
  }

  if (typeof contentWindow.refreshAll === "function") {
    contentWindow.refreshAll();
  }
}

function bindSocketEvents() {
  const socket = window.OS?.socket;

  if (!socket || socket.__appShellBound) {
    return;
  }

  socket.__appShellBound = true;

  socket.on("ops-update", event => {
    scheduleDashboardRefresh(true);
    notifyOpsUpdate(event);

    if (window.OSStore) {
      OSStore.push("timeline", event, 300);
    }

    if (window.OSEvents) {
      OSEvents.emit("ops-update", event);
    }

    refreshDashboardFrame(event);
  });

  socket.on("system-notification", notification => {
    if (!window.OS || !OS.notify) return;

    OS.notify({
      type: notification?.type || "info",
      title: notification?.title || "Notificación",
      message: notification?.message || "",
    });
  });

  socket.on("assignments-updated", payload => {
    scheduleDashboardRefresh(true);

    if (window.OSEvents) {
      OSEvents.emit("assignments-updated", payload);
    }
  });

  socket.on("rooms-updated", payload => {
    scheduleDashboardRefresh(true);

    if (window.OSEvents) {
      OSEvents.emit("rooms-updated", payload);
    }
  });

  socket.on("room-updated", payload => {
    scheduleDashboardRefresh(true);
    refreshDashboardFrame(payload);
  });
}

function initializeAppShell() {
  protectAppShell();
  bindSocketEvents();
  loadAdminDashboard(false);
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

window.addEventListener("os-user-loaded", initializeAppShell);
window.addEventListener("os-ready", initializeAppShell);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    const age = Date.now() - dashboardLastLoadedAt;

    if (!dashboardLastLoadedAt || age > 60000) {
      scheduleDashboardRefresh(true, 100);
    }
  }
});

window.addEventListener("focus", () => {
  const age = Date.now() - dashboardLastLoadedAt;

  if (!dashboardLastLoadedAt || age > 60000) {
    scheduleDashboardRefresh(true, 100);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  initializeAppShell();
});
