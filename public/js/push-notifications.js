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

  function makeButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "🔔 Activar notificaciones";
    button.style.cssText = "position:fixed;right:16px;bottom:84px;z-index:99999;border:1px solid rgba(255,255,255,.16);background:#111827;color:#fff;padding:12px 16px;border-radius:999px;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.28);cursor:pointer";
    button.addEventListener("click", enable);
    document.body.appendChild(button);
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
    if (button) { button.textContent="🔔 Notificaciones activadas"; button.disabled=true; button.style.opacity=".72"; }
    alert("Notificaciones push activadas en este dispositivo.");
  }

  function boot() {
    const person=employee();
    if (!eligible(person.role)) return;
    makeButton();
    if (Notification.permission === "granted" && localStorage.getItem("push417Enabled") === "true") {
      const button=document.getElementById(BUTTON_ID);
      if(button){button.textContent="🔔 Notificaciones activadas";button.disabled=true;button.style.opacity=".72";}
    }
  }

  window.addEventListener("os-ready", boot, { once:true });
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => setTimeout(boot,300)) : setTimeout(boot,300);
  window.enable417PushNotifications = enable;
})();
