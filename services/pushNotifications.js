(() => {
  const BUTTON_ID = "enablePushNotifications417";

  function employee() {
    return {
      name: localStorage.getItem("employeeName") || localStorage.getItem("cleanerName") || localStorage.getItem("inspectorName") || window.OS?.user?.name || "",
      role: localStorage.getItem("employeeRole") || window.OS?.user?.role || "",
    };
  }

  function eligible(role) {
    const value = String(role || "").toLowerCase();
    return value.includes("cleaner") || value.includes("inspector") || value.includes("limpi") || value.includes("inspect");
  }

  function positionButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;

    const refreshButton = document.querySelector(".refresh-button");
    if (!refreshButton) {
      button.style.top = "88px";
      button.style.right = "16px";
      return;
    }

    const rect = refreshButton.getBoundingClientRect();
    button.style.top = `${Math.max(12, rect.bottom + 8)}px`;
    button.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
  }

  function makeButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "🔔";
    button.title = "Activar notificaciones";
    button.setAttribute("aria-label", "Activar notificaciones");
    button.style.cssText = [
      "position:fixed",
      "z-index:99999",
      "width:42px",
      "height:42px",
      "padding:0",
      "display:grid",
      "place-items:center",
      "border:1px solid rgba(255,255,255,.18)",
      "background:#111827",
      "color:#fff",
      "border-radius:50%",
      "font-size:19px",
      "line-height:1",
      "box-shadow:0 10px 24px rgba(0,0,0,.25)",
      "cursor:pointer",
      "transition:transform .18s ease, background .18s ease, opacity .18s ease"
    ].join(";");

    button.addEventListener("mouseenter", () => {
      if (!button.disabled) button.style.transform = "scale(1.08)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.transform = "scale(1)";
    });
    button.addEventListener("click", enable);

    document.body.appendChild(button);
    positionButton();
    window.addEventListener("resize", positionButton, { passive:true });
    window.addEventListener("scroll", positionButton, { passive:true });
  }

  async function enable() {
    const person = employee();
    if (!person.name) return alert("Primero entra con tu código de empleado.");
    if (!eligible(person.role)) return alert("Las notificaciones están disponibles para cleaners e inspectores.");
    if (!("serviceWorker" in navigator) || !("Notification" in window)) return alert("Este dispositivo no soporta notificaciones push web.");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return alert("Debes permitir las notificaciones en la configuración del dispositivo.");

    const configResponse = await fetch("/api/push/config", { cache:"no-store" });
    const config = await configResponse.json();
    if (!config.ok) throw new Error("No pude cargar Firebase");

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope:"/" });
    await navigator.serviceWorker.ready;

    if (!window.firebase?.apps?.length) firebase.initializeApp(config.firebaseConfig);
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey:config.vapidKey, serviceWorkerRegistration:registration });
    if (!token) throw new Error("Firebase no devolvió un token");

    const response = await fetch("/api/push/register", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ employeeName:person.name, employeeRole:person.role, token, platform:/iPhone|iPad|iPod/i.test(navigator.userAgent)?"ios-web":"web" })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "No pude registrar el dispositivo");

    localStorage.setItem("push417Enabled", "true");
    localStorage.setItem("push417Token", token);
    const button=document.getElementById(BUTTON_ID);
    if (button) {
      button.textContent="🔔";
      button.title="Notificaciones activadas";
      button.setAttribute("aria-label", "Notificaciones activadas");
      button.disabled=true;
      button.style.opacity=".72";
      button.style.background="#166534";
      button.style.cursor="default";
    }
    alert("Notificaciones push activadas en este dispositivo.");
  }

  function boot() {
    const person=employee();
    if (!eligible(person.role)) return;
    makeButton();
    if (Notification.permission === "granted" && localStorage.getItem("push417Enabled") === "true") {
      const button=document.getElementById(BUTTON_ID);
      if(button){
        button.textContent="🔔";
        button.title="Notificaciones activadas";
        button.setAttribute("aria-label", "Notificaciones activadas");
        button.disabled=true;
        button.style.opacity=".72";
        button.style.background="#166534";
        button.style.cursor="default";
      }
    }
  }

  window.addEventListener("os-ready", boot, { once:true });
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => setTimeout(boot,300)) : setTimeout(boot,300);
  window.enable417PushNotifications = enable;
})();
