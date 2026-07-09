window.OS = {
  user: null,

  modules: {
    dashboard: { title: "Dashboard", url: "/app", permission: "operations" },
    cleaning: { title: "Limpieza", url: "/", permission: "cleaning" },
    inspection: { title: "Inspecciones", url: "/inspector", permission: "inspection" },
    operations: { title: "Operaciones", url: "/operations.html", permission: "operations" },
    master: { title: "Master", url: "/master", permission: "rooms" },
    clock: { title: "Clock In/Out", url: "/time-clock", permission: "clock" },
    payroll: { title: "Nómina", url: "/payroll-excel", permission: "reports" },
    launch: { title: "Launch", url: "/launch", permission: "public" },
  },

  permissionsByRole: {
    cleaner: ["cleaning"],
    inspector: ["inspection"],

    "cleaner / inspector": ["cleaning", "inspection"],
    "inspector / cleaner": ["cleaning", "inspection"],

    "dispatch / inspector": ["inspection", "operations", "rooms", "reports"],

    "laundry / activities": ["clock"],
    "laundry / activities / runner": ["clock"],
    laundry: ["clock"],
    activities: ["clock"],
    runner: ["clock"],

    dispatch: ["operations", "rooms", "reports"],
    operations: ["operations", "rooms", "reports"],

    admin: ["all"],
    manager: ["all"],
    owner: ["all"],
    "company owner": ["all"],
  },

  normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
  },

  can(permission) {
    if (!permission) return false;
    if (!this.user) return false;

    const role = this.normalizeRole(this.user.role);
    const allowed = this.permissionsByRole[role] || [];

    return allowed.includes("all") || allowed.includes(permission);
  },

  require(permission) {
    if (!this.user) {
      console.log("Esperando usuario...");
      return false;
    }

    if (this.can("all") || this.can(permission)) {
      return true;
    }

    console.warn("Acceso denegado:", permission);
    localStorage.clear();
    window.location.href = "/launch";
    return false;
  },

  open(moduleName) {
    const module = this.modules[moduleName];

    if (!module) {
      console.warn("Módulo no encontrado:", moduleName);
      return;
    }

    const isPublic = module.permission === "public";
    const hasAccess = isPublic || this.can("all") || this.can(module.permission);

    if (!hasAccess) {
      console.warn("Acceso denegado al módulo:", moduleName);
      window.location.href = "/launch";
      return;
    }

    window.location.href = module.url;
  },

  notify({ type = "info", title = "", message = "", duration = 5000 } = {}) {
    console.log(`[${type}] ${title}: ${message}`);
    if (window.OSEvents) {
  OSEvents.emit("notification", {
    type,
    title,
    message,
    time: new Date().toISOString()
  });
}
    if (window.OSStore) {
  OSStore.push("notifications", {
    type,
    title,
    message,
    time: new Date().toISOString()
  });
}

    if (window.NotificationCenter && typeof window.NotificationCenter.show === "function") {
      window.NotificationCenter.show({ type, title, message, duration });
      return;
    }

    window.dispatchEvent(
      new CustomEvent("os-notification", {
        detail: { type, title, message, duration },
      })
    );
  },

  api: {
    async get(url) {
      const response = await fetch(url);
      return response.json();
    },

    async post(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });

      return response.json();
    },
  },

  socket: null,

  initSocket() {
    try {
      if (typeof io !== "undefined") {
        this.socket = io();
        console.log("417 Maid OS Socket connected");
      }
    } catch (error) {
      console.log("Socket error:", error.message);
    }
  },

  async loadUser() {
    const code = localStorage.getItem("employeeCode");

    if (!code) {
      console.log("No hay código de empleado");
      return;
    }

    try {
      const response = await fetch(`/api/me?code=${encodeURIComponent(code)}&t=${Date.now()}`);
      const data = await response.json();

      if (!data.ok) {
        console.log(data.message);
        this.user = null;
        return;
      }

      this.user = data.user;
      if (window.OSStore) {
  OSStore.set("session", {
    user: this.user,
    permissions: this.user.permissions || [],
    startedAt: new Date().toISOString()
  });
}

      if (this.user && this.user.code) localStorage.setItem("employeeCode", this.user.code);
      if (this.user && this.user.name) localStorage.setItem("employeeName", this.user.name);
      if (this.user && this.user.role) localStorage.setItem("employeeRole", this.user.role);

      console.log("Usuario cargado", this.user);

      window.dispatchEvent(
        new CustomEvent("os-user-loaded", {
          detail: this.user,
        })
      );

    } catch (error) {
      console.log("Error cargando usuario:", error.message);
      this.user = null;
    }
  },

  async init() {
    this.initSocket();
    await this.loadUser();

    console.log("417 Maid OS Core loaded", {
      user: this.user,
    });
  },
};

window.OS.init();
