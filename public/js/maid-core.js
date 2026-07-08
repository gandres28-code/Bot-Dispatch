window.OS = {
  user: null,

  can(permission) {
    const role = String(this.user.role || "").toLowerCase();

    const permissions = {
      cleaner: ["cleaning"],
      inspector: ["inspection"],
      "cleaner / inspector": ["cleaning", "inspection"],
      "laundry / activities / runner": ["clock"],
      "dispatch / inspector": ["inspection", "operations"],
      dispatch: ["operations", "rooms", "reports"],
      operations: ["operations", "rooms", "reports"],
      admin: ["all"],
      manager: ["all"],
    };
    require(permission) {

    if (!this.user) {

        console.log("Esperando usuario...");

        return;

    }

    if (this.can("all")) return;

    if (this.can(permission)) return;

    console.warn("Acceso denegado:", permission);

    localStorage.clear();

    window.location.href = "/launch";

},
    open(module){

    const routes={

        dashboard:"/app",

        cleaning:"/",

        inspection:"/inspector",

        operations:"/operations.html",

        master:"/master",

        clock:"/time-clock",

        payroll:"/payroll-excel",

        launch:"/launch"

    };

    const url=routes[module];

    if(!url){

        console.warn("Ruta no encontrada:",module);

        return;

    }

    window.location.href=url;

},

    const allowed = permissions[role] || [];

    return allowed.includes("all") || allowed.includes(permission);
  },

  notify({ type = "info", title = "", message = "" }) {
    console.log(`[${type}] ${title}: ${message}`);

    const event = new CustomEvent("os-notification", {
      detail: { type, title, message },
    });

    window.dispatchEvent(event);
  },

  api: {
    async get(url) {
      const response = await fetch(url);
      return response.json();
    },

    async post(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

  async loadUser(){

    const code=localStorage.getItem("employeeCode");

    if(!code){
        console.log("No hay código de empleado");
        return;
    }

    try{

        const response=await fetch(`/api/me?code=${encodeURIComponent(code)}`);

        const data=await response.json();

        if(!data.ok){

            console.log(data.message);

            return;

        }

        this.user=data.user;

        console.log("Usuario cargado",this.user);

    }

    catch(error){

        console.log(error);

    }

},

  init() {
    this.initSocket();

    console.log("417 Maid OS Core loaded", {
      user: this.user,
    });
  },
};

window.OS.init();
