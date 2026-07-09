window.NotificationCenter = {

  container: null,

  init() {

    if (this.container) return;

    this.container = document.createElement("div");
    this.container.id = "notificationCenter";

    Object.assign(this.container.style, {
      position: "fixed",
      top: "18px",
      right: "18px",
      width: "360px",
      zIndex: "999999",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      pointerEvents: "none"
    });

    document.body.appendChild(this.container);
  },

  show({
    type = "info",
    title = "",
    message = "",
    duration = 5000
  }) {

    this.init();

    const card = document.createElement("div");

    const colors = {
      success: "#16a34a",
      error: "#dc2626",
      warning: "#ea580c",
      info: "#2563eb"
    };

    card.innerHTML = `
      <div style="
        background:white;
        border-left:6px solid ${colors[type] || colors.info};
        border-radius:18px;
        padding:18px;
        box-shadow:0 12px 30px rgba(0,0,0,.18);
        font-family:-apple-system,BlinkMacSystemFont,Segoe UI;
        pointer-events:auto;
      ">
        <div style="font-weight:800;font-size:16px;margin-bottom:6px;">
          ${title}
        </div>

        <div style="font-size:14px;color:#555;">
          ${message}
        </div>
      </div>
    `;

    card.style.opacity = "0";
    card.style.transform = "translateX(80px)";
    card.style.transition = ".35s";

    this.container.prepend(card);

    requestAnimationFrame(() => {
      card.style.opacity = "1";
      card.style.transform = "translateX(0)";
    });

    setTimeout(() => {

      card.style.opacity = "0";
      card.style.transform = "translateX(60px)";

      setTimeout(() => card.remove(), 350);

    }, duration);

  }

};

window.addEventListener("DOMContentLoaded", () => {
  NotificationCenter.init();
});
