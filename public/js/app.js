function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

async function loadAdminDashboard() {
  try {
    const response = await fetch(`/admin-dashboard-data?t=${Date.now()}`);
    const data = await response.json();

    if (!data.ok) return;

    const s = data.stats || {};

    // Compatibilidad con app.html anterior
    setText("dashTotal", s.totalUnits || 0);
    setText("dashProgress", s.inProgress || 0);
    setText("dashInspect", s.awaitingInspection || 0);
    setText("dashReady", s.ready || 0);

  } catch (error) {
    console.log("Dashboard error:", error.message);
  }
}

function showPage(pageId, subtitle, navButton) {

  document.querySelectorAll(".os-page").forEach(page => {
    page.classList.remove("active");
  });

  const page = document.getElementById(pageId);

  if (page) {
    page.classList.add("active");
  }

  document.querySelectorAll(".os-nav button").forEach(button => {
    button.classList.remove("active");
  });

  if (navButton) {
    navButton.classList.add("active");
  }

  setText("pageSubtitle", subtitle);

  // Recargar dashboard cuando se vuelva a Home
  if (pageId === "dashboardPage") {
    const frame = document.getElementById("dashboardFrame");
    if (frame) {
      frame.src = "/dashboard.html";
    }
  }
}

function openModule(title, url) {

  setText("moduleTitle", title);
  setText("moduleUrl", url);

  const frame = document.getElementById("moduleFrame");
  if (frame) {
    frame.src = url;
  }

  document.querySelectorAll(".os-page").forEach(page => {
    page.classList.remove("active");
  });

  document.getElementById("modulePage").classList.add("active");

  setText("pageSubtitle", title);
}

function backToDashboard() {

  const frame = document.getElementById("moduleFrame");

  if (frame) {
    frame.src = "about:blank";
  }

  document.querySelectorAll(".os-page").forEach(page => {
    page.classList.remove("active");
  });

  const dashboard = document.getElementById("dashboardPage");

  if (dashboard) {
    dashboard.classList.add("active");
  }

  const dashboardFrame = document.getElementById("dashboardFrame");

  if (dashboardFrame) {
    dashboardFrame.src = "/dashboard.html";
  }

  document.querySelectorAll(".os-nav button").forEach(button => {
    button.classList.remove("active");
  });

  const homeButton = document.querySelector(".os-nav button");
  if (homeButton) {
    homeButton.classList.add("active");
  }

  setText("pageSubtitle", "Dashboard");
}

function showComingSoon(name) {
  alert(`${name} estará disponible próximamente en 417 Maid OS.`);
}

// Compatibilidad
loadAdminDashboard();
setInterval(loadAdminDashboard, 30000);

try {
  const socket = io();

  socket.on("ops-update", () => {
    loadAdminDashboard();

    const dashboardFrame = document.getElementById("dashboardFrame");

    if (dashboardFrame &&
        dashboardFrame.contentWindow &&
        dashboardFrame.contentWindow.refreshAll) {

      dashboardFrame.contentWindow.refreshAll();
    }
  });

} catch (error) {
  console.log(error);
}
setTimeout(() => {
  if (!OS.user) return;

  if (!OS.can("operations") && !OS.can("all")) {
    window.location.href = "/launch";
  }
}, 800);
