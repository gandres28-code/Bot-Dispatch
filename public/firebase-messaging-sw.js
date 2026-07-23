self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "Tienes una actualización." };
  }

  const data = payload.data || {};
  const options = {
    body: payload.body || "Tienes una actualización.",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/badge-96.png",
    tag: payload.tag || `417maid-${Date.now()}`,
    renotify: Boolean(payload.urgent),
    requireInteraction: Boolean(payload.urgent),
    vibrate: payload.urgent ? [250, 100, 250, 100, 400] : [120, 60, 120],
    data: { url: payload.url || "/launch", ...data },
  };

  event.waitUntil(self.registration.showNotification(payload.title || "417 Maid", options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "/launch";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(target) : null;
    })
  );
});
