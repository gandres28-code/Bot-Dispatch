importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBYyhUn3Mt1jPnGaVzjUXtBw3gUfiQBivA",
  authDomain: "dispatch-7c98d.firebaseapp.com",
  projectId: "dispatch-7c98d",
  storageBucket: "dispatch-7c98d.firebasestorage.app",
  messagingSenderId: "968016054452",
  appId: "1:968016054452:web:68d3c972753a40f715efe1"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(notification.title || "417 Maid", {
    body: notification.body || "Tienes una actualización.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.type ? `${data.type}-${data.unit || "update"}` : "417-maid-update",
    data: { url: data.link || "/launch", ...data },
    vibrate: data.type === "URGENT" ? [250,100,250,100,400] : [120,60,120],
    requireInteraction: data.type === "URGENT"
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/launch";
  event.waitUntil(clients.matchAll({ type:"window", includeUncontrolled:true }).then(list => {
    for (const client of list) {
      if ("focus" in client) { client.navigate(target); return client.focus(); }
    }
    return clients.openWindow ? clients.openWindow(target) : null;
  }));
});
