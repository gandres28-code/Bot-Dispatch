require("dotenv").config();
const express = require("express");
const { Client } = require("@notionhq/client");
const OpenAI = require("openai");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const EmployeeService = require("./services/employeeService");
const { createOSCore } = require("./services/osCore/index.js");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const OSCore = createOSCore({
  io,
  config: {
    cacheTtlMs: process.env.CORE_CACHE_TTL_MS,
    cacheMaxEntries: process.env.CORE_CACHE_MAX_ENTRIES,
    notionConcurrency: process.env.CORE_NOTION_CONCURRENCY,
    notionMinDelayMs: process.env.CORE_NOTION_MIN_DELAY_MS,
    notionMaxQueueSize: process.env.CORE_NOTION_MAX_QUEUE_SIZE,
  },
});

console.log("417 Maid Core iniciado:", OSCore.version, OSCore.mode);

function coreDeleteKeys(...keys) {
  let deleted = 0;

  for (const key of keys.flat().filter(Boolean)) {
    if (OSCore?.cache?.delete?.(String(key))) {
      deleted += 1;
    }
  }

  return deleted;
}

function coreInvalidateTags(...tags) {
  let removed = 0;

  for (const tag of tags.flat().filter(Boolean)) {
    removed += Number(
      OSCore?.cache?.invalidateTag?.(String(tag)) || 0
    );
  }

  return removed;
}
let systemNotifications = [];
let systemTimeline = [];
function addNotification(title, message) {
  const notification = {
    id: Date.now(),
    title,
    message,
    time: new Date().toLocaleTimeString(),
  };

  systemNotifications.unshift(notification);

  if (systemNotifications.length > 100) {
    systemNotifications.pop();
  }

  io.emit("system-notification", notification);
}
app.get("/notifications-data", (req, res) => {
  res.json({
    ok: true,
    notifications: systemNotifications,
  });
});
app.get("/api/timeline", (req, res) => {
  res.json({
    ok: true,
    timeline: systemTimeline.slice(0, 100),
  });
});

app.get("/api/core-status", (req, res) => {
  res.json(OSCore.status());
});

app.get("/api/cache-status", (req, res) => {
  res.json({
    ok: true,
    rooms: ServerCache.rooms.size,
    employees: ServerCache.employees.size,
    dashboard: ServerCache.dashboard.size,
    assignments: ServerCache.assignments.size,
    timeline: systemTimeline.length,
    notifications: systemNotifications.length,
  });
});
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const upload = multer({ storage: multer.memoryStorage() });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
// ■ Anti duplicados
const recentActions = new Map();
const cacheStore = new Map();

// Evita que varias pantallas hagan la misma consulta a Notion al mismo tiempo.
// Todos esperan la misma promesa en vez de formar una fila de llamadas duplicadas.
const inFlightRequests = new Map();

async function singleFlight(key, task) {
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key);
  }

  const promise = Promise.resolve()
    .then(task)
    .finally(() => inFlightRequests.delete(key));

  inFlightRequests.set(key, promise);
  return promise;
}

// =========================================================
// SERVER CACHE ENGINE v1
// =========================================================
// Cache en memoria RAM para reducir llamadas repetidas a Notion.
// Este cache vive mientras Render mantiene vivo el servidor.
// Si Render reinicia, el cache se reconstruye automáticamente.
const ServerCache = {
  rooms: new Map(),
  employees: new Map(),
  dashboard: new Map(),
  assignments: new Map(),

  get(section, key) {
    const bucket = this[section];

    if (!bucket || typeof bucket.get !== "function") {
      return null;
    }

    return bucket.get(key) || null;
  },

  set(section, key, value) {
    if (!this[section] || typeof this[section].set !== "function") {
      this[section] = new Map();
    }

    this[section].set(key, {
      value,
      updatedAt: new Date().toISOString(),
    });
  },

  clear(section, key = null) {
    const bucket = this[section];

    if (!bucket || typeof bucket.clear !== "function") {
      return;
    }

    if (key) {
      bucket.delete(key);
      return;
    }

    bucket.clear();
  },
};

function getCache(key){
  const item = cacheStore.get(key);

  if(!item){
    return null;
  }

  if(Date.now() > item.expiresAt){
    cacheStore.delete(key);
    return null;
  }

  return item.data;
}

function setCache(key, data, ttlMs = 5000){
  cacheStore.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

function clearOpsCache(){
  // Borra sólo datos operativos que deben reflejarse inmediatamente.
  // Los schemas y empleados permanecen en cache para proteger a Notion.
  for (const key of Array.from(cacheStore.keys())) {
    const cacheKey = String(key);
    if (
      cacheKey.startsWith("ops:") ||
      cacheKey.startsWith("notifications:") ||
      cacheKey.startsWith("dashboard:data:") ||
      cacheKey.startsWith("dashboard:reports:") ||
      cacheKey.startsWith("dashboard:payroll:") ||
      cacheKey.startsWith("dashboard:timeclock:")
    ) {
      cacheStore.delete(key);
    }
  }

  if (typeof ServerCache !== "undefined") {
    ServerCache.clear("dashboard");
  }

  coreInvalidateTags("dashboard", "operations");
}

function clearRoomCache(date = todayISO()){
  cacheStore.delete(`todayRooms:${date}`);
  cacheStore.delete(`roomsByDate:${date}`);
  cacheStore.delete(`dashboard:data:${date}`);
  cacheStore.delete("master-units");

  if (typeof ServerCache !== "undefined") {
    ServerCache.clear("rooms", date);
    ServerCache.clear("dashboard");
    ServerCache.clear("assignments");
  }

  coreInvalidateTags(`rooms:${date}`, `assignments:${date}`, "dashboard");
}

// =========================================================
// CACHE DE ASIGNACIONES EN TIEMPO REAL
// =========================================================
function clearAssignmentCaches(date = todayISO()) {
  for (const key of Array.from(cacheStore.keys())) {
    const cacheKey = String(key);

    if (
      cacheKey.startsWith("cleaner-assignments:") ||
      cacheKey.startsWith("inspector-assignments:") ||
      cacheKey === `todayRooms:${date}` ||
      cacheKey === `roomsByDate:${date}`
    ) {
      cacheStore.delete(key);
    }
  }

  if (typeof ServerCache !== "undefined") {
    ServerCache.clear("rooms", date);
    ServerCache.clear("assignments");
    ServerCache.clear("dashboard");
  }

  coreInvalidateTags(`rooms:${date}`, `assignments:${date}`, "dashboard");
}

function broadcastAssignmentUpdate(reason = "notion-change", extra = {}) {
  const date = todayISO();
  clearAssignmentCaches(date);

  const payload = {
    reason,
    date,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  io.emit("assignments-updated", payload);
  io.emit("rooms-updated", payload);
}
function broadcastOpsUpdate(payload = {}) {
  clearOpsCache();

  const event = {
    id: Date.now(),
    time: new Date().toISOString(),
    type: payload.type || "ops-update",
    action: payload.action || "",
    unit: payload.unit || "",
    employee: payload.employee || payload.person || "",
    message: payload.message || payload.note || "",
    ...payload,
  };
systemTimeline.unshift(event);

if (systemTimeline.length > 300) {
  systemTimeline.pop();
}
  io.emit("ops-update", event);

  systemNotifications.unshift({
    id: event.id,
    title: getNotificationTitle(event),
    message: getNotificationMessage(event),
    time: new Date().toLocaleTimeString(),
    event,
  });

  if (systemNotifications.length > 100) {
    systemNotifications.pop();
  }

  io.emit("system-notification", systemNotifications[0]);
}
function getNotificationTitle(event) {

  switch(event.type){

    case "action":
      return "📋 Nueva acción";

    case "report":
      return "📨 Nuevo reporte";

    case "hotsos-sent":
      return "✅ HotSOS";

    default:
      return "🔔 Sistema";
  }

}

function getNotificationMessage(event){

  if(event.unit && event.employee){
    return `${event.employee} • ${event.unit}`;
  }

  if(event.unit){
    return `Unidad ${event.unit}`;
  }

  return "Nueva actividad registrada";
}
const cors = require("cors");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
// ■ Carpeta para PDFs
const reportsDir = path.join(__dirname, "reports");
if (!fs.existsSync(reportsDir)) {
fs.mkdirSync(reportsDir);
}
app.use("/reports", express.static(reportsDir));
// ■ Carpeta para Excel de nómina
const payrollDir = path.join(__dirname, "payroll_exports");
if (!fs.existsSync(payrollDir)) {
fs.mkdirSync(payrollDir);
}
app.use("/payroll_exports", express.static(payrollDir));
// ■ ENV
const NOTION_API_KEY =
process.env.NOTION_API_KEY ||
process.env.NOTION_TOKEN ||
"";
const NOTION_DATABASE_ID =
process.env.NOTION_DATABASE_ID ||
process.env.DATABASE_ID ||
"37f25b5a514a8092ad64e6a8d478dc76";
const NOTION_LOG_DATABASE_ID =
process.env.NOTION_LOG_DATABASE_ID ||
process.env.NOTION_DAILY_CLEANING_LOGS_DB_ID ||
"";
const NOTION_PAYROLL_DATABASE_ID =
process.env.NOTION_PAYROLL_DATABASE_ID ||
process.env.NOTION_PAYROLL_RECORDS_DB_ID ||
"";
const NOTION_TIME_CLOCK_DATABASE_ID =
  process.env.NOTION_TIME_CLOCK_DATABASE_ID || "";

const NOTION_EMPLOYEES_DATABASE_ID =
  process.env.NOTION_EMPLOYEES_DATABASE_ID || "";
const NOTION_REPORTS_DATABASE_ID =
  process.env.NOTION_REPORTS_DB_ID ||
  process.env.NOTION_REPORTS_DATABASE_ID ||
  process.env.NOTION_REPORT_MESSAGES_DB_ID ||
  "";
const NOTION_REPORT_PHOTOS_DATABASE_ID =
  process.env.NOTION_REPORT_PHOTOS_DB_ID ||
  process.env.NOTION_REPORT_PHOTOS_DATABASE_ID ||
  "";
const OPENAI_API_KEY =
process.env.OPENAI_API_KEY || "";
console.log("■ ENV CHECK");
console.log("NOTION_API_KEY existe:", !!NOTION_API_KEY);
console.log("NOTION_DATABASE_ID existe:", !!NOTION_DATABASE_ID);
console.log("NOTION_LOG_DATABASE_ID existe:", !!NOTION_LOG_DATABASE_ID);
console.log("NOTION_PAYROLL_DATABASE_ID existe:", !!NOTION_PAYROLL_DATABASE_ID);
console.log("NOTION_TIME_CLOCK_DATABASE_ID existe:", !!NOTION_TIME_CLOCK_DATABASE_ID);
console.log("NOTION_EMPLOYEES_DATABASE_ID existe:", !!NOTION_EMPLOYEES_DATABASE_ID);
console.log("NOTION_REPORTS_DATABASE_ID existe:", !!NOTION_REPORTS_DATABASE_ID);
console.log("NOTION_REPORT_PHOTOS_DATABASE_ID existe:", !!NOTION_REPORT_PHOTOS_DATABASE_ID);
console.log("OPENAI_API_KEY existe:", !!OPENAI_API_KEY);
console.log("PAYROLL RAW:", process.env.NOTION_PAYROLL_DATABASE_ID);
const notion = new Client({ auth: NOTION_API_KEY });

// =========================================================
// PROTECCIÓN URGENTE CONTRA NOTION RATE_LIMITED (429)
// =========================================================
// Notion aguanta pocas llamadas por segundo. Este bloque pone una fila única,
// reintentos automáticos y pausa inteligente cuando Notion dice "rate_limited".
const NOTION_MIN_DELAY_MS = Number(process.env.NOTION_MIN_DELAY_MS || 450);
const NOTION_MAX_RETRIES = Number(process.env.NOTION_MAX_RETRIES || 6);
let notionQueue = Promise.resolve();
let lastNotionRequestAt = 0;

function isNotionRateLimitError(error) {
  return (
    error?.code === "rate_limited" ||
    error?.status === 429 ||
    error?.body?.code === "rate_limited" ||
    String(error?.message || "").toLowerCase().includes("rate limited")
  );
}

function getRetryAfterMs(error, attempt) {
  const retryAfter =
    Number(error?.headers?.["retry-after"]) ||
    Number(error?.response?.headers?.["retry-after"]);

  if (retryAfter && retryAfter > 0) {
    return retryAfter * 1000;
  }

  return Math.min(30000, 1500 * Math.pow(2, attempt));
}

async function runNotionTask(taskName, fn) {
  const run = async () => {
    const waitMs = Math.max(0, NOTION_MIN_DELAY_MS - (Date.now() - lastNotionRequestAt));
    if (waitMs > 0) await sleep(waitMs);
    lastNotionRequestAt = Date.now();

    for (let attempt = 0; attempt <= NOTION_MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (!isNotionRateLimitError(error) || attempt >= NOTION_MAX_RETRIES) {
          throw error;
        }

        const delay = getRetryAfterMs(error, attempt);
        console.log(`⏳ Notion rate limited en ${taskName}. Reintentando en ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
      }
    }
  };

  const resultPromise = notionQueue.then(run, run);
  notionQueue = resultPromise.catch(() => {});
  return resultPromise;
}

function patchNotionClientForRateLimits(client) {
  const wrap = (group, method) => {
    const original = client[group][method].bind(client[group]);
    client[group][method] = (args) => runNotionTask(`${group}.${method}`, () => original(args));
  };

  wrap("databases", "query");
  wrap("databases", "retrieve");
  wrap("pages", "create");
  wrap("pages", "update");
  wrap("pages", "retrieve");
}

patchNotionClientForRateLimits(notion);

async function notionFetch(url, options = {}, taskName = "fetch") {
  return runNotionTask(taskName, async () => {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const error = new Error("Notion rate_limited");
      error.status = 429;
      error.headers = {
        "retry-after": response.headers.get("retry-after"),
      };
      throw error;
    }

    return response;
  });
}


// =========================================================
// FIX NOTION 2025: DATABASES CON MULTIPLE DATA SOURCES
// =========================================================
// Notion cambió su API: una Database ahora puede tener varias Data Sources.
// Si una base tiene multiple data sources, notion.databases.query falla.
// Estos helpers resuelven automáticamente el data_source_id correcto y usan
// /v1/data_sources/{id}/query con Notion-Version 2025-09-03.
const NOTION_API_VERSION = process.env.NOTION_API_VERSION || "2025-09-03";
const notionDataSourceCache = new Map();

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_API_VERSION,
  };
}

async function notionRest(pathValue, options = {}, taskName = "notion.rest") {
  const response = await notionFetch(
    `https://api.notion.com/v1${pathValue}`,
    {
      ...options,
      headers: {
        ...notionHeaders(),
        ...(options.headers || {}),
      },
    },
    taskName
  );

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data.message || `Notion error ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    error.body = data;
    throw error;
  }

  return data;
}

function idWithoutDashes(id) {
  return String(id || "").replace(/-/g, "");
}

async function resolveDataSourceId(databaseOrDataSourceId) {
  const rawId = String(databaseOrDataSourceId || "").trim();
  if (!rawId) return rawId;

  const cacheKey = `dataSource:${idWithoutDashes(rawId)}`;
  const cached = getCache(cacheKey) || notionDataSourceCache.get(cacheKey);
  if (cached) return cached;

  try {
    const db = await notionRest(
      `/databases/${rawId}`,
      { method: "GET" },
      "databases.retrieve.2025"
    );

    const firstDataSourceId =
      db.data_sources?.[0]?.id ||
      db.data_sources?.[0]?.data_source_id ||
      db.data_sources?.[0];

    const resolved = firstDataSourceId || rawId;
    notionDataSourceCache.set(cacheKey, resolved);
    setCache(cacheKey, resolved, 10 * 60 * 1000);
    return resolved;
  } catch (error) {
    // Si el ID ya era un data_source_id, /databases/{id} puede fallar.
    // En ese caso lo usamos directamente.
    console.log("⚠️ No pude resolver database->data_source, usando ID directo:", rawId, error.message);
    notionDataSourceCache.set(cacheKey, rawId);
    setCache(cacheKey, rawId, 10 * 60 * 1000);
    return rawId;
  }
}

async function queryNotionDatabaseCompat(args) {
  const dataSourceId = await resolveDataSourceId(args.database_id || args.data_source_id);
  const { database_id, data_source_id, ...body } = args;

  return notionRest(
    `/data_sources/${dataSourceId}/query`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    "data_sources.query"
  );
}

async function retrieveNotionDatabaseSchemaCompat(args) {
  const dataSourceId = await resolveDataSourceId(args.database_id || args.data_source_id);

  return notionRest(
    `/data_sources/${dataSourceId}`,
    { method: "GET" },
    "data_sources.retrieve"
  );
}

async function createNotionPageCompat(args) {
  const payload = { ...args };

  if (payload.parent?.database_id) {
    const dataSourceId = await resolveDataSourceId(payload.parent.database_id);
    payload.parent = {
      type: "data_source_id",
      data_source_id: dataSourceId,
    };
  }

  return notionRest(
    "/pages",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "pages.create.2025"
  );
}

// Sobrescribir sólo estas llamadas para que el resto de tu código no cambie.
// Mantiene el mismo formato viejo: notion.databases.query({ database_id, ... })
notion.databases.query = queryNotionDatabaseCompat;
notion.databases.retrieve = retrieveNotionDatabaseSchemaCompat;
notion.pages.create = createNotionPageCompat;

const openai = new OpenAI({
apiKey: OPENAI_API_KEY || "no-key",
});
// ■ Página principal limpiadores
app.get("/notifications", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "notifications.html"));
});
app.get("/login-role", async (req, res) => {
  try {
    const login = String(req.query.code || "").trim();

    if (!login) {
      return res.json({
        ok: false,
        message: "Nombre o código requerido",
      });
    }

    if (!NOTION_EMPLOYEES_DATABASE_ID) {
      return res.json({
        ok: false,
        message: "Falta NOTION_EMPLOYEES_DATABASE_ID en Render",
      });
    }

    const employee = await findEmployeeByLogin(login);

    if (employee) {
      const user = pageToUser(employee);

      if (!user.active) {
        return res.json({
          ok: false,
          message: "Empleado inactivo",
        });
      }

      return res.json({
        ok: true,
        id: user.id,
        name: user.name,
        role: user.role,
        code: user.code,
        active: user.active,
        permissions: user.permissions,
        home: user.home,
      });
    }

    // Fallback temporal: permite que un cleaner que todavía no esté en Employees
    // entre por nombre si aparece asignado en la página principal del día.
    // Recomendación: mover todos los cleaners a Employees con código.
    const normalizedLogin = cleanEmployeeText(login);
    const mainDbId = NOTION_DATABASE_ID;

    if (mainDbId) {
      const assignmentsResponse = await notion.databases.query({
        database_id: mainDbId,
        page_size: 100,
      });

      for (const page of assignmentsResponse.results || []) {
        const props = page.properties || {};

        const assignedCleaner =
          props["Assigned Cleaner"]?.rich_text?.map((t) => t.plain_text).join("").trim() ||
          props["Assigned Cleaner"]?.select?.name ||
          props["Assigned Cleaner"]?.multi_select?.map((s) => s.name).join(", ") ||
          props["Assigned Cleaner"]?.people?.map((p) => p.name).join(", ") ||
          props["assigned cleaner"]?.rich_text?.map((t) => t.plain_text).join("").trim() ||
          props["assigned cleaner"]?.select?.name ||
          props["assigned cleaner"]?.multi_select?.map((s) => s.name).join(", ") ||
          "";

        const cleaners = assignedCleaner
          .split(",")
          .map((name) => cleanEmployeeText(name))
          .filter(Boolean);

        if (cleaners.includes(normalizedLogin)) {
          return res.json({
            ok: true,
            id: "",
            name: login,
            role: "Cleaner",
            code: "",
            active: true,
            permissions: ["cleaning"],
            home: "cleaner",
          });
        }
      }
    }

    return res.json({
      ok: false,
      message: "Nombre o código no encontrado o empleado inactivo",
    });
  } catch (error) {
    console.error("LOGIN ROLE ERROR:", error);
    return res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.post("/refresh-employees", async (req, res) => {
  try {
    clearEmployeesCache();
    const employees = await getEmployeesCached(true);

    const payload = {
      ok: true,
      count: employees.length,
      updatedAt: new Date().toISOString(),
      message: "Empleados actualizados",
    };

    io.emit("employees-updated", payload);
    return res.json(payload);
  } catch (error) {
    console.error("Error en /refresh-employees:", error.message);

    return res.status(500).json({
      ok: false,
      message: "No se pudieron actualizar los empleados",
      error: error.message,
    });
  }
});

app.get("/launch", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "launch.html"));
});
app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});
app.get("/", (req, res) => {
res.sendFile(__dirname + "/public/index.html");
});
// ■ Página inspectores
app.get("/inspector", (req, res) => {
res.sendFile(__dirname + "/public/inspector.html");
});
app.get("/master", (req, res) => {
  res.sendFile(__dirname + "/public/master.html");
});
// ■ Diagnóstico seguro
app.get("/debug-env", (req, res) => {
res.json({
notionApiKeyExists: !!NOTION_API_KEY,
notionDatabaseIdExists: !!NOTION_DATABASE_ID,
notionLogDatabaseIdExists: !!NOTION_LOG_DATABASE_ID,
notionPayrollDatabaseIdExists: !!NOTION_PAYROLL_DATABASE_ID,
notionReportsDatabaseIdExists: !!NOTION_REPORTS_DATABASE_ID,
notionReportPhotosDatabaseIdExists: !!NOTION_REPORT_PHOTOS_DATABASE_ID,
openAiKeyExists: !!OPENAI_API_KEY,
notionDatabaseIdPreview: NOTION_DATABASE_ID
? NOTION_DATABASE_ID.slice(0, 6) + "..." + NOTION_DATABASE_ID.slice(-6)
: null,
notionLogDatabaseIdPreview: NOTION_LOG_DATABASE_ID
? NOTION_LOG_DATABASE_ID.slice(0, 6) + "..." + NOTION_LOG_DATABASE_ID.slice(-6)
: null,
notionPayrollDatabaseIdPreview: NOTION_PAYROLL_DATABASE_ID
? NOTION_PAYROLL_DATABASE_ID.slice(0, 6) + "..." + NOTION_PAYROLL_DATABASE_ID.slice(-6)
: null,
notionReportsDatabaseIdPreview: NOTION_REPORTS_DATABASE_ID
? NOTION_REPORTS_DATABASE_ID.slice(0, 6) + "..." + NOTION_REPORTS_DATABASE_ID.slice(-6)
: null,
notionReportPhotosDatabaseIdPreview: NOTION_REPORT_PHOTOS_DATABASE_ID
? NOTION_REPORT_PHOTOS_DATABASE_ID.slice(0, 6) + "..." + NOTION_REPORT_PHOTOS_DATABASE_ID.slice(-6)
: null,
});
});
app.get("/api/me", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(401).json({
        ok: false,
        message: "Código requerido",
      });
    }

    const employeePage = await findEmployeeByCode(code);

    if (!employeePage) {
      return res.status(404).json({
        ok: false,
        message: "Empleado no encontrado",
      });
    }

    const user = pageToUser(employeePage);

    if (!user.active) {
      return res.status(403).json({
        ok: false,
        message: "Empleado inactivo",
      });
    }

    res.json({
      ok: true,
      user,
    });
  } catch (error) {
    console.error("Error en /api/me:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.get("/api/bootstrap", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(401).json({
        ok: false,
        message: "Código requerido",
      });
    }

    const meResponse = await EmployeeService.findEmployeeByCode(
      notion,
      NOTION_EMPLOYEES_DATABASE_ID,
      code
    );

    if (!meResponse) {
      return res.status(404).json({
        ok: false,
        message: "Empleado no encontrado",
      });
    }

    const user = EmployeeService.pageToEmployee(meResponse);

    if (!user.active) {
      return res.status(403).json({
        ok: false,
        message: "Empleado inactivo",
      });
    }

    const stats = {};
    const assignments = [];
    const notifications = systemNotifications.slice(0, 50);

    res.json({
      ok: true,
      session: {
        user,
        permissions: user.permissions || [],
        startedAt: new Date().toISOString(),
      },
      assignments,
      stats,
      notifications,
timeline: systemTimeline.slice(0, 100),
      hotel: {
        name: "Default Hotel",
      },
      settings: {},
    });

  } catch (error) {
    console.error("Error en /api/bootstrap:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
// ■ Fecha de hoy
function todayISO() {
return new Intl.DateTimeFormat("en-CA", {
timeZone: "America/Chicago",
year: "numeric",
month: "2-digit",
day: "2-digit",
}).format(new Date());
}
// ■ Hora local
function localTime() {
return new Date().toLocaleString("en-US", {
timeZone: "America/Chicago",
hour: "2-digit",
minute: "2-digit",
hour12: true,
});
}
// ■ Normalizar unidad
function normalizeRoom(value) {
const text = String(value || "").toUpperCase();
const match = text.match(/(\d{2,4})\s*([A-Z])?/);
if (!match) return "";
let room = match[1];
if (match[2]) room += match[2];
return room;
}
// ■ Solo números
function roomDigits(value) {
const match = String(value || "").match(/(\d{2,4})/);
return match ? match[1] : "";
}
// ■ Tarifas por tipo de unidad
// Cambia estos números por tus tarifas reales.
// También puedes controlarlos desde Render con PAYROLL_RATE_1, PAYROLL_RATE_2, etc.
const ROOM_RATES = {
S: Number(process.env.PAYROLL_RATE_S || 22), // Studio
M: Number(process.env.PAYROLL_RATE_M || 20), // Motel
"1": Number(process.env.PAYROLL_RATE_1 || 35),
"2": Number(process.env.PAYROLL_RATE_2 || 45),
"3": Number(process.env.PAYROLL_RATE_3 || 55),
"SUNRISE": Number(process.env.PAYROLL_RATE_4 || 41),
"30 ELM": Number(process.env.PAYROLL_RATE_5 || 33),
"SERENITY": Number(process.env.PAYROLL_RATE_5 || 51),
"MAIA": Number(process.env.PAYROLL_RATE_5 || 125),
"WILLOW": Number(process.env.PAYROLL_RATE_5 || 125),
"MENA": Number(process.env.PAYROLL_RATE_5 || 88),
"SUNDOWNER": Number(process.env.PAYROLL_RATE_5 || 70),
"LANDS END": Number(process.env.PAYROLL_RATE_5 || 90),
"38 LAKEHOUSE": Number(process.env.PAYROLL_RATE_5 || 55),
"37": Number(process.env.PAYROLL_RATE_5 || 55),
"TOUCH UP": Number(process.env.PAYROLL_RATE_5 || 0),
"SUITES": Number(process.env.PAYROLL_RATE_5 || 0),
};
// ■ Leer tipo de habitación desde lo que está entre paréntesis: 331A (2), 405 (S), 210 (M)
function getRoomType(unitName) {
const match = String(unitName || "").match(/\(([^)]+)\)/);
if (!match) return "";
return match[1].trim().toUpperCase();
}
// ■ Calcular pago por unidad
function getUnitPay(unitName) {
const roomType = getRoomType(unitName);
if (!roomType) {
return {
roomType: "",
amount: 0,
error: "No se encontró tipo de unidad entre paréntesis",
};
}
const amount = ROOM_RATES[roomType];
if (amount === undefined || Number.isNaN(amount)) {
return {
roomType,
amount: 0,
error: `No hay tarifa configurada para tipo ${roomType}`,
};
}
return {
roomType,
amount,
error: null,
};
}
// ■ Semana de nómina: lunes a domingo
function getPayrollWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();

  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

// Nombre seguro para hojas de Excel
function cleanSheetName(name) {
  return String(name || "Unknown")
    .replace(/[\\/*?:[\]]/g, "")
    .trim()
    .substring(0, 31) || "Unknown";
}

function uniqueSheetName(workbook, baseName) {
  const cleanBase = cleanSheetName(baseName);
  const existingNames = new Set(
    workbook.worksheets.map((sheet) => String(sheet.name || "").toLowerCase())
  );

  let sheetName = cleanBase;
  let counter = 1;

  while (existingNames.has(sheetName.toLowerCase())) {
    const suffix = ` ${counter}`;
    const maxBaseLength = 31 - suffix.length;
    sheetName = `${cleanBase.substring(0, maxBaseLength)}${suffix}`;
    counter++;
  }

  return sheetName;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nombre del archivo Excel semanal
function payrollFileName(weekStart, weekEnd) {
  return `Payroll_${weekStart}_to_${weekEnd}.xlsx`;
}

// Leer título real de la unidad desde Notion, incluyendo paréntesis
function getRoomTitleFromPage(page) {
  return page.properties?.["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
}
// ■ Evitar acciones duplicadas
function isDuplicateAction(action, unit, employee) {
const key = `${action}-${unit}-${employee}`.toUpperCase();
const now = Date.now();
const lastTime = recentActions.get(key);
if (lastTime && now - lastTime < 30000) {
return true;
}
recentActions.set(key, now);
setTimeout(() => {
recentActions.delete(key);
}, 30000);
return false;
}
// ■ Lectura directa para sincronización externa.
// Consulta Notion sin borrar el caché que están usando los paneles.
async function fetchRoomsFreshFromNotion(date) {
  let pages = [];
  let cursor;

  do {
    const body = {
      database_id: NOTION_DATABASE_ID,
      page_size: 100,
      filter: {
        property: "Date",
        date: { equals: date },
      },
    };

    if (cursor) body.start_cursor = cursor;

    const response = await notion.databases.query(body);
    pages = pages.concat(response.results || []);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  OSCore.metrics.increment("watcher.rooms.notion");
  return pages;
}

// ■ Buscar unidades de hoy en Notion usando search
async function queryTodayRooms(forceRefresh = false) {
  return queryRoomsByDate(todayISO(), forceRefresh);
}
// ■ Buscar unidades de cualquier fecha en la página central de Notion
async function queryRoomsByDate(date, forceRefresh = false) {
  const isToday = date === todayISO();
  const legacyCacheKey = isToday ? `todayRooms:${date}` : `roomsByDate:${date}`;
  const coreCacheKey = `core:rooms:${date}`;
  const ttlMs = isToday
    ? Number(process.env.ROOMS_CACHE_MS || 30000)
    : 120000;

  if (forceRefresh) {
    coreDeleteKeys(coreCacheKey);
    cacheStore.delete(legacyCacheKey);
    ServerCache.clear("rooms", date);
  }

  return OSCore.cache.remember(
    coreCacheKey,
    ttlMs,
    async () => {
      const legacyRoomCache = !forceRefresh
        ? ServerCache.get("rooms", date)
        : null;

      if (legacyRoomCache) {
        const age = Date.now() - new Date(legacyRoomCache.updatedAt).getTime();
        if (Number.isFinite(age) && age < ttlMs) {
          return legacyRoomCache.value;
        }
        ServerCache.clear("rooms", date);
      }

      const legacyCached = !forceRefresh ? getCache(legacyCacheKey) : null;
      if (legacyCached) {
        ServerCache.set("rooms", date, legacyCached);
        return legacyCached;
      }

      const pages = await fetchRoomsFreshFromNotion(date);

      setCache(legacyCacheKey, pages, ttlMs);
      ServerCache.set("rooms", date, pages);
      OSCore.metrics.increment("reads.rooms.notion");
      return pages;
    },
    [`rooms:${date}`, "rooms"]
  );
}
// ■ Status de Notion
function notionStatusFromAction(action) {
if (action === "START") return "In Progress";
if (action === "DONE") return "Cleaned - Awaiting Inspection";
if (action === "INSPECTION_START") return "Inspection Started";
if (action === "READY_GUEST") return "Ready for Guest";
return null;
}
async function notifyInspectors(unit) {
if (!process.env.WHAPI_TOKEN || !process.env.INSPECTORS_GROUP_ID) {
console.log("■■ WHAPI_TOKEN o INSPECTORS_GROUP_ID faltante");
return;
}
try {
const response = await fetch("https://gate.whapi.cloud/messages/text", {
method: "POST",
headers: {
Authorization: `Bearer ${process.env.WHAPI_TOKEN}`,
"Content-Type": "application/json",
},
body: JSON.stringify({
to: process.env.INSPECTORS_GROUP_ID,
body: `■ ${unit} lista para inspeccionar`,
}),
});
const data = await response.json();
console.log("■ Aviso enviado a inspectores:", data);
} catch (error) {
console.log("■ Error enviando a inspectores:", error.message);
}
}
// ■ Labels
function actionLabel(action) {
if (action === "START") return "■ Limpieza iniciada";
if (action === "DONE") return "■ Limpieza terminada";
if (action === "ISSUE") return "■■ Problema reportado";
if (action === "SUPPLIES") return "■ Supplies solicitados";
if (action === "INSPECTION_START") return "■ Inspección iniciada";
if (action === "READY_GUEST") return "■ Ready for Guest";
if (action === "INSPECTION_REPORT") return "■ Error de limpieza reportado";
if (action === "INSPECTION_SUPPLIES") return "■ Solicitud de inspector";
if (action === "GUEST_OUT") return "Guest Out";
if (action === "PRE_INSPECTION_START") return "Pre Inspection Started";
if (action === "PRE_INSPECTION_COMPLETE") return "Pre Inspection Complete";
if (action === "LOST_FOUND") return "■ Lost & Found";
if (action === "PHOTO") return "■ Foto adjunta";
return "Actualización";
}
// ■ Analizar nota con OpenAI
async function analyzeNoteWithAI(action, note) {
const safeNote = String(note || "").trim();
if (!OPENAI_API_KEY || !safeNote) {
return {
category: "Other",
priority: "Normal",
summary: safeNote || "Sin nota",
};
}
try {
const response = await openai.chat.completions.create({
model: "gpt-4o-mini",
temperature: 0.2,
messages: [
{
role: "system",
content: "Clasifica reportes de housekeeping de hotel. Responde solo JSON válido.",
},
{
role: "user",
content: `
Acción: ${action}
Nota: ${safeNote}
Devuelve exactamente:
{
"category": "Cleaning | Maintenance | Supplies | Damage | Guest Item | Other",
"priority": "Low | Normal | High | Urgent",
"summary": "resumen corto en español"
}
`,
},
],
});
const text = response.choices[0].message.content;
const cleanText = text.replace(/```json|```/g, "").trim();
return JSON.parse(cleanText);
} catch (error) {
console.log("■■ OpenAI error:", error.message);
return {
category: "Other",
priority: "Normal",
summary: safeNote || "Sin nota",
};
}
}
// ■ Sacar limpiador asignado desde Notion
function getAssignedCleaner(page) {
  return (
    page.properties?.["Assigned Cleaner"]?.select?.name ||
    page.properties?.["Assigned Cleaner"]?.rich_text?.map((t) => t.plain_text).join("") ||
    ""
  );
}

function readCheckboxProp(page, names) {
  const props = page?.properties || {};

  for (const name of names) {
    if (props[name]?.checkbox !== undefined) {
      return props[name].checkbox === true;
    }
  }

  return false;
}

function readDateProp(page, names) {
  const props = page?.properties || {};

  for (const name of names) {
    if (props[name]?.date?.start) {
      return props[name].date.start;
    }
  }

  return "";
}

function hasProp(page, name) {
  return !!page?.properties?.[name];
}

function getRoomOpsFlags(page) {
  const preInspection = readCheckboxProp(page, [
    "Pre Inspection",
    "Pre-Inspection",
    "Pre Inspected",
    "pre inspection",
    "Pre inspection",
  ]);

  const preInspectionStartedAt = readDateProp(page, [
    "Pre Inspection Started At",
    "Pre-Inspection Started At",
    "Pre Inspection Start At",
    "pre inspection started at",
  ]);

  const preInspectionStartedCheckbox = readCheckboxProp(page, [
    "Pre Inspection Started",
    "Pre-Inspection Started",
    "pre inspection started",
    "Pre inspection started",
  ]);

  return {
    guestOut: readCheckboxProp(page, [
      "Guest Out",
      "guest out",
      "GuestOut",
      "Guest out",
      "Guests Out",
    ]),

    guestOutAt: readDateProp(page, [
      "Guest Out At",
      "guest out at",
      "Guest Out Time",
    ]),

    preInspection,

    // Si no existe el checkbox, la fecha de inicio funciona como respaldo.
    // Cuando la pre inspección ya está completada, deja de considerarse iniciada.
    preInspectionStarted:
      !preInspection &&
      (preInspectionStartedCheckbox || !!preInspectionStartedAt),

    preInspectionStartedAt,

    preInspectionCompletedAt: readDateProp(page, [
      "Pre Inspection Completed At",
      "Pre-Inspection Completed At",
      "Pre Inspection At",
      "pre inspection completed at",
    ]),
  };
}

function setCheckboxIfExists(page, props, name, value) {
  if (hasProp(page, name)) {
    props[name] = {
      checkbox: !!value,
    };

    return name;
  }

  return "";
}

function setDateIfExists(page, props, name, value) {
  if (hasProp(page, name)) {
    props[name] = {
      date: {
        start: value,
      },
    };

    return name;
  }

  return "";
}

function setFirstExistingCheckbox(page, props, possibleNames, value) {
  for (const name of possibleNames) {
    if (hasProp(page, name)) {
      props[name] = {
        checkbox: !!value,
      };

      return name;
    }
  }

  return "";
}

function setFirstExistingDate(page, props, possibleNames, value) {
  for (const name of possibleNames) {
    if (hasProp(page, name)) {
      props[name] = {
        date: {
          start: value,
        },
      };

      return name;
    }
  }

  return "";
}

async function getDatabaseSchema(databaseId) {
const cacheKey = `schema:${databaseId}`;
const cached = getCache(cacheKey);
if (cached) return cached;
const db = await notion.databases.retrieve({
database_id: databaseId,
});
setCache(cacheKey, db.properties, 10 * 60 * 1000);
return db.properties;
}
function findPropName(schema, possibleNames) {
return possibleNames.find((name) => schema[name]);
}
function buildTextProperty(schema, possibleNames, value) {
const name = findPropName(schema, possibleNames);
if (!name) return null;
const type = schema[name].type;
if (type === "title") {
return {
name,
value: {
title: [
{
text: {
content: String(value || ""),
},
},
],
},
};
}
if (type === "rich_text") {
return {
name,
value: {
rich_text: [
{
text: {
content: String(value || ""),
},
},
],
},
};
}
return null;
}
function buildDateProperty(schema, possibleNames, value) {
const name = findPropName(schema, possibleNames);
if (!name) return null;
return {
name,
value: {
date: {
start: value,
},
},
};
}
function buildSelectProperty(schema, possibleNames, value) {
const name = findPropName(schema, possibleNames);
if (!name) return null;
return {
name,
value: {
select: {
name: String(value || "Other"),
},
},
};
}
async function dailyLogAlreadyExists(action, unit, employee, inspector) {
  const today = todayISO();
  const person = employee || inspector || "";

  const response = await notion.databases.query({
    database_id: NOTION_LOG_DATABASE_ID,
    filter: {
      and: [
        {
          property: "Date",
          date: {
            equals: today,
          },
        },
        {
          property: "Unit",
          rich_text: {
            equals: unit,
          },
        },
        {
          property: "Action",
          select: {
            equals: action,
          },
        },
      ],
    },
    page_size: 10,
  });

  return response.results.some((page) => {
    const cleaner =
      page.properties.Cleaner?.rich_text?.map((t) => t.plain_text).join("") || "";

    const inspectorName =
      page.properties.Inspector?.rich_text?.map((t) => t.plain_text).join("") || "";

    return cleaner === person || inspectorName === person;
  });
}
async function saveDailyLog({
action,
unit,
employee,
inspector,
assignedCleaner,
note,
ai = null,
photoUrl = "",
lostAndFound = false,
}) {
if (!NOTION_LOG_DATABASE_ID) {
console.log("■■ NOTION_LOG_DATABASE_ID faltante, no se guardó historial");
return;
}
const now = new Date().toISOString();
try {
const schema = await getDatabaseSchema(NOTION_LOG_DATABASE_ID);
const alreadyExists = await dailyLogAlreadyExists(
action,
unit,
employee,
inspector
);
if (alreadyExists) {
console.log("■■ Registro duplicado, no se guardó en Daily Cleaning Logs");
return;
}
const props = {};
const fields = [
buildTextProperty(schema, ["log", "Log"], `${unit} - ${action} - ${employee || inspector || ""}`),
buildDateProperty(schema, ["date", "Date"], todayISO()),
buildDateProperty(schema, ["time", "Time"], now),
buildTextProperty(schema, ["unit", "Unit"], unit),
buildTextProperty(schema, ["cleaner", "Cleaner"], employee || ""),
buildTextProperty(schema, ["inspector", "Inspector"], inspector || ""),
buildSelectProperty(schema, ["action", "Action"], action),
buildTextProperty(schema, ["note", "Note"], note || ""),
buildSelectProperty(schema, ["category", "Category"], ai?.category || "Other"),
buildSelectProperty(schema, ["priority", "Priority"], ai?.priority || "Normal"),
buildSelectProperty(schema, ["status", "Status"], notionStatusFromAction(action) || action),
buildTextProperty(schema, ["cleaner error", "Cleaner Error"], assignedCleaner || ""),
];
fields.forEach((field) => {
if (field) {
props[field.name] = field.value;
}
});
if (schema["Photo URL"] && photoUrl) {
  props["Photo URL"] = {
    url: photoUrl,
  };
}

if (schema["Lost and Found"]) {
  props["Lost and Found"] = {
    checkbox: !!lostAndFound,
  };
}
const response = await notion.pages.create({
parent: {
  database_id: NOTION_LOG_DATABASE_ID,
},
  properties: props,
});
  
console.log("■ Daily Cleaning Log guardado");
} catch (error) {
console.log("■ ERROR guardando Daily Cleaning Log:", error.body || error.message);
}
}
// ■ Evitar duplicados en Payroll Records
async function payrollRecordExists({ cleaner, unit, date }) {
  if (!NOTION_PAYROLL_DATABASE_ID) return false;

  const response = await notion.databases.query({
    database_id: NOTION_PAYROLL_DATABASE_ID,
    page_size: 100,
  });

  return response.results.some((page) => {
    const props = page.properties;

    const existingDate = props.Date?.date?.start || "";

    const existingCleaner =
      props.Cleaner?.rich_text?.map((t) => t.plain_text).join("") || "";

    const existingUnit =
      props.Unit?.rich_text?.map((t) => t.plain_text).join("") || "";

    return (
      existingDate === date &&
      existingCleaner === cleaner &&
      existingUnit === unit
    );
  });
}
// ■ Crear registro de nómina cuando se termina una unidad
async function payrollRecordAlreadyExists({ cleaner, unit, date }) {
  if (!NOTION_PAYROLL_DATABASE_ID) return false;

  const cleanCleaner = normalizeCleaner(cleaner);
  const cleanUnit = String(unit || "").trim();

  const response = await notion.databases.query({
    database_id: NOTION_PAYROLL_DATABASE_ID,
    page_size: 10,
    filter: {
      and: [
        {
          property: "Date",
          date: {
            equals: date,
          },
        },
        {
          property: "Cleaner",
          rich_text: {
            equals: cleanCleaner,
          },
        },
        {
          property: "Unit",
          rich_text: {
            equals: cleanUnit,
          },
        },
      ],
    },
  });

  return response.results.length > 0;
}

async function createPayrollRecord({ cleaner, unit, date }) {
  cleaner = normalizeCleaner(cleaner);
  unit = String(unit || "").trim();

  if (!NOTION_PAYROLL_DATABASE_ID) {
    console.log("NOTION_PAYROLL_DATABASE_ID faltante, no se guardó Payroll Record");
    return;
  }

  if (!cleaner || !unit || !date) {
    console.log("Payroll incompleto, falta cleaner, unit o date:", {
      cleaner,
      unit,
      date,
    });
    return;
  }

  const pay = getUnitPay(unit);

  if (pay.error) {
    console.log("Payroll error:", pay.error, unit);
    return;
  }

  const exists = await payrollRecordAlreadyExists({
    cleaner,
    unit,
    date,
  });

  if (exists) {
    console.log("Payroll duplicado ignorado:", cleaner, unit, date);
    return;
  }

  const week = getPayrollWeek(new Date(`${date}T12:00:00`));

  await notion.pages.create({
    parent: {
      database_id: NOTION_PAYROLL_DATABASE_ID,
    },
    properties: {
      Payroll: {
        title: [
          {
            text: {
              content: `${cleaner} - ${unit} - $${pay.amount}`,
            },
          },
        ],
      },
      Date: {
        date: {
          start: date,
        },
      },
      Cleaner: {
        rich_text: [
          {
            text: {
              content: cleaner,
            },
          },
        ],
      },
      Unit: {
        rich_text: [
          {
            text: {
              content: unit,
            },
          },
        ],
      },
      "Room Type": {
        select: {
          name: pay.roomType,
        },
      },
      Amount: {
        number: pay.amount,
      },
      "Week Start": {
        date: {
          start: week.weekStart,
        },
      },
      "Week End": {
        date: {
          start: week.weekEnd,
        },
      },
      Status: {
        select: {
          name: "Pending",
        },
      },
    },
  });

  console.log("Payroll Record guardado:", cleaner, unit, `$${pay.amount}`);
}
// ■ Leer Payroll Records desde Notion
async function getPayrollRecords(weekStart, weekEnd) {
if (!NOTION_PAYROLL_DATABASE_ID) {
throw new Error("Falta NOTION_PAYROLL_DATABASE_ID");
}
let results = [];
let cursor = undefined;
do {
const body = {
database_id: NOTION_PAYROLL_DATABASE_ID,
page_size: 100,
filter: {
and: [
{
property: "Date",
date: {
on_or_after: weekStart,
},
},
{
property: "Date",
date: {
on_or_before: weekEnd,
},
},
],
},
sorts: [
{
property: "Date",
direction: "ascending",
},
],
};
if (cursor) body.start_cursor = cursor;
const response = await notion.databases.query(body);
results = results.concat(response.results);
cursor = response.has_more ? response.next_cursor : undefined;
} while (cursor);
return results.map((page) => {
const p = page.properties;
return {
  date: p.Date?.date?.start || "",
  cleaner: normalizeCleaner(
  p.Cleaner?.rich_text?.map((t) => t.plain_text).join("") || ""
),
unit: p.Unit?.rich_text?.map((t) => t.plain_text).join("") || "",
roomType: p["Room Type"]?.select?.name || "",
amount: p.Amount?.number || 0,
};
});
}
// ■ Generar / actualizar Excel semanal con hoja por limpiador
async function getHourlyPayrollRecords(weekStart, weekEnd) {
  if (!NOTION_TIME_CLOCK_DATABASE_ID) return [];

  const response = await notion.databases.query({
    database_id: NOTION_TIME_CLOCK_DATABASE_ID,
    page_size: 100,
  });

  return response.results
    .map((page) => {
      const p = page.properties;

      return {
        employee: p.Employee?.rich_text?.map((t) => t.plain_text).join("") || "",
        code: p.Code?.rich_text?.map((t) => t.plain_text).join("") || "",
        role: p.Role?.select?.name || "",
        clockIn: p["Clock In"]?.date?.start || "",
        clockOut: p["Clock Out"]?.date?.start || "",
        hours: p.Hours?.number || 0,
        hourlyRate: p["Hourly Rate"]?.number || 0,
        total: p.Total?.number || 0,
        status: p.Status?.select?.name || "",
      };
    })
    .filter((r) => {
      if (!r.clockIn) return false;
      const day = r.clockIn.slice(0, 10);
      return day >= weekStart && day <= weekEnd && r.status === "Completed";
    });
}
async function getEmployeesCached(forceRefresh = false) {
  const legacyCacheKey = "employees:active";
  const coreCacheKey = "core:employees:active";
  const ttlMs = Number(process.env.EMPLOYEES_CACHE_MS || 300000);

  if (!NOTION_EMPLOYEES_DATABASE_ID) return [];

  if (forceRefresh) {
    coreDeleteKeys(coreCacheKey);
    cacheStore.delete(legacyCacheKey);
    ServerCache.clear("employees", "active");
  }

  return OSCore.cache.remember(
    coreCacheKey,
    ttlMs,
    async () => {
      const employeeCache = !forceRefresh
        ? ServerCache.get("employees", "active")
        : null;

      if (employeeCache) {
        const age = Date.now() - new Date(employeeCache.updatedAt).getTime();
        if (Number.isFinite(age) && age < ttlMs) {
          return employeeCache.value;
        }
        ServerCache.clear("employees", "active");
      }

      const legacyCached = !forceRefresh ? getCache(legacyCacheKey) : null;
      if (legacyCached) {
        ServerCache.set("employees", "active", legacyCached);
        return legacyCached;
      }

      let results = [];
      let cursor;

      do {
        const body = {
          database_id: NOTION_EMPLOYEES_DATABASE_ID,
          page_size: 100,
        };

        if (cursor) body.start_cursor = cursor;

        const response = await notion.databases.query(body);
        results = results.concat(response.results || []);
        cursor = response.has_more ? response.next_cursor : undefined;
      } while (cursor);

      setCache(legacyCacheKey, results, ttlMs);
      ServerCache.set("employees", "active", results);
      OSCore.metrics.increment("reads.employees.notion");
      return results;
    },
    ["employees"]
  );
}

function clearEmployeesCache() {
  cacheStore.delete("employees:active");
  coreDeleteKeys("core:employees:active");
  coreInvalidateTags("employees");

  if (typeof ServerCache !== "undefined") {
    ServerCache.clear("employees", "active");
  }
}


function cleanEmployeeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|,]+/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

function getEmployeeNameFromPage(page) {
  const props = page?.properties || {};

  return (
    props.Employee?.title?.map((t) => t.plain_text).join("").trim() ||
    props.Employee?.rich_text?.map((t) => t.plain_text).join("").trim() ||
    props.Nombre?.title?.map((t) => t.plain_text).join("").trim() ||
    props.Name?.title?.map((t) => t.plain_text).join("").trim() ||
    ""
  );
}

function getEmployeeCodeFromPage(page) {
  const props = page?.properties || {};
  const raw =
    props.Code?.rich_text?.map((t) => t.plain_text).join("").trim() ||
    props.Code?.number?.toString() ||
    props.Codigo?.rich_text?.map((t) => t.plain_text).join("").trim() ||
    props["Employee Code"]?.rich_text?.map((t) => t.plain_text).join("").trim() ||
    "";

  return String(raw || "").trim();
}

function getEmployeeRoleFromPage(page) {
  const props = page?.properties || {};

  return (
    props.Role?.select?.name ||
    props.Role?.status?.name ||
    props.Role?.multi_select?.map((r) => r.name).join(" / ") ||
    props.Role?.rich_text?.map((t) => t.plain_text).join("").trim() ||
    props.role?.select?.name ||
    props.role?.rich_text?.map((t) => t.plain_text).join("").trim() ||
    ""
  );
}

function isEmployeeActiveFromPage(page) {
  const props = page?.properties || {};

  if (props.Active?.checkbox !== undefined) return props.Active.checkbox === true;
  if (props.active?.checkbox !== undefined) return props.active.checkbox === true;

  // Si todavía no existe Active en algún registro, no lo bloqueamos por accidente.
  return true;
}

function roleIncludes(role, words) {
  const r = cleanEmployeeText(role);

  return words.some((word) => r.includes(cleanEmployeeText(word)));
}

function isAdminRole(role) {
  return roleIncludes(role, [
    "admin",
    "manager",
    "owner",
    "company owner",
    "general manager",
    "corporate",
  ]);
}

function canCleanRole(role) {
  return isAdminRole(role) || roleIncludes(role, ["cleaner", "cleaning", "housekeeper"]);
}

function canInspectRole(role) {
  return (
    isAdminRole(role) ||
    roleIncludes(role, ["inspector", "inspection", "dispatch", "operations", "supervisor"])
  );
}

function canOperationsRole(role) {
  return isAdminRole(role) || roleIncludes(role, ["dispatch", "operations", "supervisor"]);
}

function canReportsRole(role) {
  return isAdminRole(role) || roleIncludes(role, ["dispatch", "operations", "reports", "payroll"]);
}

function canClockRole(role) {
  return (
    isAdminRole(role) ||
    roleIncludes(role, [
      "clock",
      "laundry",
      "activities",
      "runner",
      "houseman",
      "support",
      "hourly",
      "dispatch",
      "operations",
      "inspector",
    ])
  );
}

function getPermissionsFromRole(role) {
  if (isAdminRole(role)) return ["all"];

  const permissions = [];

  if (canCleanRole(role)) permissions.push("cleaning");
  if (canInspectRole(role)) permissions.push("inspection");
  if (canOperationsRole(role)) permissions.push("operations", "rooms");
  if (canReportsRole(role)) permissions.push("reports");
  if (canClockRole(role)) permissions.push("clock");

  return [...new Set(permissions)];
}

function pageToUser(page) {
  const name = getEmployeeNameFromPage(page);
  const code = getEmployeeCodeFromPage(page);
  const role = getEmployeeRoleFromPage(page);
  const active = isEmployeeActiveFromPage(page);

  return {
    id: page?.id || "",
    name,
    code,
    role,
    active,
    hotel: "Default Hotel",
    permissions: getPermissionsFromRole(role),
    home: mobileHomeFromRole(role),
  };
}

function userCan(user, permission) {
  const permissions = user?.permissions || getPermissionsFromRole(user?.role || "");
  return permissions.includes("all") || permissions.includes(permission);
}

async function findEmployeeByCode(code) {
  const cleanCode = String(code || "").trim();

  const findMatch = (employees) =>
    employees.find((page) => {
      const employeeCode = getEmployeeCodeFromPage(page);
      return employeeCode === cleanCode;
    });

  const employees = await getEmployeesCached();
  return findMatch(employees);
}

async function findEmployeeByLogin(login) {
  const cleanLogin = String(login || "").trim();
  const cleanLoginText = cleanEmployeeText(cleanLogin);

  const findMatch = (employees) =>
    employees.find((page) => {
      const name = getEmployeeNameFromPage(page);
      const code = getEmployeeCodeFromPage(page);

      const nameMatch = cleanEmployeeText(name) === cleanLoginText;
      const codeMatch = code && code === cleanLogin;

      return nameMatch || codeMatch;
    });

  const employees = await getEmployeesCached();
  return findMatch(employees);
}

function mobileHomeFromRole(role) {
  if (isAdminRole(role) || canOperationsRole(role)) {
    return "admin";
  }

  if (canCleanRole(role) && canInspectRole(role)) {
    return "choose-role";
  }

  if (canInspectRole(role)) {
    return "inspector";
  }

  if (canCleanRole(role)) {
    return "cleaner";
  }

  if (canClockRole(role)) {
    return "clock";
  }

  return "staff";
}

app.post("/mobile-code-login", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "Código requerido",
      });
    }

    const employee = await findEmployeeByCode(code);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: "Código no encontrado",
      });
    }

    const employeeName = getEmployeeNameFromPage(employee);
    const role = getEmployeeRoleFromPage(employee);
    const home = mobileHomeFromRole(role);

    res.json({
      ok: true,
      employee: employeeName,
      role,
      code,
      home,
      employeeId: employee.id,
    });

  } catch (error) {
    console.error("Error en /mobile-code-login:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/test-mobile-code-login", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "Código requerido",
      });
    }

    const employee = await findEmployeeByCode(code);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: "Código no encontrado",
      });
    }

    const employeeName = getEmployeeNameFromPage(employee);
    const role = getEmployeeRoleFromPage(employee);
    const home = mobileHomeFromRole(role);

    res.json({
      ok: true,
      employee: employeeName,
      role,
      code,
      home,
      employeeId: employee.id,
    });

  } catch (error) {
    console.error("Error en /test-mobile-code-login:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

async function generateWeeklyPayrollExcel(weekStart, weekEnd) {
  const records = await getPayrollRecords(weekStart, weekEnd);
  const hourlyRecords = await getHourlyPayrollRecords(weekStart, weekEnd);
 

  const workbook = new ExcelJS.Workbook();
  workbook.creator = process.env.COMPANY_NAME || "Housekeeping Payroll System";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Payroll Summary");
  const quickbooksSheet = workbook.addWorksheet("QuickBooks Upload");
  const dailySheet = workbook.addWorksheet("Daily Payroll");
  const hourlySheet = workbook.addWorksheet("Hourly Payroll");

  dailySheet.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Cleaner", key: "cleaner", width: 22 },
    { header: "Unit", key: "unit", width: 22 },
    { header: "Room Type", key: "roomType", width: 15 },
    { header: "Amount", key: "amount", width: 15 },
  ];

  records.forEach((r) => {
    dailySheet.addRow({
      date: r.date,
      cleaner: r.cleaner,
      unit: r.unit,
      roomType: r.roomType,
      amount: Number(r.amount || 0),
    });
  });

  const totals = {};

  records.forEach((r) => {
    const cleaner = (r.cleaner || "Unknown").trim();

    if (!totals[cleaner]) {
      totals[cleaner] = {
        cleaner,
        totalUnits: 0,
        totalAmount: 0,
        records: [],
      };
    }

    totals[cleaner].totalUnits += 1;
    totals[cleaner].totalAmount += Number(r.amount || 0);
    totals[cleaner].records.push(r);
  });

  const hourlyTotals = {};

  hourlyRecords.forEach((r) => {
    const employee = normalizeCleaner(r.employee || "Unknown");

    if (!hourlyTotals[employee]) {
      hourlyTotals[employee] = {
        employee,
        role: r.role,
        hours: 0,
        total: 0,
      };
    }

    hourlyTotals[employee].hours += Number(r.hours || 0);
    hourlyTotals[employee].total += Number(r.total || 0);
  });

  summarySheet.columns = [
    { header: "Employee", key: "employee", width: 22 },
    { header: "Pay Type", key: "payType", width: 15 },
    { header: "Units", key: "units", width: 12 },
    { header: "Hours", key: "hours", width: 12 },
    { header: "Weekly Total", key: "total", width: 15 },
  ];

  quickbooksSheet.columns = [
    { header: "Employee", key: "employee", width: 22 },
    { header: "Pay Type", key: "payType", width: 15 },
    { header: "Pay Period", key: "payPeriod", width: 25 },
    { header: "Amount", key: "amount", width: 15 },
  ];
  Object.values(totals)
    .sort((a, b) => a.cleaner.localeCompare(b.cleaner))
    .forEach((t) => {
      summarySheet.addRow({
        employee: t.cleaner,
        payType: "Unit Pay",
        units: t.totalUnits,
        hours: "",
        total: Number(t.totalAmount.toFixed(2)),
      });

      quickbooksSheet.addRow({
        employee: t.cleaner,
        payType: "Unit Pay",
        payPeriod: `${weekStart} to ${weekEnd}`,
        amount: Number(t.totalAmount.toFixed(2)),
      });

      const sheetName = uniqueSheetName(workbook, `${t.cleaner} - Cleaning`);
      const cleanerSheet = workbook.addWorksheet(sheetName);

      cleanerSheet.columns = [
        { header: "Date", key: "date", width: 15 },
        { header: "Unit", key: "unit", width: 22 },
        { header: "Room Type", key: "roomType", width: 15 },
        { header: "Amount", key: "amount", width: 15 },
      ];

      t.records.forEach((r) => {
        cleanerSheet.addRow({
          date: r.date,
          unit: r.unit,
          roomType: r.roomType,
          amount: Number(r.amount || 0),
        });
      });

      cleanerSheet.addRow({});
      cleanerSheet.addRow({
        date: "TOTAL",
        amount: Number(t.totalAmount.toFixed(2)),
      });
    });

  hourlySheet.columns = [
    { header: "Employee", key: "employee", width: 22 },
    { header: "Role", key: "role", width: 18 },
    { header: "Clock In", key: "clockIn", width: 25 },
    { header: "Clock Out", key: "clockOut", width: 25 },
    { header: "Hours", key: "hours", width: 12 },
    { header: "Hourly Rate", key: "hourlyRate", width: 15 },
    { header: "Total", key: "total", width: 15 },
  ];

  hourlyRecords.forEach((r) => {
    hourlySheet.addRow({
     employee: (r.employee || "Unknown").trim(),
      role: r.role,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      hours: Number(r.hours || 0),
      hourlyRate: Number(r.hourlyRate || 0),
      total: Number(r.total || 0),
    });
  });

  Object.values(hourlyTotals)
    .sort((a, b) => a.employee.localeCompare(b.employee))
    .forEach((t) => {
      summarySheet.addRow({
        employee: t.employee,
        payType: "Hourly",
        units: "",
        hours: Number(t.hours.toFixed(2)),
        total: Number(t.total.toFixed(2)),
      });

      quickbooksSheet.addRow({
        employee: t.employee,
        payType: "Hourly",
        payPeriod: `${weekStart} to ${weekEnd}`,
        amount: Number(t.total.toFixed(2)),
      });
    });

  const folder = path.join(__dirname, "payroll_exports");

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }

  const filePath = path.join(folder, payrollFileName(weekStart, weekEnd));

  await workbook.xlsx.writeFile(filePath);

  console.log("Excel de nómina actualizado:", filePath);

  return {
    fileName: payrollFileName(weekStart, weekEnd),
    filePath,
    fileUrl: `/payroll_exports/${payrollFileName(weekStart, weekEnd)}`,
    totalRecords: records.length + hourlyRecords.length,
  };
}
// ■ Actualizar habitación principal
async function updateNotionRoom(unit, action, employee, note, mode = "cleaner", photoUrl = "") {
if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
throw new Error("Faltan variables de Notion. Revisa NOTION_API_KEY y NOTION_DATABASE_ID");
}
const allowedActions = [
"START",
"DONE",
"ISSUE",
"SUPPLIES",
"PHOTO",
"LOST_FOUND",
"INSPECTION_START",
"READY_GUEST",
"INSPECTION_REPORT",
"INSPECTION_SUPPLIES",
"GUEST_OUT",
"PRE_INSPECTION_START",
"PRE_INSPECTION_COMPLETE"
];
if (!allowedActions.includes(action)) {
throw new Error("Acción no permitida");
}
const pages = await queryTodayRooms();
const normalizedTarget = normalizeRoom(unit);
const targetDigits = roomDigits(unit);
let matches = pages.filter((page) => {
const title =
page.properties["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
return normalizeRoom(title) === normalizedTarget;
});
if (matches.length === 0) {
matches = pages.filter((page) => {
const title =
page.properties["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
return roomDigits(title) === targetDigits;
});
}
if (matches.length === 0) {
  throw new Error(`No encontré la unidad ${unit} en Notion para hoy`);
}

const now = new Date().toISOString();
const label = actionLabel(action);
const status = notionStatusFromAction(action);

const needsAI = [
  "ISSUE",
  "SUPPLIES",
  "INSPECTION_REPORT",
  "INSPECTION_SUPPLIES",
].includes(action);

let ai = null;

if (needsAI) {
  ai = await analyzeNoteWithAI(action, note);
}

for (const page of matches) {
  const assignedCleaner = getAssignedCleaner(page);
  const officialCleaner = assignedCleaner || employee;
  const fullUnitTitle = getRoomTitleFromPage(page) || unit;
  const cleanerFinishedAt =
    page.properties["Finished At"]?.date?.start || "";

  const historyLine =
    `${localTime()} - ${employee} - ${label}` +
    `${assignedCleaner && mode === "inspector" ? ` - Cleaner: ${assignedCleaner}` : ""}` +
    `${note ? ` - ${note}` : ""}` +
    `${photoUrl ? ` - Photo: ${photoUrl}` : ""}` +
    `${ai ? ` | ${ai.category} | ${ai.priority} | ${ai.summary}` : ""}`;

  const oldLastMessage =
    page.properties["Last Message"]?.rich_text?.map((t) => t.plain_text).join("") || "";

  const newLastMessage = oldLastMessage
    ? `${oldLastMessage}\n${historyLine}`
    : historyLine;

  const props = {
    "Last Whatsapp Update ": {
      date: {
        start: now,
      },
    },
    "Last Message": {
      rich_text: [
        {
          text: {
            content: newLastMessage.slice(-1900),
          },
        },
      ],
    },
    "Last Update By": {
      rich_text: [
        {
          text: {
            content: employee,
          },
        },
      ],
    },
  };

  if (status) {
    props["Cleaning Status"] = {
      status: {
        name: status,
      },
    };
  }

  if (action === "START") {
    props["Started At"] = {
      date: {
        start: now,
      },
    };
  }

  if (action === "DONE") {
    props["Finished At"] = {
      date: {
        start: now,
      },
    };
  }

  if (action === "INSPECTION_START") {
    setFirstExistingDate(
      page,
      props,
      ["Inspection Started At", "Inspection Start At"],
      now
    );
  }

  if (action === "READY_GUEST") {
    setFirstExistingDate(
      page,
      props,
      ["Ready At", "Ready for Guest At"],
      now
    );
  }

  if (action === "GUEST_OUT") {
    setCheckboxIfExists(page, props, "Guest Out", true);
    setDateIfExists(page, props, "Guest Out At", now);
  }

  if (action === "PRE_INSPECTION_START") {
    // El checkbox es opcional. Si no existe, usamos la fecha como estado.
    setFirstExistingCheckbox(
      page,
      props,
      [
        "Pre Inspection Started",
        "Pre-Inspection Started",
        "pre inspection started",
        "Pre inspection started",
      ],
      true
    );

    const startedAtProperty = setFirstExistingDate(
      page,
      props,
      [
        "Pre Inspection Started At",
        "Pre-Inspection Started At",
        "Pre Inspection Start At",
        "pre inspection started at",
      ],
      now
    );

    if (!startedAtProperty) {
      throw new Error(
        'No encontré en Notion una propiedad de fecha llamada "Pre Inspection Started At"'
      );
    }
  }

  if (action === "PRE_INSPECTION_COMPLETE") {
    const completedProperty = setFirstExistingCheckbox(
      page,
      props,
      [
        "Pre Inspection",
        "Pre-Inspection",
        "Pre Inspected",
        "pre inspection",
        "Pre inspection",
      ],
      true
    );

    setFirstExistingCheckbox(
      page,
      props,
      [
        "Pre Inspection Started",
        "Pre-Inspection Started",
        "pre inspection started",
        "Pre inspection started",
      ],
      false
    );

    setFirstExistingDate(
      page,
      props,
      [
        "Pre Inspection Completed At",
        "Pre-Inspection Completed At",
        "Pre Inspection At",
        "pre inspection completed at",
      ],
      now
    );

    if (!completedProperty) {
      throw new Error(
        'No encontré en Notion una propiedad checkbox llamada "Pre Inspection"'
      );
    }
  }

  const autoCloseCleaning =
    action === "INSPECTION_START" &&
    !cleanerFinishedAt &&
    officialCleaner;

  if (autoCloseCleaning) {
    props["Finished At"] = {
      date: {
        start: now,
      },
    };
  }

  if (needsAI) {
    props["Issues Notes"] = {
      rich_text: [
        {
          text: {
            content: ai ? ai.summary : note || label,
          },
        },
      ],
    };

    props["Issue Category"] = {
      select: {
        name: ai ? ai.category : "Other",
      },
    };

    props["Priority"] = {
      select: {
        name: ai ? ai.priority : "Normal",
      },
    };
  }

  await notion.pages.update({
    page_id: page.id,
    properties: props,
  });

  clearRoomCache(todayISO());
  clearAssignmentCaches(todayISO());

  const existingFlags = getRoomOpsFlags(page);

  const roomUpdatePayload = {
    id: page.id,
    pageId: page.id,
    unit: fullUnitTitle,
    action,
    status:
      status ||
      page.properties?.["Cleaning Status"]?.status?.name ||
      "",
    guestOut:
      action === "GUEST_OUT"
        ? true
        : existingFlags.guestOut,
    preInspectionStarted:
      action === "PRE_INSPECTION_START"
        ? true
        : action === "PRE_INSPECTION_COMPLETE"
          ? false
          : existingFlags.preInspectionStarted,
    preInspection:
      action === "PRE_INSPECTION_COMPLETE"
        ? true
        : existingFlags.preInspection,
    startedAt:
      action === "START"
        ? now
        : page.properties?.["Started At"]?.date?.start || "",
    finishedAt:
      action === "DONE"
        ? now
        : page.properties?.["Finished At"]?.date?.start || "",
    inspectionStartedAt:
      action === "INSPECTION_START"
        ? now
        : readDateProp(page, ["Inspection Started At", "Inspection Start At"]),
    readyAt:
      action === "READY_GUEST"
        ? now
        : readDateProp(page, ["Ready At", "Ready for Guest At"]),
    updatedAt: now,
  };

  // Evento ligero para actualizar solo una tarjeta en todos los teléfonos.
  io.emit("room-updated", roomUpdatePayload);

  // Evento general como respaldo para cambios de asignación o cambios externos.
  broadcastAssignmentUpdate("server-room-update", {
    pageId: page.id,
    unit: fullUnitTitle,
    action,
    lightweight: true,
  });

  await saveDailyLog({
    action,
    unit: fullUnitTitle,
    employee: mode === "cleaner" ? officialCleaner : officialCleaner,
    inspector: mode === "inspector" ? employee : "",
    assignedCleaner: mode === "inspector" ? officialCleaner : "",
    note,
    ai,
    photoUrl: photoUrl || "",
    lostAndFound: action === "LOST_FOUND",
  });

  if (autoCloseCleaning) {
    await saveDailyLog({
      action: "DONE",
      unit: fullUnitTitle,
      employee: officialCleaner,
      inspector: "",
      assignedCleaner: "",
      note: `Cierre automático porque ${employee} inició inspección`,
      ai: null,
    });

    await createPayrollRecord({
      cleaner: officialCleaner,
      unit: fullUnitTitle,
      date: todayISO(),
    });
  }

  if (mode === "cleaner" && action === "DONE") {
    await createPayrollRecord({
      cleaner: officialCleaner,
      unit: fullUnitTitle,
      date: todayISO(),
    });
  }
}

return {
  label,
  ai,
};
}

// Helpers para PDF
function getProp(page, names) {
  for (const name of names) {
    if (page.properties[name]) return page.properties[name];
  }

  return null;
}

function readText(page, names) {
  const prop = getProp(page, names);

  if (!prop) return "";

  if (prop.title) return prop.title.map((t) => t.plain_text).join("");
  if (prop.rich_text) return prop.rich_text.map((t) => t.plain_text).join("");
  if (prop.select) return prop.select.name || "";
  if (prop.status) return prop.status.name || "";
  if (prop.date) return prop.date.start || "";
  if (prop.number !== null && prop.number !== undefined) return String(prop.number);
  if (prop.checkbox !== undefined) return prop.checkbox ? "Yes" : "No";

  return "";
}

function readUrl(page, names) {
  const prop = getProp(page, names);
  if (!prop) return "";
  return prop.url || "";
}

function formatReportTime(value) {
  if (!value) return "N/A";

  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

async function getDailyLogsForReport(date) {
  if (!NOTION_LOG_DATABASE_ID) {
    throw new Error("Falta NOTION_LOG_DATABASE_ID o NOTION_DAILY_CLEANING_LOGS_DB_ID");
  }

  const response = await notion.databases.query({
    database_id: NOTION_LOG_DATABASE_ID,
    filter: {
      property: "Date",
      date: {
        equals: date,
      },
    },
    sorts: [
      {
        property: "Time",
        direction: "ascending",
      },
    ],
  });

  return response.results;
}
function normalizeCleaner(name) {
  const n = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

  const map = {
    "steve": "Steve Soto",
    "steve soto": "Steve Soto",
    "brenda": "Brenda",
    "yoel": "Yoel",
    "carolina": "Carolina",
  };

  return map[n] || String(name || "").trim().replace(/\s+/g, " ");
}

function normalizeReportUnit(unit) {
  return String(unit || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .trim();
}
async function generateDailyReport(date = todayISO()) {
  console.log("USANDO REPORTE DESDE SERVER.JS - REPORTE DESDE PAGINA CENTRAL");

  const [centralRooms, logs] = await Promise.all([
    queryRoomsByDate(date),
    getDailyLogsForReport(date),
  ]);

  const fileName = `daily-housekeeping-report-${date}.pdf`;
  const filePath = path.join(reportsDir, fileName);

  const logsByUnit = {};
  const logsByCleaner = {};
  const logsByInspector = {};

  logs.forEach((log) => {
    const unit = normalizeReportUnit(readText(log, ["Unit", "unit"]));
    const cleaner = normalizeCleaner(readText(log, ["Cleaner", "cleaner"]));
    const inspector = normalizeCleaner(readText(log, ["Inspector", "inspector"]));
    const action = readText(log, ["Action", "action"]);
    const note = readText(log, ["Note", "note"]);
    const category = readText(log, ["Category", "category"]);
    const priority = readText(log, ["Priority", "priority"]);
    const time = readText(log, ["Time", "time"]);
    const photoUrl = readUrl(log, ["Photo URL", "photo url"]);
    const cleanerError = normalizeCleaner(readText(log, ["Cleaner Error", "cleaner error"]));

    const item = {
      unit,
      cleaner,
      inspector,
      action,
      note,
      category,
      priority,
      time,
      photoUrl,
      cleanerError,
      displayTime: formatReportTime(time),
    };

    if (!logsByUnit[unit]) logsByUnit[unit] = [];
    logsByUnit[unit].push(item);

    if (cleaner) {
      if (!logsByCleaner[cleaner]) logsByCleaner[cleaner] = [];
      logsByCleaner[cleaner].push(item);
    }

    if (inspector) {
      if (!logsByInspector[inspector]) logsByInspector[inspector] = [];
      logsByInspector[inspector].push(item);
    }
  });

  const centralUnits = centralRooms.map((page) => {
    const unitTitle = getRoomTitleFromPage(page);
    const unitKey = normalizeReportUnit(unitTitle);
    const assignedCleaner = normalizeCleaner(getAssignedCleaner(page));
    const status = readText(page, ["Cleaning Status", "Status", "status"]);
    const startedAt = readText(page, ["Started At", "started at"]);
    const finishedAt = readText(page, ["Finished At", "finished at"]);

    return {
      unitTitle,
      unitKey,
      assignedCleaner,
      status,
      startedAt,
      finishedAt,
      startedDisplay: formatReportTime(startedAt),
      finishedDisplay: formatReportTime(finishedAt),
      logs: logsByUnit[unitKey] || [],
    };
  });

  const totalUnits = centralUnits.length;
  const completedUnits = centralUnits.filter((u) => u.finishedAt).length;
  const readyUnits = centralUnits.filter((u) =>
    String(u.status || "").toLowerCase().includes("ready")
  ).length;

  const assignedCleaners = new Set(
    centralUnits.map((u) => u.assignedCleaner).filter(Boolean)
  );

  const activeInspectors = new Set(
    logs.map((log) => normalizeCleaner(readText(log, ["Inspector", "inspector"]))).filter(Boolean)
  );

  let issues = 0;
  let supplyRequests = 0;
  let lostAndFound = 0;
  let cleanerErrors = 0;
  let highPriority = 0;

  logs.forEach((log) => {
    const action = readText(log, ["Action", "action"]).toLowerCase();
    const category = readText(log, ["Category", "category"]).toLowerCase();
    const priority = readText(log, ["Priority", "priority"]).toLowerCase();

    if (
      action.includes("issue") ||
      action.includes("report") ||
      category.includes("maintenance") ||
      category.includes("damage") ||
      category.includes("cleaning")
    ) {
      issues++;
    }

    if (action.includes("supplies") || category.includes("supplies")) {
      supplyRequests++;
    }

    if (action.includes("lost_found") || category.includes("guest item")) {
      lostAndFound++;
    }

    if (action === "inspection_report") {
      cleanerErrors++;
    }

    if (
      priority.includes("high") ||
      priority.includes("urgent") ||
      priority.includes("alta") ||
      priority.includes("urgente")
    ) {
      highPriority++;
    }
  });

  const cleanerSummary = {};

  centralUnits.forEach((unit) => {
    const cleaner = unit.assignedCleaner || "Sin asignar";

    if (!cleanerSummary[cleaner]) {
      cleanerSummary[cleaner] = [];
    }

    const unitLogs = unit.logs || [];

    const requests = unitLogs.filter((l) =>
      String(l.action || "").toLowerCase().includes("supplies")
    );

    const problems = unitLogs.filter((l) => {
      const a = String(l.action || "").toLowerCase();
      const c = String(l.category || "").toLowerCase();

      return (
        a.includes("issue") ||
        a.includes("report") ||
        a.includes("lost_found") ||
        c.includes("maintenance") ||
        c.includes("damage") ||
        c.includes("guest item")
      );
    });

    cleanerSummary[cleaner].push({
      unit: unit.unitTitle,
      start: unit.startedDisplay,
      finish: unit.finishedDisplay,
      status: unit.status || "N/A",
      requests,
      problems,
    });
  });

  const inspectorSummary = {};

  logs.forEach((log) => {
    const inspector = normalizeCleaner(readText(log, ["Inspector", "inspector"]));
    const unit = readText(log, ["Unit", "unit"]);
    const action = readText(log, ["Action", "action"]);
    const note = readText(log, ["Note", "note"]);
    const priority = readText(log, ["Priority", "priority"]);
    const category = readText(log, ["Category", "category"]);
    const time = readText(log, ["Time", "time"]);
    const photoUrl = readUrl(log, ["Photo URL", "photo url"]);

    if (!inspector) return;

    if (!inspectorSummary[inspector]) {
      inspectorSummary[inspector] = {};
    }

    if (!inspectorSummary[inspector][unit]) {
      inspectorSummary[inspector][unit] = {
        start: "",
        finish: "",
        requests: [],
        problems: [],
      };
    }

    const target = inspectorSummary[inspector][unit];
    const actionLower = String(action || "").toLowerCase();
    const categoryLower = String(category || "").toLowerCase();

    if (actionLower === "inspection_start") {
      target.start = formatReportTime(time);
    }

    if (actionLower === "ready_guest") {
      target.finish = formatReportTime(time);
    }

    if (actionLower.includes("supplies") || categoryLower.includes("supplies")) {
      target.requests.push({
        time: formatReportTime(time),
        note: note || "Supply request",
        priority,
        photoUrl,
      });
    }

    if (
      actionLower.includes("inspection_report") ||
      actionLower.includes("lost_found") ||
      categoryLower.includes("maintenance") ||
      categoryLower.includes("damage") ||
      categoryLower.includes("guest item")
    ) {
      target.problems.push({
        time: formatReportTime(time),
        note: note || "Issue reported",
        priority,
        photoUrl,
      });
    }
  });

  const doc = new PDFDocument({ margin: 45 });
  doc.pipe(fs.createWriteStream(filePath));

  function sectionTitle(title) {
    if (doc.y > 700) doc.addPage();
    doc.moveDown(0.6);
    doc.fontSize(15).text(title);
    doc.moveDown(0.4);
  }

  function writeSmallLine(textValue) {
    if (doc.y > 735) doc.addPage();
    doc.fontSize(9).text(textValue);
  }

  function writeNoteList(title, items) {
    if (!items || items.length === 0) return;

    writeSmallLine(title);

    items.forEach((item) => {
      const priority = item.priority ? ` (${item.priority})` : "";
      const photo = item.photoUrl ? " | Photo attached" : "";
      writeSmallLine(`  - ${item.time || ""} ${item.note || ""}${priority}${photo}`);
    });
  }

  doc.fontSize(20).text("DAILY REPORT", { align: "center" });
  doc.moveDown();
  doc.fontSize(11).text(`Date: ${date}`);
  doc.text(`Company: ${process.env.COMPANY_NAME || "417 Maid Cleaning Services"}`);

  sectionTitle("1. Executive Summary");
  doc.fontSize(11).text(`Total Units from Central Page: ${totalUnits}`);
  doc.text(`Units Finished by Cleaners: ${completedUnits}`);
  doc.text(`Units Ready for Guest: ${readyUnits}`);
  doc.text(`Issues / Reports: ${issues}`);
  doc.text(`Supply Requests: ${supplyRequests}`);
  doc.text(`Lost & Found: ${lostAndFound}`);
  doc.text(`High Priority Records: ${highPriority}`);
  doc.text(`Cleaner Errors: ${cleanerErrors}`);
  doc.text(`Assigned Cleaners: ${assignedCleaners.size}`);
  doc.text(`Active Inspectors: ${activeInspectors.size}`);

  sectionTitle("2. Units from Central Page");
  if (centralUnits.length === 0) {
    doc.fontSize(10).text("No units found in the central page for this date.");
  } else {
    centralUnits
      .sort((a, b) => a.unitTitle.localeCompare(b.unitTitle))
      .forEach((unit) => {
        writeSmallLine(
          `${unit.unitTitle} | Cleaner: ${unit.assignedCleaner || "Sin asignar"} | Status: ${unit.status || "N/A"} | Start: ${unit.startedDisplay} | Finish: ${unit.finishedDisplay}`
        );
      });
  }

  doc.addPage();
  doc.fontSize(16).text("3. Cleaner Summary", { align: "center" });
  doc.moveDown();

  Object.entries(cleanerSummary)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([cleaner, units]) => {
      if (doc.y > 680) doc.addPage();

      doc.fontSize(12).text(cleaner);
      doc.moveDown(0.25);

      units
        .sort((a, b) => a.unit.localeCompare(b.unit))
        .forEach((item) => {
          writeSmallLine(
            `Unit ${item.unit} | Start: ${item.start} | Finished: ${item.finish} | Status: ${item.status}`
          );

          writeNoteList("  Requests:", item.requests);
          writeNoteList("  Problems / Lost & Found:", item.problems);

          doc.moveDown(0.2);
        });

      doc.moveDown(0.5);
    });

  doc.addPage();
  doc.fontSize(16).text("4. Inspector Summary", { align: "center" });
  doc.moveDown();

  if (Object.keys(inspectorSummary).length === 0) {
    doc.fontSize(10).text("No inspector activity found.");
  } else {
    Object.entries(inspectorSummary)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([inspector, units]) => {
        if (doc.y > 680) doc.addPage();

        doc.fontSize(12).text(inspector);
        doc.moveDown(0.25);

        Object.entries(units)
          .sort(([a], [b]) => a.localeCompare(b))
          .forEach(([unit, item]) => {
            writeSmallLine(
              `Unit ${unit || "N/A"} | Inspection Start: ${item.start || "N/A"} | Ready for Guest: ${item.finish || "N/A"}`
            );

            writeNoteList("  Requests:", item.requests);
            writeNoteList("  Problems / Lost & Found:", item.problems);

            doc.moveDown(0.2);
          });

        doc.moveDown(0.5);
      });
  }

  doc.end();

  return {
    fileName,
    fileUrl: `/reports/${fileName}`,
    totalRecords: logs.length,
    totalUnits,
  };
}


// =========================================================
// NUEVO MÓDULO: REPORTES INTELIGENTES + FOTOS MÚLTIPLES
// =========================================================
function limitText(value, max = 1900) {
  return String(value || "").slice(0, max);
}

function readPlainTextFromProp(prop) {
  if (!prop) return "";
  if (prop.title) return prop.title.map((t) => t.plain_text).join("");
  if (prop.rich_text) return prop.rich_text.map((t) => t.plain_text).join("");
  if (prop.select) return prop.select.name || "";
  if (prop.status) return prop.status.name || "";
  if (prop.date) return prop.date.start || "";
  if (prop.url) return prop.url || "";
  if (prop.checkbox !== undefined) return prop.checkbox ? "Yes" : "No";
  if (prop.number !== null && prop.number !== undefined) return String(prop.number);
  return "";
}

function buildRichTextValue(value) {
  return {
    rich_text: [
      {
        text: {
          content: limitText(value, 1900),
        },
      },
    ],
  };
}

function buildTitleValue(value) {
  return {
    title: [
      {
        text: {
          content: limitText(value, 180),
        },
      },
    ],
  };
}

function buildNotionProp(schema, names, value, forcedType = null) {
  const name = findPropName(schema, names);
  if (!name) return null;

  const type = forcedType || schema[name].type;
  const text = String(value ?? "");

  if (type === "title") return { name, value: buildTitleValue(text) };
  if (type === "rich_text") return { name, value: buildRichTextValue(text) };
  if (type === "date") return { name, value: { date: { start: text } } };
  if (type === "select") return { name, value: { select: { name: text || "Other" } } };
  if (type === "status") return { name, value: { status: { name: text || "Received" } } };
  if (type === "checkbox") return { name, value: { checkbox: !!value } };
  if (type === "number") return { name, value: { number: Number(value || 0) } };
  if (type === "url") return { name, value: { url: text || null } };

  return null;
}

function addNotionProp(props, schema, names, value, forcedType = null) {
  const prop = buildNotionProp(schema, names, value, forcedType);
  if (prop) props[prop.name] = prop.value;
}

async function uploadBufferToCloudinary(file, folder = "housekeeping/reports") {
  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;

  return cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
    quality: "auto:best",
  });
}

async function analyzeReportMessageWithAI({ unit, employee, role, message, action }) {
  const safeMessage = String(message || "").trim();

  if (!OPENAI_API_KEY || !safeMessage) {
    return {
      category: "General Message",
      priority: "Normal",
      summary: safeMessage || "Sin mensaje",
      suggestedHotSOS: "",
      needsHotSOS: false,
      detectedItems: "",
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente de operaciones de housekeeping hotelero. Clasifica mensajes de limpiadores e inspectores. Responde solo JSON válido, sin markdown.",
        },
        {
          role: "user",
          content: `
Unidad: ${unit}
Empleado: ${employee}
Rol: ${role}
Acción: ${action || "REPORT"}
Mensaje original: ${safeMessage}

Clasifica el mensaje sin pedir categorías al empleado.
Devuelve exactamente este JSON:
{
  "category": "Supplies | Maintenance | Lost & Found | Cleaner Error | Damage | Ready Note | Guest Request | General Message | Multiple",
  "priority": "Normal | Urgent | Blocking Room",
  "summary": "resumen corto en español para operaciones",
  "suggestedHotSOS": "texto corto en inglés para copiar y pegar en HotSOS, o vacío si no aplica",
  "needsHotSOS": true,
  "detectedItems": "lista corta de cosas detectadas, como towels, toilet clogged, hair, remote missing"
}

Reglas:
- Si hay mantenimiento, daño, falta de supplies, objeto perdido, bloqueo de unidad o error importante, needsHotSOS debe ser true.
- Si sólo dice que terminó, inició, o es una nota general sin acción externa, needsHotSOS debe ser false.
- Si hay más de una categoría, usa Multiple.
`,
        },
      ],
    });

    const text = response.choices[0].message.content || "{}";
    const cleanText = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanText);

    return {
      category: parsed.category || "General Message",
      priority: parsed.priority || "Normal",
      summary: parsed.summary || safeMessage,
      suggestedHotSOS: parsed.suggestedHotSOS || "",
      needsHotSOS: !!parsed.needsHotSOS,
      detectedItems: parsed.detectedItems || "",
    };
  } catch (error) {
    console.log("■■ OpenAI report error:", error.message);
    return {
      category: "General Message",
      priority: "Normal",
      summary: safeMessage || "Sin mensaje",
      suggestedHotSOS: "",
      needsHotSOS: false,
      detectedItems: "",
    };
  }
}

async function createReportMessage({
  unit,
  employee,
  role,
  action = "REPORT",
  message,
  ai,
  photoUrls = [],
  sourcePanel = "Unknown",
}) {
  if (!NOTION_REPORTS_DATABASE_ID) {
    throw new Error("Falta NOTION_REPORTS_DB_ID en Render");
  }

  const now = new Date().toISOString();
  const reportId = `RPT-${Date.now()}`;
  const schema = await getDatabaseSchema(NOTION_REPORTS_DATABASE_ID);
  const props = {};

  addNotionProp(props, schema, ["Report ID", "Report", "Name", "Title"], `${reportId} - ${unit}`, "title");
  addNotionProp(props, schema, ["Date", "date"], todayISO(), "date");
  addNotionProp(props, schema, ["Time", "time", "Created At"], now, "date");
  addNotionProp(props, schema, ["Unit", "unit"], unit);
  addNotionProp(props, schema, ["Employee", "Employee Name", "Name"], employee);
  addNotionProp(props, schema, ["Role", "role"], role || "Cleaner", "select");
  addNotionProp(props, schema, ["Action", "action"], action || "REPORT", "select");
  addNotionProp(props, schema, ["Original Message", "Message", "Note"], message || "");
  addNotionProp(props, schema, ["AI Category", "Category"], ai?.category || "General Message", "select");
  addNotionProp(props, schema, ["AI Priority", "Priority"], ai?.priority || "Normal", "select");
  addNotionProp(props, schema, ["AI Summary", "Summary"], ai?.summary || message || "");
  addNotionProp(props, schema, ["Suggested HotSOS Text", "HotSOS Text", "HOTSOS Text"], ai?.suggestedHotSOS || "");
  addNotionProp(props, schema, ["Needs HotSOS", "Needs HOTSOS"], !!ai?.needsHotSOS, "checkbox");
  addNotionProp(props, schema, ["HotSOS Sent", "HOTSOS Sent"], false, "checkbox");
  addNotionProp(props, schema, ["Photos Count", "Photo Count"], photoUrls.length, "number");
  addNotionProp(props, schema, ["Status", "status"], "Received", "select");
  addNotionProp(props, schema, ["Source Panel", "Source"], sourcePanel, "select");
  addNotionProp(props, schema, ["Detected Items", "Items Detected"], ai?.detectedItems || "");

  if (schema["First Photo URL"] && photoUrls[0]) {
    props["First Photo URL"] = { url: photoUrls[0] };
  }

  const page = await notion.pages.create({
    parent: {
      database_id: NOTION_REPORTS_DATABASE_ID,
    },
    properties: props,
  });

  return {
    reportId,
    notionPageId: page.id,
    createdAt: now,
  };
}

async function saveReportPhotos({ reportId, reportPageId, unit, employee, photoUrls }) {
  if (!NOTION_REPORT_PHOTOS_DATABASE_ID || !photoUrls || photoUrls.length === 0) {
    return [];
  }

  const schema = await getDatabaseSchema(NOTION_REPORT_PHOTOS_DATABASE_ID);
  const created = [];

  for (let i = 0; i < photoUrls.length; i++) {
    const url = photoUrls[i];
    const photoId = `${reportId}-PHOTO-${i + 1}`;
    const props = {};

    addNotionProp(props, schema, ["Photo ID", "Photo", "Name", "Title"], photoId, "title");
    addNotionProp(props, schema, ["Report ID", "Report"], reportId);
    addNotionProp(props, schema, ["Report Page ID", "Report Page"], reportPageId);
    addNotionProp(props, schema, ["Date", "date"], todayISO(), "date");
    addNotionProp(props, schema, ["Unit", "unit"], unit);
    addNotionProp(props, schema, ["Employee", "Employee Name", "Name"], employee);
    addNotionProp(props, schema, ["Photo URL", "URL", "Image URL"], url, "url");

    const page = await notion.pages.create({
      parent: {
        database_id: NOTION_REPORT_PHOTOS_DATABASE_ID,
      },
      properties: props,
    });

    created.push({ id: page.id, photoId, url });
  }

  return created;
}

function reportPageToObject(page) {
  const p = page.properties || {};
  const dateValue = readPlainTextFromProp(p.Date || p.date);
  const timeValue = readPlainTextFromProp(p.Time || p.time || p["Created At"]);

  return {
    id: page.id,
    reportId: readPlainTextFromProp(p["Report ID"] || p.Report || p.Name || p.Title),
    date: dateValue,
    timeRaw: timeValue,
    time: timeValue
      ? new Date(timeValue).toLocaleString("en-US", {
          timeZone: "America/Chicago",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : "",
    unit: readPlainTextFromProp(p.Unit || p.unit),
    employee: readPlainTextFromProp(p.Employee || p["Employee Name"] || p.Name),
    role: readPlainTextFromProp(p.Role || p.role),
    action: readPlainTextFromProp(p.Action || p.action),
    message: readPlainTextFromProp(p["Original Message"] || p.Message || p.Note),
    aiCategory: readPlainTextFromProp(p["AI Category"] || p.Category),
    aiPriority: readPlainTextFromProp(p["AI Priority"] || p.Priority),
    aiSummary: readPlainTextFromProp(p["AI Summary"] || p.Summary),
    suggestedHotSOS: readPlainTextFromProp(p["Suggested HotSOS Text"] || p["HotSOS Text"] || p["HOTSOS Text"]),
    needsHotSOS: !!(p["Needs HotSOS"] || p["Needs HOTSOS"])?.checkbox,
    hotsosSent: !!(p["HotSOS Sent"] || p["HOTSOS Sent"])?.checkbox,
    photosCount: (p["Photos Count"] || p["Photo Count"])?.number || 0,
    status: readPlainTextFromProp(p.Status || p.status),
    sourcePanel: readPlainTextFromProp(p["Source Panel"] || p.Source),
    detectedItems: readPlainTextFromProp(p["Detected Items"] || p["Items Detected"]),
    firstPhotoUrl: (p["First Photo URL"] || {})?.url || "",
  };
}

async function getReportPhotosByReportId(reportId) {
  if (!NOTION_REPORT_PHOTOS_DATABASE_ID || !reportId) return [];

  const response = await notion.databases.query({
    database_id: NOTION_REPORT_PHOTOS_DATABASE_ID,
    page_size: 100,
    filter: {
      property: "Report ID",
      rich_text: {
        equals: reportId,
      },
    },
  });

  return response.results.map((page) => {
    const p = page.properties || {};
    return {
      id: page.id,
      photoId: readPlainTextFromProp(p["Photo ID"] || p.Photo || p.Name || p.Title),
      reportId: readPlainTextFromProp(p["Report ID"] || p.Report),
      unit: readPlainTextFromProp(p.Unit || p.unit),
      employee: readPlainTextFromProp(p.Employee || p["Employee Name"] || p.Name),
      url: (p["Photo URL"] || p.URL || p["Image URL"] || {})?.url || "",
    };
  });
}


app.post("/submit-report", upload.array("photos", 20), async (req, res) => {
  try {
    const unit = String(req.body.unit || "").trim();
    const employee = String(req.body.employee || req.body.name || "").trim();
    const role = String(req.body.role || "Cleaner").trim();
    const action = String(req.body.action || "REPORT").trim();
    const message = String(req.body.message || req.body.note || "").trim();
    const sourcePanel = String(req.body.sourcePanel || role || "Unknown").trim();

    if (!unit || !employee || !message) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "Falta unidad, empleado o mensaje",
      });
    }

    const files = req.files || [];
    const uploadResults = [];

    for (const file of files) {
      const uploaded = await uploadBufferToCloudinary(
        file,
        `housekeeping/reports/${todayISO()}/${normalizeRoom(unit) || "unknown"}`
      );
      uploadResults.push(uploaded.secure_url);
    }

    const ai = await analyzeReportMessageWithAI({
      unit,
      employee,
      role,
      message,
      action,
    });

    const report = await createReportMessage({
      unit,
      employee,
      role,
      action,
      message,
      ai,
      photoUrls: uploadResults,
      sourcePanel,
    });

    const photos = await saveReportPhotos({
      reportId: report.reportId,
      reportPageId: report.notionPageId,
      unit,
      employee,
      photoUrls: uploadResults,
    });

    broadcastOpsUpdate({
      type: "report",
      unit,
      employee,
      reportId: report.reportId,
    });

    res.json({
      ok: true,
      success: true,
      message: "Reporte enviado correctamente",
      reportId: report.reportId,
      notionPageId: report.notionPageId,
      photosCount: uploadResults.length,
      photoUrls: uploadResults,
      photos,
      ai,
    });
  } catch (error) {
    console.error("Error en /submit-report:", error.message);
    res.status(500).json({
      ok: false,
      success: false,
      message: error.message,
    });
  }
});

app.get("/my-reports", async (req, res) => {
  try {
    if (!NOTION_REPORTS_DATABASE_ID) {
      return res.json({ ok: true, count: 0, reports: [] });
    }

    const employee = String(req.query.employee || req.query.name || "").trim().toLowerCase();
    const role = String(req.query.role || "").trim().toLowerCase();
    const date = String(req.query.date || todayISO()).trim();

    const response = await notion.databases.query({
      database_id: NOTION_REPORTS_DATABASE_ID,
      page_size: 100,
      filter: {
        property: "Date",
        date: {
          equals: date,
        },
      },
      sorts: [
        {
          property: "Time",
          direction: "descending",
        },
      ],
    });

    let reports = response.results.map(reportPageToObject);

    if (employee) {
      reports = reports.filter((r) => String(r.employee || "").toLowerCase().trim() === employee);
    }

    if (role) {
      reports = reports.filter((r) => String(r.role || "").toLowerCase().trim() === role);
    }

    res.json({
      ok: true,
      date,
      count: reports.length,
      reports,
    });
  } catch (error) {
    console.error("Error en /my-reports:", error.message);
    res.status(500).json({ ok: false, message: error.message, reports: [] });
  }
});

app.get("/operations-reports", async (req, res) => {
  try {
    if (!NOTION_REPORTS_DATABASE_ID) {
      return res.json({ ok: true, count: 0, reports: [] });
    }

    const date = String(req.query.date || todayISO()).trim();
    const includePhotos = true;
    const cacheKey = `operations-reports:${date}:with-photos`;
    const cached = getCache(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const response = await notion.databases.query({
      database_id: NOTION_REPORTS_DATABASE_ID,
      page_size: 100,
      filter: {
        property: "Date",
        date: {
          equals: date,
        },
      },
      sorts: [
        {
          property: "Time",
          direction: "descending",
        },
      ],
    });

    const reports = [];

    for (const page of response.results) {
      const report = reportPageToObject(page);
    if (report.reportId) {
  let cleanReportId = String(report.reportId || "").trim().split(" - ")[0];

  if (cleanReportId && !cleanReportId.startsWith("RPT-")) {
    cleanReportId = `RPT-${cleanReportId}`;
  }

  report.reportId = cleanReportId;
  report.photos = await getReportPhotosByReportId(cleanReportId);
  report.photosCount = report.photos.length;
}
      reports.push(report);
    }

    const payload = {
      ok: true,
      date,
      count: reports.length,
      reports,
    };

    setCache(cacheKey, payload, Number(process.env.ASSIGNMENTS_CACHE_MS || 15000));
    res.json(payload);
  } catch (error) {
    console.error("Error en /operations-reports:", error.message);
    res.status(500).json({ ok: false, message: error.message, reports: [] });
  }
});
app.get("/report-photos", async (req, res) => {
  let reportId = String(req.query.reportId || "").trim();

  if (
    reportId &&
    !reportId.startsWith("RPT-")
  ) {
    reportId = `RPT-${reportId}`;
  }

  try {
    if (!reportId) {
      return res.status(400).json({
        ok: false,
        message: "Report ID requerido"
      });
    }

    const photos = await getReportPhotosByReportId(reportId);

    res.json({
      ok: true,
      reportId,
      count: photos.length,
      photos,
    });

  } catch (error) {
    console.error("Error en /report-photos:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
      photos: []
    });
  }
});

app.post("/mark-hotsos-sent", async (req, res) => {
  try {
    const reportPageId = String(req.body.reportPageId || req.body.id || "").trim();

    if (!reportPageId) {
      return res.status(400).json({ ok: false, message: "Falta reportPageId" });
    }

    if (!NOTION_REPORTS_DATABASE_ID) {
      throw new Error("Falta NOTION_REPORTS_DB_ID en Render");
    }

    const schema = await getDatabaseSchema(NOTION_REPORTS_DATABASE_ID);
    const props = {};

    addNotionProp(props, schema, ["HotSOS Sent", "HOTSOS Sent"], true, "checkbox");
    addNotionProp(props, schema, ["Status", "status"], "Sent to HotSOS", "select");

    await notion.pages.update({
      page_id: reportPageId,
      properties: props,
    });

    broadcastOpsUpdate({
      type: "hotsos-sent",
      reportPageId,
    });

    res.json({ ok: true, message: "Reporte marcado como enviado a HotSOS" });
  } catch (error) {
    console.error("Error en /mark-hotsos-sent:", error.message);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/unit-history", async (req, res) => {
  try {
    const unit = String(req.query.unit || "").trim();
    const employee = String(req.query.employee || req.query.name || "").trim().toLowerCase();
    const date = String(req.query.date || todayISO()).trim();

    if (!unit) {
      return res.status(400).json({ ok: false, message: "Unidad requerida" });
    }

    const normalizedTarget = normalizeRoom(unit);
    const targetDigits = roomDigits(unit);
    const history = [];

    if (NOTION_LOG_DATABASE_ID) {
      const logs = await getDailyLogsForReport(date);
      logs.forEach((log) => {
        const p = log.properties || {};
        const logUnit = readPlainTextFromProp(p.Unit || p.unit);
        const cleaner = readPlainTextFromProp(p.Cleaner || p.cleaner);
        const inspector = readPlainTextFromProp(p.Inspector || p.inspector);
        const person = cleaner || inspector;

        const sameUnit = normalizeRoom(logUnit) === normalizedTarget || roomDigits(logUnit) === targetDigits;
        const sameEmployee = !employee || String(person || "").toLowerCase().trim() === employee;

        if (sameUnit && sameEmployee) {
          history.push({
            source: "Daily Log",
            id: log.id,
            timeRaw: readPlainTextFromProp(p.Time || p.time),
            unit: logUnit,
            employee: person,
            action: readPlainTextFromProp(p.Action || p.action),
            message: readPlainTextFromProp(p.Note || p.note),
            photoUrl: (p["Photo URL"] || {})?.url || "",
          });
        }
      });
    }

    if (NOTION_REPORTS_DATABASE_ID) {
      const reportsResponse = await notion.databases.query({
        database_id: NOTION_REPORTS_DATABASE_ID,
        page_size: 100,
        filter: {
          property: "Date",
          date: {
            equals: date,
          },
        },
      });

      reportsResponse.results.map(reportPageToObject).forEach((report) => {
        const sameUnit = normalizeRoom(report.unit) === normalizedTarget || roomDigits(report.unit) === targetDigits;
        const sameEmployee = !employee || String(report.employee || "").toLowerCase().trim() === employee;

        if (sameUnit && sameEmployee) {
          history.push({
            source: "Report",
            id: report.id,
            timeRaw: report.timeRaw,
            unit: report.unit,
            employee: report.employee,
            action: report.action,
            message: report.message,
            aiCategory: report.aiCategory,
            aiPriority: report.aiPriority,
            hotsosSent: report.hotsosSent,
            photosCount: report.photosCount,
            firstPhotoUrl: report.firstPhotoUrl,
          });
        }
      });
    }

    history.sort((a, b) => String(b.timeRaw || "").localeCompare(String(a.timeRaw || "")));

    res.json({
      ok: true,
      date,
      unit,
      count: history.length,
      history: history.map((item) => ({
        ...item,
        time: item.timeRaw
          ? new Date(item.timeRaw).toLocaleString("en-US", {
              timeZone: "America/Chicago",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
          : "",
      })),
    });
  } catch (error) {
    console.error("Error en /unit-history:", error.message);
    res.status(500).json({ ok: false, message: error.message, history: [] });
  }
});

app.post("/action", async (req, res) => {
  try {
    const { action, unit, note, name, photoUrl } = req.body;

    if (!action || !unit || !name) {
      return res.status(400).json({
        success: false,
        message: "Faltan datos: nombre, unidad o acción",
      });
    }

    if (isDuplicateAction(action, unit, name)) {
      return res.status(400).json({
        success: false,
        message: "Acción ya registrada recientemente",
      });
    }

    if ((action === "ISSUE" || action === "SUPPLIES" || action === "LOST_FOUND") && !String(note || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "Debes escribir una nota",
      });
    }

    const result = await updateNotionRoom(unit, action, name, note, "cleaner", photoUrl);

    if (action === "DONE") {
      await notifyInspectors(unit);
    }
    broadcastOpsUpdate({
      type: "action",
      action,
      unit,
      employee: name,
      message: note || "",
    });
    res.json({
      success: true,
      message: `Enviado correctamente: ${result.label} - ${unit}`,
    });
  } catch (error) {
    console.error("Error en /action:", error.message);

    res.status(500).json({
      success: false,
      message: `Error: ${error.message}`,
    });
  }
});

app.post("/inspector-action", async (req, res) => {
  try {
    const { action, unit, note, name, photoUrl } = req.body;

    if (!action || !unit || !name) {
      return res.status(400).json({
        success: false,
        message: "Faltan datos: inspector, unidad o acción",
      });
    }

    if (isDuplicateAction(action, unit, name)) {
      return res.status(400).json({
        success: false,
        message: "Acción ya registrada recientemente",
      });
    }

    if (
      (action === "INSPECTION_REPORT" || action === "INSPECTION_SUPPLIES" || action === "LOST_FOUND") &&
      !String(note || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Debes escribir una nota",
      });
    }

    const result = await updateNotionRoom(unit, action, name, note, "inspector", photoUrl);
    broadcastOpsUpdate({
      type: "action",
      action,
      unit,
      employee: name,
      message: note || "",
    });
    res.json({
      success: true,
      message: `Inspector: ${result.label} - ${unit}`,
    });
  } catch (error) {
    console.error("Error inspector:", error.message);

    res.status(500).json({
      success: false,
      message: `Error: ${error.message}`,
    });
  }
});

app.get("/operations-events", async (req, res) => {
  try {
    if (!NOTION_LOG_DATABASE_ID) {
      return res.json({
        count: 0,
        events: [],
      });
    }

    const response = await notion.databases.query({
      database_id: NOTION_LOG_DATABASE_ID,
      page_size: 20,
      sorts: [
        {
          property: "Time",
          direction: "descending",
        },
      ],
    });

    const events = response.results.map((page) => {
      const props = page.properties;

      return {
        id: page.id,

        time:
          props.Time?.date?.start
            ? new Date(props.Time.date.start).toLocaleString("en-US", {
                timeZone: "America/Chicago",
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              })
            : "",

        unit:
          props.Unit?.rich_text
            ?.map((t) => t.plain_text)
            .join("") || "",

        action:
          props.Action?.select?.name || "",

        person:
          props.Cleaner?.rich_text
            ?.map((t) => t.plain_text)
            .join("") ||
          props.Inspector?.rich_text
            ?.map((t) => t.plain_text)
            .join("") ||
          "",

        note:
          props.Note?.rich_text
            ?.map((t) => t.plain_text)
            .join("") || "",
        
        photoUrl:
          props["Photo URL"]?.url || "",
      };
    });

    res.json({
      count: events.length,
      events,
    });
  } catch (error) {
    console.error("Error en /operations-events:", error.message);

    res.status(500).json({
      count: 0,
      events: [],
      error: error.message,
    });
  }
});

app.post("/generate-daily-report", async (req, res) => {
  try {
    const date = req.body.date || todayISO();

    const report = await generateDailyReport(date);

    res.json({
      ok: true,
      message: "Daily report generated successfully",
      date,
      totalRecords: report.totalRecords,
      file: report.fileName,
      url: report.fileUrl,
      fullUrl: `${req.protocol}://${req.get("host")}${report.fileUrl}`,
    });
  } catch (error) {
    console.error("Error generating daily report:", error.message);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/generate-daily-report", async (req, res) => {
  try {
    const date = req.query.date || todayISO();

    const report = await generateDailyReport(date);

    res.redirect(report.fileUrl);
  } catch (error) {
    console.error("Error generating daily report:", error.message);
    res.status(500).send(`Error generating report: ${error.message}`);
  }
});

app.get("/finalizar-dia", async (req, res) => {
  try {
    const date = req.query.date || todayISO();

    const report = await generateDailyReport(date);

    const filePath = path.join(reportsDir, report.fileName);

    setTimeout(() => {
      res.download(filePath, report.fileName);
    }, 1500);
  } catch (error) {
    console.error("Error finalizando día:", error.message);
    res.status(500).send(`Error finalizando día: ${error.message}`);
  }
});

app.post("/generate-payroll-excel", async (req, res) => {
  try {
    const requestedStart = String(req.body.start || "").trim();
    const requestedEnd = String(req.body.end || "").trim();

    let weekStart;
    let weekEnd;

    if (requestedStart && requestedEnd) {
      weekStart = requestedStart;
      weekEnd = requestedEnd;
    } else {
      const selectedDate = req.body.date || todayISO();
      const week = getPayrollWeek(new Date(`${selectedDate}T12:00:00`));
      weekStart = week.weekStart;
      weekEnd = week.weekEnd;
    }

    const payroll = await generateWeeklyPayrollExcel(weekStart, weekEnd);

    res.json({
      ok: true,
      message: "Payroll Excel updated successfully",
      weekStart,
      weekEnd,
      totalRecords: payroll.totalRecords,
      file: payroll.fileName,
      url: payroll.fileUrl,
      fullUrl: `${req.protocol}://${req.get("host")}${payroll.fileUrl}`,
    });
  } catch (error) {
    console.error("Error generating payroll Excel:", error.message);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/payroll-excel", async (req, res) => {
  try {
    const requestedStart = String(req.query.start || "").trim();
    const requestedEnd = String(req.query.end || "").trim();

    let weekStart;
    let weekEnd;

    if (requestedStart && requestedEnd) {
      weekStart = requestedStart;
      weekEnd = requestedEnd;
    } else {
      const selectedDate = req.query.date || todayISO();
      const week = getPayrollWeek(new Date(`${selectedDate}T12:00:00`));
      weekStart = week.weekStart;
      weekEnd = week.weekEnd;
    }

    const payroll = await generateWeeklyPayrollExcel(weekStart, weekEnd);

    res.download(payroll.filePath, payroll.fileName);
  } catch (error) {
    console.error("Error descargando Payroll Excel:", error.message);
    res.status(500).send(`Error descargando Payroll Excel: ${error.message}`);
  }
});
app.get("/backfill-payroll", async (req, res) => {
  try {
    const start = req.query.start || "2026-06-15";
    const end = req.query.end || todayISO();

    let pages = [];
    let cursor = undefined;

    do {
      const body = {
        page_size: 100,
        query: "",
        filter: {
          property: "object",
          value: "page",
        },
      };

      if (cursor) body.start_cursor = cursor;

      const response = await notionFetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_API_VERSION,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        console.log("NOTION BACKFILL SEARCH ERROR:", data);
        throw new Error(data.message || "Error buscando páginas en Notion");
      }

      const filtered = (data.results || []).filter((page) => {
        const props = page.properties || {};

        const date = props.Date?.date?.start || "";
        const unit =
          props["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";

        const cleaner =
          props["Assigned Cleaner"]?.select?.name ||
          props["Assigned Cleaner"]?.rich_text?.map((t) => t.plain_text).join("") ||
          "";

        return date >= start && date <= end && unit && cleaner;
      });

      pages = pages.concat(filtered);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    let created = 0;
    let skipped = 0;
    let errors = [];

    for (const page of pages) {
      const props = page.properties;

      const date = props.Date?.date?.start || "";

      const unit =
        props["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";

      const cleaner =
        props["Assigned Cleaner"]?.select?.name ||
        props["Assigned Cleaner"]?.rich_text?.map((t) => t.plain_text).join("") ||
        "";

      if (!date || !unit || !cleaner) {
        skipped++;
        continue;
      }

      try {
        await createPayrollRecord({
          cleaner,
          unit,
          date,
        });

        await sleep(350);
        created++;
      } catch (error) {
        errors.push({
          unit,
          cleaner,
          date,
          error: error.message,
        });
      }
    }

    await generateWeeklyPayrollExcel(start, end);

    res.json({
      ok: true,
      message: "Backfill payroll completed",
      start,
      end,
      found: pages.length,
      created,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("Error en backfill payroll:", error.message);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});
app.get("/delete-payroll-week", async (req, res) => {
  try {
    const start = req.query.start;
    const end = req.query.end;

    const records = await getPayrollRecords(start, end);

    let deleted = 0;

    for (const record of records) {
      const response = await notion.databases.query({
        database_id: NOTION_PAYROLL_DATABASE_ID,
        filter: {
          and: [
            {
              property: "Date",
              date: {
                equals: record.date,
              },
            },
            {
              property: "Cleaner",
              rich_text: {
                equals: record.cleaner,
              },
            },
            {
              property: "Unit",
              rich_text: {
                equals: record.unit,
              },
            },
          ],
        },
      });

      for (const page of response.results) {
        await notion.pages.update({
          page_id: page.id,
          archived: true,
        });

        deleted++;
      }
    }

    res.json({
      ok: true,
      deleted,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});
app.get("/time-clock", (req, res) => {
  res.sendFile(__dirname + "/public/time-clock.html");
});
app.get("/inspector-assignments", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "Código requerido",
      });
    }

    const date = todayISO();
    const ttlMs = Number(process.env.ASSIGNMENTS_CACHE_MS || 15000);
    const coreCacheKey = `core:inspector-assignments:${date}:${code}`;

    const payload = await OSCore.cache.remember(
      coreCacheKey,
      ttlMs,
      async () => {
        const employee = await findEmployeeByCode(code);

        if (!employee) {
          const error = new Error("Código no encontrado");
          error.status = 404;
          throw error;
        }

        const user = pageToUser(employee);

        if (!user.active) {
          const error = new Error("Empleado inactivo");
          error.status = 403;
          throw error;
        }

        if (!userCan(user, "inspection")) {
          const error = new Error("Este código no tiene acceso a inspecciones");
          error.status = 403;
          throw error;
        }

        const inspectorName = user.name;
        const role = user.role;
        const canSeeAll = userCan(user, "all") || userCan(user, "operations");
        const pages = await queryRoomsByDate(date);

        const units = pages
          .map((page) => {
            const props = page.properties;
            const assignedInspector =
              props["Assigned Inspector"]?.multi_select?.map((i) => i.name).join(", ") ||
              props["Assigned Inspector"]?.select?.name ||
              props["Assigned Inspector"]?.rich_text?.map((t) => t.plain_text).join("") ||
              "";
            const flags = getRoomOpsFlags(page);

            return {
              id: page.id,
              unit: props["Room Number"]?.title?.map((t) => t.plain_text).join("") || "",
              status: props["Cleaning Status"]?.status?.name || "",
              priority: props.Priority?.select?.name || "Normal",
              assignedInspector,
              arrival: !!props.Arrival?.checkbox,
              guestOut: flags.guestOut,
              guestOutAt: flags.guestOutAt,
              preInspection: flags.preInspection,
              preInspectionStarted: flags.preInspectionStarted,
              preInspectionStartedAt: flags.preInspectionStartedAt,
              preInspectionCompletedAt: flags.preInspectionCompletedAt,
            };
          })
          .filter((item) => {
            if (canSeeAll) return true;

            const inspectorList = String(item.assignedInspector || "")
              .toLowerCase()
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);

            return inspectorList.includes(inspectorName.toLowerCase().trim());
          });

        OSCore.metrics.increment("reads.assignments.inspectorBuilt");

        return {
          ok: true,
          inspector: inspectorName,
          role,
          permissions: user.permissions,
          count: units.length,
          units,
        };
      },
      [`assignments:${date}`, "assignments", `inspector:${code}`]
    );

    return res.json(payload);
  } catch (error) {
    console.error("Error en /inspector-assignments:", error.message);
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.get("/cleaner-assignments", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();

    if (!name) {
      return res.status(400).json({
        ok: false,
        message: "Nombre requerido",
      });
    }

    const cleanText = (value) => String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    const typedName = cleanText(name);
    const date = todayISO();
    const ttlMs = Number(process.env.ASSIGNMENTS_CACHE_MS || 15000);
    const coreCacheKey = `core:cleaner-assignments:${date}:${typedName}`;

    const payload = await OSCore.cache.remember(
      coreCacheKey,
      ttlMs,
      async () => {
        const pages = await queryRoomsByDate(date);

        const units = pages
          .map((page) => {
            const props = page.properties;
            const assignedCleaner =
              props["Assigned Cleaner"]?.select?.name ||
              props["Assigned Cleaner"]?.rich_text?.map((t) => t.plain_text).join("") ||
              "";
            const flags = getRoomOpsFlags(page);

            return {
              id: page.id,
              unit: props["Room Number"]?.title?.map((t) => t.plain_text).join("") || "",
              status: props["Cleaning Status"]?.status?.name || "",
              assignedCleaner,
              arrival: !!props.Arrival?.checkbox,
              guestOut: flags.guestOut,
              guestOutAt: flags.guestOutAt,
              preInspection: flags.preInspection,
              preInspectionStarted: flags.preInspectionStarted,
              preInspectionStartedAt: flags.preInspectionStartedAt,
              preInspectionCompletedAt: flags.preInspectionCompletedAt,
            };
          })
          .filter((item) => {
            const assignedCleaner = cleanText(item.assignedCleaner);
            return !!typedName && !!assignedCleaner && assignedCleaner.includes(typedName);
          });

        OSCore.metrics.increment("reads.assignments.cleanerBuilt");

        return {
          ok: true,
          cleaner: name,
          count: units.length,
          units,
        };
      },
      [`assignments:${date}`, "assignments", `cleaner:${typedName}`]
    );

    return res.json(payload);
  } catch (error) {
    console.error("Error en /cleaner-assignments:", error.message);
    return res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function distanceFeet(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const meters = R * c;

  return meters * 3.28084;
}

function validateHotelLocation(body) {
  const hotelLat = toNumber(process.env.HOTEL_LAT || 36.638366);
  const hotelLng = toNumber(process.env.HOTEL_LNG || -93.350305);
  const radiusFeet = toNumber(process.env.HOTEL_RADIUS_FEET || 300);

  const lat = toNumber(body.lat);
  const lng = toNumber(body.lng);
  const accuracy = toNumber(body.accuracy);

  if (lat === null || lng === null) {
    return {
      ok: false,
      status: "GPS Error",
      message: "No se pudo obtener tu ubicación. Activa Location Services e intenta de nuevo.",
      distanceFeet: null,
      accuracy,
      lat,
      lng,
    };
  }

  const distance = distanceFeet(hotelLat, hotelLng, lat, lng);

  if (distance > radiusFeet) {
    return {
      ok: false,
      status: "Outside Property",
      message: `Debes estar dentro del hotel para registrar tu horario. Distancia aproximada: ${Math.round(distance)} ft.`,
      distanceFeet: Number(distance.toFixed(2)),
      accuracy,
      lat,
      lng,
    };
  }

  return {
    ok: true,
    status: "Inside Property",
    message: "Ubicación validada.",
    distanceFeet: Number(distance.toFixed(2)),
    accuracy,
    lat,
    lng,
  };
}

app.post("/mobile-cleaner-login", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();

    if (!name) {
      return res.status(400).json({
        ok: false,
        message: "Nombre requerido",
      });
    }

    const cleanText = (value) => {
      return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    };

    const typedName = cleanText(name);
    const pages = await queryTodayRooms();

    const units = pages
      .map((page) => {
        const props = page.properties;

        const assignedCleaner =
          props["Assigned Cleaner"]?.select?.name ||
          props["Assigned Cleaner"]?.rich_text?.map((t) => t.plain_text).join("") ||
          "";

        const flags = getRoomOpsFlags(page);

        return {
          id: page.id,
          unit: props["Room Number"]?.title?.map((t) => t.plain_text).join("") || "",
          status: props["Cleaning Status"]?.status?.name || "",
          assignedCleaner,
          arrival: !!props.Arrival?.checkbox,
          guestOut: flags.guestOut,
          guestOutAt: flags.guestOutAt,
          preInspection: flags.preInspection,
          preInspectionStarted: flags.preInspectionStarted,
          preInspectionStartedAt: flags.preInspectionStartedAt,
          preInspectionCompletedAt: flags.preInspectionCompletedAt,
        };
      })
      .filter((item) => {
        const assignedCleaner = cleanText(item.assignedCleaner);

        return typedName && assignedCleaner && assignedCleaner.includes(typedName);
      });

    if (units.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "No encontré unidades asignadas para ese nombre hoy.",
      });
    }

    res.json({
      ok: true,
      employee: name,
      role: "Cleaner",
      home: "cleaner",
      count: units.length,
      units,
    });

  } catch (error) {
    console.error("Error en /mobile-cleaner-login:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.post("/mobile-code-login", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "Código requerido",
      });
    }

    const employee = await findEmployeeByCode(code);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: "Código no encontrado",
      });
    }

    const employeeName =
      getEmployeeNameFromPage(employee);

    const role =
      getEmployeeRoleFromPage(employee);

    const home =
      mobileHomeFromRole(role);

    res.json({
      ok: true,
      employee: employeeName,
      role,
      code,
      home,
      employeeId: employee.id,
    });

  } catch (error) {
    console.error(
      "Error en /mobile-code-login:",
      error
    );

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.post("/clock-in", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();
    const location = validateHotelLocation(req.body);

    if (!code) {
      return res.status(400).json({
        error: "Employee code required",
      });
    }

    if (!location.ok) {
      return res.status(403).json({
        ok: false,
        error: location.message,
        locationStatus: location.status,
        distanceFeet: location.distanceFeet,
        accuracy: location.accuracy,
      });
    }

    const employee = await findEmployeeByCode(code);

    if (!employee) {
      return res.status(404).json({
        error: "Employee not found",
      });
    }

    const props = employee.properties;

    const employeeName =
      props.Employee?.title?.map((t) => t.plain_text).join("") || "";

    const role =
      props.Role?.select?.name || "";

    const hourlyRate =
      props["Hourly Rate"]?.number || 0;

    await notion.pages.create({
      parent: {
        database_id: NOTION_TIME_CLOCK_DATABASE_ID,
      },
      properties: {
        Entry: {
          title: [
            {
              text: {
                content: `${employeeName} Clock In`,
              },
            },
          ],
        },

        Employee: {
          rich_text: [
            {
              text: {
                content: employeeName,
              },
            },
          ],
        },

        Code: {
          rich_text: [
            {
              text: {
                content: code,
              },
            },
          ],
        },

        Role: {
          select: {
            name: role,
          },
        },

        "Hourly Rate": {
          number: hourlyRate,
        },

        "Clock In": {
          date: {
            start: new Date().toISOString(),
          },
        },

        "Clock In Lat": {
          number: location.lat,
        },

        "Clock In Lng": {
          number: location.lng,
        },

        "Clock In Distance": {
          number: location.distanceFeet,
        },

        "Clock In Accuracy": {
          number: location.accuracy,
        },

        "Location Status": {
          select: {
            name: location.status,
          },
        },

        Status: {
          select: {
            name: "Working",
          },
        },
      },
    });

    res.json({
      ok: true,
      message: `${employeeName} clocked in. Location OK (${Math.round(location.distanceFeet)} ft).`,
      locationStatus: location.status,
      distanceFeet: location.distanceFeet,
      accuracy: location.accuracy,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message,
    });
  }
});

app.post("/clock-out", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();
    const location = validateHotelLocation(req.body);

    if (!code) {
      return res.status(400).json({
        error: "Employee code required",
      });
    }

    if (!location.ok) {
      return res.status(403).json({
        ok: false,
        error: location.message,
        locationStatus: location.status,
        distanceFeet: location.distanceFeet,
        accuracy: location.accuracy,
      });
    }

    const response = await notion.databases.query({
      database_id: NOTION_TIME_CLOCK_DATABASE_ID,
      page_size: 100,
    });

    const activeEntry = response.results.find((page) => {
      const pageCode =
        page.properties.Code?.rich_text
          ?.map((t) => t.plain_text)
          .join("") || "";

      const status =
        page.properties.Status?.select?.name || "";

      return pageCode === code && status === "Working";
    });

    if (!activeEntry) {
      return res.status(404).json({
        error: "No active clock-in found",
      });
    }

    const clockIn =
      activeEntry.properties["Clock In"]?.date?.start;

    if (!clockIn) {
      return res.status(400).json({
        error: "Clock In not found",
      });
    }

    const clockOut = new Date();

    const hours =
      (clockOut.getTime() - new Date(clockIn).getTime()) /
      (1000 * 60 * 60);

    const rate =
      activeEntry.properties["Hourly Rate"]?.number || 0;

    const total = Number((hours * rate).toFixed(2));

    await notion.pages.update({
      page_id: activeEntry.id,
      properties: {
        "Clock Out": {
          date: {
            start: clockOut.toISOString(),
          },
        },

        "Clock Out Lat": {
          number: location.lat,
        },

        "Clock Out Lng": {
          number: location.lng,
        },

        "Clock Out Distance": {
          number: location.distanceFeet,
        },

        "Clock Out Accuracy": {
          number: location.accuracy,
        },

        "Location Status": {
          select: {
            name: location.status,
          },
        },

        Hours: {
          number: Number(hours.toFixed(2)),
        },

        Total: {
          number: total,
        },

        Status: {
          select: {
            name: "Completed",
          },
        },
      },
    });

    res.json({
      ok: true,
      message: `Clock Out successful (${hours.toFixed(2)} hrs). Location OK (${Math.round(location.distanceFeet)} ft).`,
      locationStatus: location.status,
      distanceFeet: location.distanceFeet,
      accuracy: location.accuracy,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message,
    });
  }
});
app.get("/health", (req, res) => {
  res.send("OK");
});
const PORT = process.env.PORT || 3000;
app.post("/upload-photo", upload.single("photo"), async (req, res) => {
  try {
    const { unit, name, role, action, note } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No se recibió ninguna foto"
      });
    }

    const base64 = req.file.buffer.toString("base64");
    const dataUri = `data:${req.file.mimetype};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `housekeeping/${unit || "unknown"}`,
      resource_type: "image",
      quality: "auto:best"
    });

    res.json({
      success: true,
      photoUrl: result.secure_url,
      publicId: result.public_id,
      unit,
      name,
      role,
      action,
      note
    });

  } catch (err) {
    console.error("❌ Error subiendo foto:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// =========================================================
// DASHBOARD EJECUTIVO 417 MAID OS
// Una sola fuente de datos para dashboard, app y estadísticas.
// =========================================================
function readRoomTextProperty(props, names = []) {
  for (const name of names) {
    const prop = props?.[name];
    if (!prop) continue;

    const value =
      prop.title?.map((t) => t.plain_text).join("") ||
      prop.rich_text?.map((t) => t.plain_text).join("") ||
      prop.select?.name ||
      prop.status?.name ||
      prop.multi_select?.map((item) => item.name).join(", ") ||
      prop.people?.map((person) => person.name).join(", ") ||
      "";

    if (String(value).trim()) return String(value).trim();
  }

  return "";
}

function dashboardStatusKey(status) {
  const value = cleanEmployeeText(status);

  if (value.includes("ready")) return "ready";
  if (value.includes("inspection started")) return "inspectionStarted";
  if (value.includes("awaiting inspection") || value.includes("cleaned")) {
    return "awaitingInspection";
  }
  if (value.includes("progress") || value.includes("cleaning started")) {
    return "inProgress";
  }

  return "pending";
}

function dashboardBuildingFromUnit(unit) {
  const text = String(unit || "").trim().toUpperCase();

  // Acepta formatos como "430 A (2) - G" y "430 A (2) - G URGENTE".
  const explicitBuilding = text.match(/(?:-|–)\s*([A-Z])(?:\s+URGENTE)?\s*$/);
  if (explicitBuilding) return explicitBuilding[1];

  const finalLetter = text.match(/\b([A-Z])(?:\s+URGENTE)?\s*$/);
  return finalLetter ? finalLetter[1] : "OTHER";
}

function pageToDashboardUnit(page) {
  const props = page?.properties || {};
  const flags = getRoomOpsFlags(page);

  return {
    id: page.id,
    unit: readRoomTextProperty(props, ["Room Number", "Unit", "Room"]),
    date: props.Date?.date?.start || "",
    cleaner: readRoomTextProperty(props, ["Assigned Cleaner", "Cleaner"]),
    inspector: readRoomTextProperty(props, ["Assigned Inspector", "Inspector"]),
    status: readRoomTextProperty(props, ["Cleaning Status", "Status"]),
    arrival: readCheckboxProp(page, ["Arrival", "arrival"]),
    stayover: readCheckboxProp(page, ["Stayover", "Stay Over", "stayover"]),
    urgent:
      cleanEmployeeText(readRoomTextProperty(props, ["Priority"])).includes("urgent") ||
      readCheckboxProp(page, ["Urgent", "urgent"]) ||
      cleanEmployeeText(readRoomTextProperty(props, ["Room Number", "Unit", "Room"])).includes("urgente") ||
      cleanEmployeeText(readRoomTextProperty(props, ["Room Number", "Unit", "Room"])).includes("urgent"),
    priority: readRoomTextProperty(props, ["Priority"]) || "Normal",
    startedAt: readDateProp(page, ["Started At", "Cleaning Started At"]),
    finishedAt: readDateProp(page, ["Finished At", "Cleaning Finished At"]),
    inspectionStartedAt: readDateProp(page, [
      "Inspection Started At",
      "Inspection Start At",
    ]),
    readyAt: readDateProp(page, ["Ready At", "Ready for Guest At"]),
    guestOut: flags.guestOut,
    preInspection: flags.preInspection,
    preInspectionStarted: flags.preInspectionStarted,
    building: dashboardBuildingFromUnit(
      readRoomTextProperty(props, ["Room Number", "Unit", "Room"])
    ),
  };
}

async function getDashboardReports(date, forceRefresh = false) {
  if (!NOTION_REPORTS_DATABASE_ID) return [];

  const cacheKey = `dashboard:reports:${date}`;
  const cached = !forceRefresh ? getCache(cacheKey) : null;
  if (cached) return cached;

  let results = [];
  let cursor;

  do {
    const query = {
      database_id: NOTION_REPORTS_DATABASE_ID,
      page_size: 100,
      filter: {
        property: "Date",
        date: { equals: date },
      },
    };

    if (cursor) query.start_cursor = cursor;

    const response = await notion.databases.query(query);
    results = results.concat(response.results || []);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  const reports = results.map(reportPageToObject);
  setCache(cacheKey, reports, date === todayISO() ? 15000 : 120000);
  return reports;
}

async function getDashboardTimeClock(date, forceRefresh = false) {
  if (!NOTION_TIME_CLOCK_DATABASE_ID) return [];

  const cacheKey = `dashboard:timeclock:${date}`;
  const cached = !forceRefresh ? getCache(cacheKey) : null;
  if (cached) return cached;

  let results = [];
  let cursor;

  do {
    const query = {
      database_id: NOTION_TIME_CLOCK_DATABASE_ID,
      page_size: 100,
    };

    if (cursor) query.start_cursor = cursor;

    const response = await notion.databases.query(query);
    results = results.concat(response.results || []);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  const records = results
    .map((page) => {
      const props = page.properties || {};
      return {
        id: page.id,
        employee: readRoomTextProperty(props, ["Employee", "Name"]),
        role: readRoomTextProperty(props, ["Role"]),
        clockIn: props["Clock In"]?.date?.start || "",
        clockOut: props["Clock Out"]?.date?.start || "",
        status: readRoomTextProperty(props, ["Status"]),
        hours: Number(props.Hours?.number || 0),
        total: Number(props.Total?.number || 0),
      };
    })
    .filter((record) => record.clockIn && record.clockIn.slice(0, 10) === date);

  setCache(cacheKey, records, date === todayISO() ? 15000 : 120000);
  return records;
}

async function getDashboardPayroll(date, forceRefresh = false) {
  if (!NOTION_PAYROLL_DATABASE_ID) {
    return { unitPay: 0, hourlyPay: 0, total: 0, unitRecords: 0 };
  }

  const cacheKey = `dashboard:payroll:${date}`;
  const cached = !forceRefresh ? getCache(cacheKey) : null;
  if (cached) return cached;

  let records = [];
  let cursor;

  do {
    const query = {
      database_id: NOTION_PAYROLL_DATABASE_ID,
      page_size: 100,
      filter: {
        property: "Date",
        date: { equals: date },
      },
    };

    if (cursor) query.start_cursor = cursor;

    const response = await notion.databases.query(query);
    records = records.concat(response.results || []);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  const unitPay = records.reduce(
    (sum, page) => sum + Number(page.properties?.Amount?.number || 0),
    0
  );

  const result = {
    unitPay: Number(unitPay.toFixed(2)),
    hourlyPay: 0,
    total: Number(unitPay.toFixed(2)),
    unitRecords: records.length,
  };

  setCache(cacheKey, result, date === todayISO() ? 15000 : 120000);
  return result;
}

function buildDashboardBuildings(units) {
  const buildings = new Map();

  for (const unit of units) {
    const name = unit.building || "OTHER";

    if (!buildings.has(name)) {
      buildings.set(name, {
        building: name,
        total: 0,
        pending: 0,
        inProgress: 0,
        awaitingInspection: 0,
        inspectionStarted: 0,
        ready: 0,
        urgent: 0,
        units: [],
      });
    }

    const group = buildings.get(name);
    const key = dashboardStatusKey(unit.status);
    group.total += 1;
    group[key] += 1;
    if (unit.urgent) group.urgent += 1;
    group.units.push(unit);
  }

  return Array.from(buildings.values()).sort((a, b) => {
    if (a.building === "OTHER") return 1;
    if (b.building === "OTHER") return -1;
    return a.building.localeCompare(b.building);
  });
}

function buildDashboardAlerts(units, reports) {
  const alerts = [];

  for (const unit of units) {
    const status = dashboardStatusKey(unit.status);

    if (unit.urgent && status === "pending") {
      alerts.push({
        type: "urgent_room",
        severity: "high",
        unit: unit.unit,
        message: "Habitación urgente todavía sin comenzar.",
      });
    }

    if (!unit.cleaner && status !== "ready") {
      alerts.push({
        type: "missing_cleaner",
        severity: "high",
        unit: unit.unit,
        message: "Habitación sin limpiador asignado.",
      });
    }

    if (
      ["awaitingInspection", "inspectionStarted"].includes(status) &&
      !unit.inspector
    ) {
      alerts.push({
        type: "missing_inspector",
        severity: "medium",
        unit: unit.unit,
        message: "Habitación terminada sin inspector asignado.",
      });
    }
  }

  for (const report of reports.slice(0, 25)) {
    const category = cleanEmployeeText(report.aiCategory || report.category);
    const priority = cleanEmployeeText(report.aiPriority || report.priority);

    if (
      priority.includes("urgent") ||
      category.includes("maintenance") ||
      category.includes("damage") ||
      category.includes("lost")
    ) {
      alerts.push({
        type: "operations_report",
        severity: priority.includes("urgent") ? "high" : "medium",
        unit: report.unit || "",
        message: report.message || report.note || "Reporte operativo pendiente.",
      });
    }
  }

  return alerts.slice(0, 50);
}

function calculateDashboardAverages(units) {
  const cleaningMinutes = [];

  for (const unit of units) {
    if (!unit.startedAt || !unit.finishedAt) continue;
    const start = new Date(unit.startedAt).getTime();
    const finish = new Date(unit.finishedAt).getTime();
    const minutes = (finish - start) / 60000;

    if (Number.isFinite(minutes) && minutes >= 0 && minutes <= 720) {
      cleaningMinutes.push(minutes);
    }
  }

  const averageCleaningMinutes = cleaningMinutes.length
    ? cleaningMinutes.reduce((sum, value) => sum + value, 0) / cleaningMinutes.length
    : 0;

  const inspectionMinutes = [];

  for (const unit of units) {
    if (!unit.inspectionStartedAt || !unit.readyAt) continue;
    const start = new Date(unit.inspectionStartedAt).getTime();
    const finish = new Date(unit.readyAt).getTime();
    const minutes = (finish - start) / 60000;

    if (Number.isFinite(minutes) && minutes >= 0 && minutes <= 240) {
      inspectionMinutes.push(minutes);
    }
  }

  const averageInspectionMinutes = inspectionMinutes.length
    ? inspectionMinutes.reduce((sum, value) => sum + value, 0) / inspectionMinutes.length
    : 0;

  return {
    averageCleaningMinutes: Number(averageCleaningMinutes.toFixed(1)),
    averageInspectionMinutes: Number(averageInspectionMinutes.toFixed(1)),
    completedWithTime: cleaningMinutes.length,
    inspectionsWithTime: inspectionMinutes.length,
  };
}

async function buildDashboardData(date = todayISO(), forceRefresh = false) {
  const cacheKey = `dashboard:data:${date}`;
  const memoryCached = !forceRefresh ? ServerCache.get("dashboard", date) : null;
  if (memoryCached) return memoryCached.value;

  const ttlCached = !forceRefresh ? getCache(cacheKey) : null;
  if (ttlCached) {
    ServerCache.set("dashboard", date, ttlCached);
    return ttlCached;
  }

  const pages = await queryRoomsByDate(date, forceRefresh);
  const units = pages.map(pageToDashboardUnit);

  // Las consultas secundarias se hacen en paralelo y usan su propio cache.
  const [reports, timeClock, payroll] = await Promise.all([
    getDashboardReports(date, forceRefresh).catch((error) => {
      console.error("Dashboard reports:", error.message);
      return [];
    }),
    getDashboardTimeClock(date, forceRefresh).catch((error) => {
      console.error("Dashboard time clock:", error.message);
      return [];
    }),
    getDashboardPayroll(date, forceRefresh).catch((error) => {
      console.error("Dashboard payroll:", error.message);
      return { unitPay: 0, hourlyPay: 0, total: 0, unitRecords: 0 };
    }),
  ]);

  const stats = {
    totalUnits: units.length,
    pending: 0,
    inProgress: 0,
    awaitingInspection: 0,
    inspectionStarted: 0,
    ready: 0,
    arrivals: units.filter((unit) => unit.arrival).length,
    stayovers: units.filter((unit) => unit.stayover).length,
    urgent: units.filter((unit) => unit.urgent).length,
    unassignedCleaner: units.filter((unit) => !unit.cleaner).length,
    unassignedInspector: units.filter(
      (unit) =>
        ["awaitingInspection", "inspectionStarted"].includes(
          dashboardStatusKey(unit.status)
        ) && !unit.inspector
    ).length,
    reports: reports.length,
    problems: 0,
  };

  for (const unit of units) stats[dashboardStatusKey(unit.status)] += 1;

  const alerts = buildDashboardAlerts(units, reports);
  stats.problems = alerts.filter((alert) => alert.type === "operations_report").length;

  const activeEmployees = timeClock.filter(
    (record) => record.clockIn && !record.clockOut && cleanEmployeeText(record.status) !== "completed"
  );

  const hourlyPay = timeClock.reduce(
    (sum, record) => sum + Number(record.total || 0),
    0
  );

  payroll.hourlyPay = Number(hourlyPay.toFixed(2));
  payroll.total = Number((payroll.unitPay + payroll.hourlyPay).toFixed(2));

  const payload = {
    ok: true,
    date,
    generatedAt: new Date().toISOString(),
    stats,
    averages: calculateDashboardAverages(units),
    employees: {
      active: activeEmployees.length,
      clockedIn: activeEmployees,
      recordsToday: timeClock.length,
    },
    payroll,
    buildings: buildDashboardBuildings(units),
    alerts,
    units,
    recentReports: reports.slice(0, 10),
    timeline: systemTimeline.slice(0, 100),
  };

  setCache(cacheKey, payload, date === todayISO() ? 10000 : 120000);
  ServerCache.set("dashboard", date, payload);
  return payload;
}

app.get("/dashboard-data", async (req, res) => {
  try {
    const date = String(req.query.date || todayISO()).trim();
    const forceRefresh = String(req.query.refresh || "") === "1";
    const payload = await buildDashboardData(date, forceRefresh);
    res.json(payload);
  } catch (error) {
    console.error("Error en /dashboard-data:", error.message);
    res.status(500).json({
      ok: false,
      message: error.message,
      date: String(req.query.date || todayISO()),
    });
  }
});

// Compatibilidad con el dashboard anterior.
app.get("/admin-dashboard-data", async (req, res) => {
  try {
    const date = String(req.query.date || todayISO()).trim();
    const forceRefresh = String(req.query.refresh || "") === "1";
    const payload = await buildDashboardData(date, forceRefresh);
    res.json(payload);
  } catch (error) {
    console.error("Error en /admin-dashboard-data:", error.message);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/master-units", async (req, res) => {
  try {
    const date = String(req.query.date || todayISO()).trim();
    const forceRefresh = String(req.query.refresh || "") === "1";
    const pages = await queryRoomsByDate(date, forceRefresh);
    const units = pages.map(pageToDashboardUnit);

    res.json({
      ok: true,
      date,
      count: units.length,
      units,
    });
  } catch (error) {
    console.error("Error en /master-units:", error.message);
    res.status(500).json({
      ok: false,
      message: error.message,
      units: [],
    });
  }
});

app.post("/master-action", async (req, res) => {
  try {
    const { action, unit, name, note, role } = req.body;

    if (!action || !unit || !name) {
      return res.status(400).json({
        ok: false,
        message: "Faltan datos: acción, unidad o nombre",
      });
    }

    const mode = role === "inspector" ? "inspector" : "cleaner";

    const result = await updateNotionRoom(
      unit,
      action,
      name,
      note || "Acción realizada desde App Maestra",
      mode,
      ""
    );
    broadcastOpsUpdate({
      type: "action",
      action,
      unit,
      employee: name,
      message: note || "",
    });
    res.json({
      ok: true,
      message: `Acción completada: ${result.label} - ${unit}`,
    });

  } catch (error) {
    console.error("Error en /master-action:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.post("/master-update-unit", async (req, res) => {
  try {
    const { unit, field, value } = req.body;

    if (!unit || !field) {
      return res.status(400).json({
        ok: false,
        message: "Faltan datos: unidad o campo",
      });
    }

    const pages = await queryTodayRooms();
    const normalizedTarget = normalizeRoom(unit);
    const targetDigits = roomDigits(unit);

    let matches = pages.filter((page) => {
      const title =
        page.properties["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
      return normalizeRoom(title) === normalizedTarget;
    });

    if (matches.length === 0) {
      matches = pages.filter((page) => {
        const title =
          page.properties["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
        return roomDigits(title) === targetDigits;
      });
    }

    if (matches.length === 0) {
      throw new Error(`No encontré la unidad ${unit} para hoy`);
    }

    const props = {};

    if (field === "priority") {
      props.Priority = {
        select: {
          name: value || "Normal",
        },
      };
    }

    if (field === "cleaner") {
      props["Assigned Cleaner"] = {
        select: {
          name: value,
        },
      };
    }

    if (field === "inspector") {
      props["Assigned Inspector"] = {
        select: {
          name: value,
        },
      };
    }

    if (Object.keys(props).length === 0) {
      throw new Error("Campo no permitido");
    }

    for (const page of matches) {
      await notion.pages.update({
        page_id: page.id,
        properties: props,
      });
    }
    broadcastOpsUpdate({
      type: "action",
      action,
      unit,
      employee: name,
      message: note || "",
    });
    res.json({
      ok: true,
      message: `Unidad ${unit} actualizada correctamente`,
    });

  } catch (error) {
    console.error("Error en /master-update-unit:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.post("/master-create-assignment", async (req, res) => {
  try {
    const {
      unit,
      cleaner,
      inspector,
      arrival,
      priority,
      date,
    } = req.body;

    if (!unit || !cleaner) {
      return res.status(400).json({
        ok: false,
        message: "Falta unidad o limpiador",
      });
    }

    const assignmentDate = date || todayISO();

    const props = {
      "Room Number": {
        title: [
          {
            text: {
              content: unit,
            },
          },
        ],
      },

      Date: {
        date: {
          start: assignmentDate,
        },
      },

      "Assigned Cleaner": {
        select: {
          name: cleaner,
        },
      },

      Arrival: {
        checkbox: !!arrival,
      },

      Priority: {
        select: {
          name: priority || "Normal",
        },
      },

      "Cleaning Status": {
        status: {
          name: "Not Started",
        },
      },
    };

    if (inspector) {
      props["Assigned Inspector"] = {
        select: {
          name: inspector,
        },
      };
    }

    await notion.pages.create({
      parent: {
        database_id: NOTION_DATABASE_ID,
      },
      properties: props,
    });

    res.json({
      ok: true,
      message: `Asignación creada: ${unit}`,
    });

  } catch (error) {
    console.error("Error en /master-create-assignment:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.get("/master-unit-detail", async (req, res) => {
  try {
    const unit = String(req.query.unit || "").trim();

    if (!unit) {
      return res.status(400).json({
        ok: false,
        message: "Unidad requerida",
      });
    }

    const pages = await queryTodayRooms();
    const normalizedTarget = normalizeRoom(unit);
    const targetDigits = roomDigits(unit);

    let roomPage = pages.find((page) => {
      const title =
        page.properties["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
      return normalizeRoom(title) === normalizedTarget;
    });

    if (!roomPage) {
      roomPage = pages.find((page) => {
        const title =
          page.properties["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
        return roomDigits(title) === targetDigits;
      });
    }

    if (!roomPage) {
      throw new Error(`No encontré la unidad ${unit} para hoy`);
    }

    const props = roomPage.properties;

    const logs = await getDailyLogsForReport(todayISO());

    const unitLogs = logs
      .map((log) => {
        const p = log.properties;

        return {
          id: log.id,
          time: p.Time?.date?.start || "",
          unit: p.Unit?.rich_text?.map((t) => t.plain_text).join("") || "",
          action: p.Action?.select?.name || "",
          cleaner: p.Cleaner?.rich_text?.map((t) => t.plain_text).join("") || "",
          inspector: p.Inspector?.rich_text?.map((t) => t.plain_text).join("") || "",
          note: p.Note?.rich_text?.map((t) => t.plain_text).join("") || "",
          photoUrl: p["Photo URL"]?.url || "",
          lostAndFound: !!p["Lost and Found"]?.checkbox,
        };
      })
      .filter((log) => {
        return normalizeRoom(log.unit) === normalizedTarget ||
               roomDigits(log.unit) === targetDigits;
      });

    res.json({
      ok: true,
      unit: props["Room Number"]?.title?.map((t) => t.plain_text).join("") || unit,
      cleaner:
        props["Assigned Cleaner"]?.select?.name ||
        props["Assigned Cleaner"]?.rich_text?.map((t) => t.plain_text).join("") ||
        "",
      inspector:
  props["Assigned Inspector"]?.multi_select
    ?.map(i => i.name)
    .join(", ") || "",
      status: props["Cleaning Status"]?.status?.name || "",
      arrival: !!props.Arrival?.checkbox,
      priority: props.Priority?.select?.name || "Normal",
      startedAt: props["Started At"]?.date?.start || "",
      finishedAt: props["Finished At"]?.date?.start || "",
      logs: unitLogs,
    });

  } catch (error) {
    console.error("Error en /master-unit-detail:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

// =========================================================
// NOTION REALTIME WATCHER
// Revisa una sola vez para todos los teléfonos y avisa por Socket.IO.
// Los cambios hechos desde este servidor se emiten inmediatamente arriba.
// Los cambios hechos directamente en Notion se detectan aquí.
// =========================================================
const NOTION_WATCH_INTERVAL_MS = Math.max(
  3000,
  Number(process.env.NOTION_WATCH_INTERVAL_MS || 5000)
);

let notionWatcherRunning = false;
let notionWatcherSnapshot = "";

function readNotionPropertyValue(property) {
  if (!property) return "";

  if (Array.isArray(property.title)) {
    return property.title.map((item) => item.plain_text || "").join("").trim();
  }

  if (Array.isArray(property.rich_text)) {
    return property.rich_text.map((item) => item.plain_text || "").join("").trim();
  }

  if (property.select) return property.select.name || "";
  if (property.status) return property.status.name || "";

  if (Array.isArray(property.multi_select)) {
    return property.multi_select
      .map((item) => item.name || "")
      .filter(Boolean)
      .sort()
      .join(", ");
  }

  if (Array.isArray(property.people)) {
    return property.people
      .map((person) => person.name || person.id || "")
      .filter(Boolean)
      .sort()
      .join(", ");
  }

  if (typeof property.checkbox === "boolean") return property.checkbox;
  if (property.date) return property.date.start || "";
  if (property.number !== null && property.number !== undefined) return property.number;
  if (property.url) return property.url;

  return "";
}

function getFirstExistingProperty(props, names) {
  for (const name of names) {
    if (props?.[name]) return readNotionPropertyValue(props[name]);
  }

  return "";
}

function buildAssignmentSnapshot(pages = []) {
  const snapshot = pages.map((page) => {
    const props = page.properties || {};
    const flags = getRoomOpsFlags(page);

    return {
      id: page.id,
      archived: page.archived === true,
      unit: getFirstExistingProperty(props, ["Room Number", "Unit", "Room"]),
      cleaner: getFirstExistingProperty(props, [
        "Assigned Cleaner",
        "assigned cleaner",
        "Cleaner",
      ]),
      inspector: getFirstExistingProperty(props, [
        "Assigned Inspector",
        "assigned inspector",
        "Inspector",
      ]),
      status: getFirstExistingProperty(props, [
        "Cleaning Status",
        "Status",
      ]),
      priority: getFirstExistingProperty(props, ["Priority"]),
      arrival: getFirstExistingProperty(props, ["Arrival"]),
      guestOut: flags.guestOut,
      guestOutAt: flags.guestOutAt,
      preInspection: flags.preInspection,
      preInspectionStarted: flags.preInspectionStarted,
      preInspectionStartedAt: flags.preInspectionStartedAt,
      preInspectionCompletedAt: flags.preInspectionCompletedAt,
      lastEditedTime: page.last_edited_time || "",
    };
  });

  snapshot.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(snapshot);
}

async function checkNotionAssignmentChanges() {
  if (notionWatcherRunning || !NOTION_DATABASE_ID || !NOTION_API_KEY) return;

  notionWatcherRunning = true;

  try {
    const date = todayISO();
    const pages = await fetchRoomsFreshFromNotion(date);
    const nextSnapshot = buildAssignmentSnapshot(pages);

    if (!notionWatcherSnapshot) {
      notionWatcherSnapshot = nextSnapshot;
      console.log(
        `👁️ Notion watcher activo: ${pages.length} habitaciones, revisión cada ${NOTION_WATCH_INTERVAL_MS}ms`
      );
      return;
    }

    if (nextSnapshot === notionWatcherSnapshot) return;

    notionWatcherSnapshot = nextSnapshot;

    broadcastAssignmentUpdate("direct-notion-change", {
      roomCount: pages.length,
    });

    const legacyCacheKey = `todayRooms:${date}`;
    const coreCacheKey = `core:rooms:${date}`;
    const ttlMs = Number(process.env.ROOMS_CACHE_MS || 30000);

    setCache(legacyCacheKey, pages, ttlMs);
    ServerCache.set("rooms", date, pages);
    OSCore.cache.set(
      coreCacheKey,
      pages,
      ttlMs,
      [`rooms:${date}`, "rooms"]
    );

    console.log("🔔 Cambio en Notion detectado y enviado a los paneles");
  } catch (error) {
    console.error("⚠️ Error en Notion watcher:", error.message);
  } finally {
    notionWatcherRunning = false;
  }
}

function startNotionAssignmentWatcher() {
  setTimeout(checkNotionAssignmentChanges, 2500);

  const watcherTimer = setInterval(
    checkNotionAssignmentChanges,
    NOTION_WATCH_INTERVAL_MS
  );

  if (typeof watcherTimer.unref === "function") {
    watcherTimer.unref();
  }
}

startNotionAssignmentWatcher();


// =========================================================
// ESTADÍSTICAS 417 MAID OS v1
// Rendimiento, calidad y rankings usando datos reales.
// =========================================================
function statisticsMinutesBetween(startValue, endValue, options = {}) {
  if (!startValue || !endValue) {
    return { valid: false, minutes: 0, reason: "missing_time" };
  }

  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  const minutes = (end - start) / 60000;
  const minMinutes = Number(options.minMinutes ?? 5);
  const maxMinutes = Number(options.maxMinutes ?? 720);

  if (!Number.isFinite(minutes)) {
    return { valid: false, minutes: 0, reason: "invalid_time" };
  }

  if (minutes < 0) {
    return { valid: false, minutes, reason: "negative_time" };
  }

  if (minutes < minMinutes) {
    return { valid: false, minutes, reason: "too_short" };
  }

  if (minutes > maxMinutes) {
    return { valid: false, minutes, reason: "too_long" };
  }

  return {
    valid: true,
    minutes: Number(minutes.toFixed(1)),
    reason: "",
  };
}

function statisticsAverage(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;

  return Number(
    (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1)
  );
}

function statisticsNormalizePerson(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function statisticsSplitPeople(value) {
  return String(value || "")
    .split(/[,|]+/)
    .map(statisticsNormalizePerson)
    .filter(Boolean);
}

function statisticsReadLogPage(page) {
  const props = page?.properties || {};

  return {
    id: page.id,
    date:
      props.Date?.date?.start ||
      props.date?.date?.start ||
      "",
    time:
      props.Time?.date?.start ||
      props.time?.date?.start ||
      page.created_time ||
      "",
    unit: readRoomTextProperty(props, ["Unit", "unit", "Room"]),
    cleaner: readRoomTextProperty(props, ["Cleaner", "cleaner"]),
    inspector: readRoomTextProperty(props, ["Inspector", "inspector"]),
    cleanerError: readRoomTextProperty(props, ["Cleaner Error", "cleaner error"]),
    action: readRoomTextProperty(props, ["Action", "action"]),
    note: readRoomTextProperty(props, ["Note", "note"]),
    category: readRoomTextProperty(props, ["Category", "category"]),
    priority: readRoomTextProperty(props, ["Priority", "priority"]),
    status: readRoomTextProperty(props, ["Status", "status"]),
  };
}

async function getStatisticsLogs(date, forceRefresh = false) {
  if (!NOTION_LOG_DATABASE_ID) return [];

  const cacheKey = `statistics:logs:${date}`;
  const cached = !forceRefresh ? getCache(cacheKey) : null;
  if (cached) return cached;

  let results = [];
  let cursor;

  do {
    const query = {
      database_id: NOTION_LOG_DATABASE_ID,
      page_size: 100,
      filter: {
        property: "Date",
        date: {
          equals: date,
        },
      },
      sorts: [
        {
          property: "Time",
          direction: "ascending",
        },
      ],
    };

    if (cursor) query.start_cursor = cursor;

    const response = await notion.databases.query(query);
    results = results.concat(response.results || []);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  const logs = results.map(statisticsReadLogPage);
  setCache(cacheKey, logs, date === todayISO() ? 15000 : 120000);
  return logs;
}

function statisticsPayrollByCleaner(units) {
  const result = {};

  for (const unit of units) {
    const cleaner = statisticsNormalizePerson(unit.cleaner);
    if (!cleaner || dashboardStatusKey(unit.status) !== "ready") continue;

    const pay = getUnitPay(unit.unit);
    if (!result[cleaner]) result[cleaner] = 0;
    result[cleaner] += Number(pay.amount || 0);
  }

  for (const name of Object.keys(result)) {
    result[name] = Number(result[name].toFixed(2));
  }

  return result;
}

function buildCleanerStatistics(units, logs) {
  const cleaners = new Map();
  const payrollByCleaner = statisticsPayrollByCleaner(units);

  const ensureCleaner = (name) => {
    const cleanName = statisticsNormalizePerson(name);
    if (!cleanName) return null;

    if (!cleaners.has(cleanName)) {
      cleaners.set(cleanName, {
        name: cleanName,
        assigned: 0,
        completed: 0,
        inProgress: 0,
        pending: 0,
        arrivals: 0,
        urgent: 0,
        payroll: payrollByCleaner[cleanName] || 0,
        validTimes: [],
        unreliableTimes: 0,
        issues: 0,
        inspectionReports: 0,
        supplyRequests: 0,
        qualityScore: 100,
        completionRate: 0,
        fastestUnit: null,
        slowestUnit: null,
        units: [],
      });
    }

    return cleaners.get(cleanName);
  };

  for (const unit of units) {
    const cleaner = ensureCleaner(unit.cleaner);
    if (!cleaner) continue;

    cleaner.assigned += 1;
    if (unit.arrival) cleaner.arrivals += 1;
    if (unit.urgent) cleaner.urgent += 1;

    const status = dashboardStatusKey(unit.status);
    if (status === "ready") cleaner.completed += 1;
    else if (status === "inProgress") cleaner.inProgress += 1;
    else cleaner.pending += 1;

    const duration = statisticsMinutesBetween(
      unit.startedAt,
      unit.finishedAt,
      { minMinutes: 5, maxMinutes: 720 }
    );

    if (unit.startedAt || unit.finishedAt) {
      if (duration.valid) {
        cleaner.validTimes.push(duration.minutes);

        const unitTime = {
          unit: unit.unit,
          minutes: duration.minutes,
        };

        if (
          !cleaner.fastestUnit ||
          unitTime.minutes < cleaner.fastestUnit.minutes
        ) {
          cleaner.fastestUnit = unitTime;
        }

        if (
          !cleaner.slowestUnit ||
          unitTime.minutes > cleaner.slowestUnit.minutes
        ) {
          cleaner.slowestUnit = unitTime;
        }
      } else {
        cleaner.unreliableTimes += 1;
      }
    }

    cleaner.units.push({
      unit: unit.unit,
      status: unit.status,
      building: unit.building,
      arrival: unit.arrival,
      urgent: unit.urgent,
      minutes: duration.valid ? duration.minutes : null,
      reliableTime: duration.valid,
    });
  }

  for (const log of logs) {
    const action = String(log.action || "").toUpperCase();

    const errorCleaner =
      statisticsNormalizePerson(log.cleanerError) ||
      statisticsNormalizePerson(log.cleaner);

    if (["ISSUE", "LOST_FOUND"].includes(action)) {
      const cleaner = ensureCleaner(log.cleaner);
      if (cleaner) cleaner.issues += 1;
    }

    if (action === "SUPPLIES") {
      const cleaner = ensureCleaner(log.cleaner);
      if (cleaner) cleaner.supplyRequests += 1;
    }

    if (action === "INSPECTION_REPORT") {
      const cleaner = ensureCleaner(errorCleaner);
      if (cleaner) cleaner.inspectionReports += 1;
    }
  }

  return Array.from(cleaners.values())
    .map((cleaner) => {
      const averageMinutes = statisticsAverage(cleaner.validTimes);
      const completionRate = cleaner.assigned
        ? Number(((cleaner.completed / cleaner.assigned) * 100).toFixed(1))
        : 0;

      const qualityBase = cleaner.completed || cleaner.assigned;
      const qualityScore = qualityBase
        ? Math.max(
            0,
            Number(
              (
                ((qualityBase - cleaner.inspectionReports) / qualityBase) *
                100
              ).toFixed(1)
            )
          )
        : 100;

      return {
        ...cleaner,
        averageMinutes,
        completionRate,
        qualityScore,
        roomsPerHour:
          averageMinutes > 0
            ? Number((60 / averageMinutes).toFixed(2))
            : 0,
        validTimeCount: cleaner.validTimes.length,
        validTimes: undefined,
      };
    })
    .sort((a, b) => {
      if (b.completed !== a.completed) return b.completed - a.completed;
      return a.averageMinutes - b.averageMinutes;
    });
}

function buildInspectorStatistics(units, logs, reports) {
  const inspectors = new Map();

  const ensureInspector = (name) => {
    const cleanName = statisticsNormalizePerson(name);
    if (!cleanName) return null;

    if (!inspectors.has(cleanName)) {
      inspectors.set(cleanName, {
        name: cleanName,
        assigned: 0,
        inspectionsStarted: 0,
        readyCompleted: 0,
        inspectionReports: 0,
        supplyRequests: 0,
        reportsCreated: 0,
        validTimes: [],
        unreliableTimes: 0,
        averageMinutes: 0,
        qualityFindRate: 0,
      });
    }

    return inspectors.get(cleanName);
  };

  // Assigned muestra carga planificada, no se usa como "completadas".
  for (const unit of units) {
    for (const person of statisticsSplitPeople(unit.inspector)) {
      const inspector = ensureInspector(person);
      if (inspector) inspector.assigned += 1;
    }

    const duration = statisticsMinutesBetween(
      unit.inspectionStartedAt,
      unit.readyAt,
      { minMinutes: 1, maxMinutes: 240 }
    );

    if (duration.valid) {
      // Sólo se puede atribuir con certeza si hay un único inspector asignado.
      const people = statisticsSplitPeople(unit.inspector);
      if (people.length === 1) {
        ensureInspector(people[0]).validTimes.push(duration.minutes);
      }
    }
  }

  for (const log of logs) {
    const inspectorName = statisticsNormalizePerson(log.inspector);
    const inspector = ensureInspector(inspectorName);
    if (!inspector) continue;

    const action = String(log.action || "").toUpperCase();

    if (action === "INSPECTION_START") inspector.inspectionsStarted += 1;
    if (action === "READY_GUEST") inspector.readyCompleted += 1;
    if (action === "INSPECTION_REPORT") inspector.inspectionReports += 1;
    if (action === "INSPECTION_SUPPLIES") inspector.supplyRequests += 1;
  }

  for (const report of reports) {
    const role = cleanEmployeeText(report.role);
    if (!role.includes("inspect")) continue;

    const inspector = ensureInspector(report.employee);
    if (inspector) inspector.reportsCreated += 1;
  }

  return Array.from(inspectors.values())
    .map((inspector) => {
      const totalInspectionActions =
        inspector.readyCompleted + inspector.inspectionReports;

      return {
        ...inspector,
        averageMinutes: statisticsAverage(inspector.validTimes),
        validTimeCount: inspector.validTimes.length,
        qualityFindRate: totalInspectionActions
          ? Number(
              (
                (inspector.inspectionReports / totalInspectionActions) *
                100
              ).toFixed(1)
            )
          : 0,
        validTimes: undefined,
      };
    })
    .sort((a, b) => {
      if (b.readyCompleted !== a.readyCompleted) {
        return b.readyCompleted - a.readyCompleted;
      }

      return b.inspectionsStarted - a.inspectionsStarted;
    });
}

function buildBuildingStatistics(buildings) {
  return buildings
    .map((building) => {
      const validTimes = [];
      let unreliableTimes = 0;

      for (const unit of building.units || []) {
        const duration = statisticsMinutesBetween(
          unit.startedAt,
          unit.finishedAt,
          { minMinutes: 5, maxMinutes: 720 }
        );

        if (duration.valid) validTimes.push(duration.minutes);
        else if (unit.startedAt || unit.finishedAt) unreliableTimes += 1;
      }

      return {
        building: building.building,
        total: building.total,
        ready: building.ready,
        pending:
          building.pending +
          building.inProgress +
          building.awaitingInspection +
          building.inspectionStarted,
        urgent: building.urgent,
        completionRate: building.total
          ? Number(((building.ready / building.total) * 100).toFixed(1))
          : 0,
        averageCleaningMinutes: statisticsAverage(validTimes),
        validTimeCount: validTimes.length,
        unreliableTimes,
      };
    })
    .sort((a, b) => {
      if (b.completionRate !== a.completionRate) {
        return b.completionRate - a.completionRate;
      }

      return a.averageCleaningMinutes - b.averageCleaningMinutes;
    });
}

function buildStatisticsRankings(cleaners, inspectors, buildings) {
  const withReliableTime = cleaners.filter(
    (cleaner) => cleaner.validTimeCount > 0
  );

  const fastestCleaner = [...withReliableTime].sort(
    (a, b) => a.averageMinutes - b.averageMinutes
  )[0] || null;

  const mostRoomsCleaner = [...cleaners].sort(
    (a, b) => b.completed - a.completed
  )[0] || null;

  const bestQualityCleaner = [...cleaners]
    .filter((cleaner) => cleaner.completed > 0)
    .sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }

      return b.completed - a.completed;
    })[0] || null;

  const topInspector = [...inspectors].sort((a, b) => {
    if (b.readyCompleted !== a.readyCompleted) {
      return b.readyCompleted - a.readyCompleted;
    }

    return b.inspectionsStarted - a.inspectionsStarted;
  })[0] || null;

  const mostEfficientBuilding = [...buildings]
    .filter((building) => building.validTimeCount > 0)
    .sort((a, b) => {
      if (b.completionRate !== a.completionRate) {
        return b.completionRate - a.completionRate;
      }

      return a.averageCleaningMinutes - b.averageCleaningMinutes;
    })[0] || null;

  const mostDelayedBuilding = [...buildings].sort((a, b) => {
    if (b.pending !== a.pending) return b.pending - a.pending;
    return b.urgent - a.urgent;
  })[0] || null;

  return {
    fastestCleaner: fastestCleaner
      ? {
          name: fastestCleaner.name,
          averageMinutes: fastestCleaner.averageMinutes,
          completed: fastestCleaner.completed,
        }
      : null,
    mostRoomsCleaner: mostRoomsCleaner
      ? {
          name: mostRoomsCleaner.name,
          completed: mostRoomsCleaner.completed,
          assigned: mostRoomsCleaner.assigned,
        }
      : null,
    bestQualityCleaner: bestQualityCleaner
      ? {
          name: bestQualityCleaner.name,
          qualityScore: bestQualityCleaner.qualityScore,
          completed: bestQualityCleaner.completed,
        }
      : null,
    topInspector: topInspector
      ? {
          name: topInspector.name,
          readyCompleted: topInspector.readyCompleted,
          inspectionsStarted: topInspector.inspectionsStarted,
        }
      : null,
    mostEfficientBuilding: mostEfficientBuilding
      ? {
          building: mostEfficientBuilding.building,
          completionRate: mostEfficientBuilding.completionRate,
          averageCleaningMinutes:
            mostEfficientBuilding.averageCleaningMinutes,
        }
      : null,
    mostDelayedBuilding:
      mostDelayedBuilding && mostDelayedBuilding.pending > 0
        ? {
            building: mostDelayedBuilding.building,
            pending: mostDelayedBuilding.pending,
            urgent: mostDelayedBuilding.urgent,
          }
        : null,
  };
}

async function buildStatisticsData(date = todayISO(), forceRefresh = false) {
  const cacheKey = `statistics:data:${date}`;
  const cached = !forceRefresh ? getCache(cacheKey) : null;
  if (cached) return cached;

  const [dashboard, logs] = await Promise.all([
    buildDashboardData(date, forceRefresh),
    getStatisticsLogs(date, forceRefresh).catch((error) => {
      console.error("Statistics logs:", error.message);
      return [];
    }),
  ]);

  const cleaners = buildCleanerStatistics(dashboard.units || [], logs);
  const inspectors = buildInspectorStatistics(
    dashboard.units || [],
    logs,
    dashboard.recentReports || []
  );
  const buildings = buildBuildingStatistics(dashboard.buildings || []);
  const rankings = buildStatisticsRankings(
    cleaners,
    inspectors,
    buildings
  );

  const completedRooms = cleaners.reduce(
    (sum, cleaner) => sum + cleaner.completed,
    0
  );
  const inspectionErrors = cleaners.reduce(
    (sum, cleaner) => sum + cleaner.inspectionReports,
    0
  );
  const reliableCleaningTimes = cleaners.reduce(
    (sum, cleaner) => sum + cleaner.validTimeCount,
    0
  );
  const unreliableCleaningTimes = cleaners.reduce(
    (sum, cleaner) => sum + cleaner.unreliableTimes,
    0
  );

  const payload = {
    ok: true,
    date,
    generatedAt: new Date().toISOString(),
    summary: {
      totalUnits: dashboard.stats?.totalUnits || 0,
      ready: dashboard.stats?.ready || 0,
      completionRate: dashboard.stats?.totalUnits
        ? Number(
            (
              ((dashboard.stats?.ready || 0) /
                dashboard.stats.totalUnits) *
              100
            ).toFixed(1)
          )
        : 0,
      averageCleaningMinutes:
        dashboard.averages?.averageCleaningMinutes || 0,
      averageInspectionMinutes:
        dashboard.averages?.averageInspectionMinutes || 0,
      payroll: dashboard.payroll?.total || 0,
      activeEmployees: dashboard.employees?.active || 0,
      reports: dashboard.stats?.reports || 0,
      problems: dashboard.stats?.problems || 0,
      completedRooms,
      inspectionErrors,
      reliableCleaningTimes,
      unreliableCleaningTimes,
    },
    quality: {
      inspectionErrors,
      estimatedPassRate: completedRooms
        ? Math.max(
            0,
            Number(
              (
                ((completedRooms - inspectionErrors) /
                  completedRooms) *
                100
              ).toFixed(1)
            )
          )
        : 100,
      reports: dashboard.stats?.reports || 0,
      openProblems: dashboard.stats?.problems || 0,
    },
    rankings,
    cleaners,
    inspectors,
    buildings,
    timeRules: {
      cleaningMinimumMinutes: 5,
      cleaningMaximumMinutes: 720,
      inspectionMinimumMinutes: 1,
      inspectionMaximumMinutes: 240,
      note:
        "Los tiempos fuera de estos rangos se marcan como no confiables y no afectan los promedios.",
    },
  };

  setCache(cacheKey, payload, date === todayISO() ? 15000 : 120000);
  return payload;
}

app.get("/statistics-data", async (req, res) => {
  try {
    const date = String(req.query.date || todayISO()).trim();
    const forceRefresh = String(req.query.refresh || "") === "1";
    const payload = await buildStatisticsData(date, forceRefresh);
    res.json(payload);
  } catch (error) {
    console.error("Error en /statistics-data:", error.message);
    res.status(500).json({
      ok: false,
      date: String(req.query.date || todayISO()),
      message: error.message,
    });
  }
});



function statisticsDateRange(startDate, endDate, maxDays = 31) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error("Rango de fechas inválido");
  }

  const dates = [];
  const cursor = new Date(start);

  while (cursor <= end && dates.length < maxDays) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  if (cursor <= end) throw new Error(`El rango máximo permitido es de ${maxDays} días`);
  return dates;
}

async function queryPagesByDateRange(databaseId, start, end, options = {}) {
  if (!databaseId) return [];

  const cacheKey = `range:${idWithoutDashes(databaseId)}:${start}:${end}:${options.dateProperty || "Date"}`;
  const cached = options.forceRefresh ? null : getCache(cacheKey);
  if (cached) return cached;

  const results = [];
  let cursor;

  do {
    const query = {
      database_id: databaseId,
      page_size: 100,
      filter: {
        and: [
          { property: options.dateProperty || "Date", date: { on_or_after: start } },
          { property: options.dateProperty || "Date", date: { on_or_before: end } },
        ],
      },
    };

    if (cursor) query.start_cursor = cursor;
    const response = await notion.databases.query(query);
    results.push(...(response.results || []));
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  setCache(cacheKey, results, end === todayISO() ? 30000 : 5 * 60 * 1000);
  return results;
}

function groupByDate(items, getDate) {
  const grouped = new Map();
  for (const item of items) {
    const date = String(getDate(item) || "").slice(0, 10);
    if (!date) continue;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(item);
  }
  return grouped;
}

app.get("/statistics-history", async (req, res) => {
  try {
    const end = String(req.query.end || todayISO()).trim();
    const defaultStartDate = new Date(`${end}T12:00:00`);
    defaultStartDate.setDate(defaultStartDate.getDate() - 6);
    const start = String(req.query.start || defaultStartDate.toISOString().slice(0, 10)).trim();
    const forceRefresh = String(req.query.refresh || "") === "1";

    const dates = statisticsDateRange(start, end, 31);
    const cacheKey = `statistics:history:v2:${start}:${end}`;
    const cached = forceRefresh ? null : getCache(cacheKey);
    if (cached) return res.json(cached);

    const [roomPages, payrollPages, reportPages, logPages] = await Promise.all([
      queryPagesByDateRange(NOTION_DATABASE_ID, start, end, { forceRefresh }),
      queryPagesByDateRange(NOTION_PAYROLL_DATABASE_ID, start, end, { forceRefresh }).catch(() => []),
      queryPagesByDateRange(NOTION_REPORTS_DATABASE_ID, start, end, { forceRefresh }).catch(() => []),
      queryPagesByDateRange(NOTION_LOG_DATABASE_ID, start, end, { forceRefresh }).catch(() => []),
    ]);

    const roomsByDate = groupByDate(roomPages, page => page.properties?.Date?.date?.start);
    const payrollByDate = groupByDate(payrollPages, page => page.properties?.Date?.date?.start);
    const reportsByDate = groupByDate(reportPages, page => page.properties?.Date?.date?.start);
    const logsByDate = groupByDate(logPages, page => page.properties?.Date?.date?.start);

    const days = dates.map(date => {
      const units = (roomsByDate.get(date) || []).map(pageToDashboardUnit);
      const payrollRecords = payrollByDate.get(date) || [];
      const reports = (reportsByDate.get(date) || []).map(reportPageToObject);
      const logs = (logsByDate.get(date) || []).map(statisticsReadLogPage);

      const ready = units.filter(unit => dashboardStatusKey(unit.status) === "ready").length;
      const totalUnits = units.length;

      const reliableCleaning = [];
      let unreliableCleaningTimes = 0;
      for (const unit of units) {
        const duration = statisticsMinutesBetween(unit.startedAt, unit.finishedAt, { minMinutes: 5, maxMinutes: 720 });
        if (duration.valid) reliableCleaning.push(duration.minutes);
        else if (unit.startedAt || unit.finishedAt) unreliableCleaningTimes += 1;
      }

      const inspectionTimes = [];
      for (const unit of units) {
        const duration = statisticsMinutesBetween(unit.inspectionStartedAt, unit.readyAt, { minMinutes: 1, maxMinutes: 240 });
        if (duration.valid) inspectionTimes.push(duration.minutes);
      }

      const payroll = payrollRecords.reduce(
        (sum, page) => sum + Number(page.properties?.Amount?.number || 0),
        0
      );

      const inspectionErrors = logs.filter(log => String(log.action || "").toUpperCase() === "INSPECTION_REPORT").length;
      const problems = reports.filter(report => {
        const category = cleanEmployeeText(report.aiCategory || report.category);
        const priority = cleanEmployeeText(report.aiPriority || report.priority);
        return priority.includes("urgent") || category.includes("maintenance") || category.includes("damage") || category.includes("lost");
      }).length;

      return {
        date,
        totalUnits,
        ready,
        completionRate: totalUnits ? Number(((ready / totalUnits) * 100).toFixed(1)) : 0,
        averageCleaningMinutes: statisticsAverage(reliableCleaning),
        averageInspectionMinutes: statisticsAverage(inspectionTimes),
        payroll: Number(payroll.toFixed(2)),
        problems,
        qualityScore: ready ? Math.max(0, Number((((ready - inspectionErrors) / ready) * 100).toFixed(1))) : 100,
        inspectionErrors,
        reliableCleaningTimes: reliableCleaning.length,
        unreliableCleaningTimes,
      };
    });

    const totalUnits = days.reduce((sum, day) => sum + day.totalUnits, 0);
    const totalReady = days.reduce((sum, day) => sum + day.ready, 0);
    const totalPayroll = days.reduce((sum, day) => sum + day.payroll, 0);
    const totalProblems = days.reduce((sum, day) => sum + day.problems, 0);

    const payload = {
      ok: true,
      start,
      end,
      generatedAt: new Date().toISOString(),
      source: "range-query-v2",
      summary: {
        days: days.length,
        totalUnits,
        totalReady,
        completionRate: totalUnits ? Number(((totalReady / totalUnits) * 100).toFixed(1)) : 0,
        totalPayroll: Number(totalPayroll.toFixed(2)),
        totalProblems,
        averageCleaningMinutes: statisticsAverage(days.filter(day => day.averageCleaningMinutes > 0).map(day => day.averageCleaningMinutes)),
        averageQualityScore: statisticsAverage(days.map(day => day.qualityScore)),
      },
      days,
    };

    setCache(cacheKey, payload, end === todayISO() ? 10 * 60 * 1000 : 30 * 60 * 1000);
    res.json(payload);
  } catch (error) {
    console.error("Error en /statistics-history:", error.message);
    res.status(400).json({ ok: false, message: error.message });
  }
});


app.post("/statistics-preload", async (req, res) => {
  try {
    const end = String(req.body?.end || todayISO()).trim();
    const ranges = [7, 14, 30];

    res.json({
      ok: true,
      end,
      ranges,
      message: "Precarga iniciada",
    });

    setImmediate(async () => {
      for (const rangeDays of ranges) {
        try {
          const endDate = new Date(`${end}T12:00:00`);
          const startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - (rangeDays - 1));

          const start = startDate.toISOString().slice(0, 10);
          const cacheKey = `statistics:history:${start}:${end}`;

          if (getCache(cacheKey)) continue;

          const dates = statisticsDateRange(start, end, 31);
          const days = [];

          for (const date of dates) {
            try {
              const day = await buildStatisticsData(date, false);

              days.push({
                date,
                totalUnits: day.summary?.totalUnits || 0,
                ready: day.summary?.ready || 0,
                completionRate: day.summary?.completionRate || 0,
                averageCleaningMinutes:
                  day.summary?.averageCleaningMinutes || 0,
                averageInspectionMinutes:
                  day.summary?.averageInspectionMinutes || 0,
                payroll: day.summary?.payroll || 0,
                problems: day.summary?.problems || 0,
                qualityScore:
                  day.quality?.estimatedPassRate ?? 100,
                inspectionErrors:
                  day.quality?.inspectionErrors || 0,
                reliableCleaningTimes:
                  day.summary?.reliableCleaningTimes || 0,
                unreliableCleaningTimes:
                  day.summary?.unreliableCleaningTimes || 0,
              });
            } catch (error) {
              days.push({
                date,
                totalUnits: 0,
                ready: 0,
                completionRate: 0,
                averageCleaningMinutes: 0,
                averageInspectionMinutes: 0,
                payroll: 0,
                problems: 0,
                qualityScore: 100,
                inspectionErrors: 0,
                reliableCleaningTimes: 0,
                unreliableCleaningTimes: 0,
                error: error.message,
              });
            }
          }

          const totalUnits = days.reduce((sum, day) => sum + day.totalUnits, 0);
          const totalReady = days.reduce((sum, day) => sum + day.ready, 0);
          const totalPayroll = days.reduce((sum, day) => sum + day.payroll, 0);
          const totalProblems = days.reduce((sum, day) => sum + day.problems, 0);

          const payload = {
            ok: true,
            source: "preloaded-range-v3",
            start,
            end,
            generatedAt: new Date().toISOString(),
            summary: {
              days: days.length,
              totalUnits,
              totalReady,
              completionRate: totalUnits
                ? Number(((totalReady / totalUnits) * 100).toFixed(1))
                : 0,
              totalPayroll: Number(totalPayroll.toFixed(2)),
              totalProblems,
              averageCleaningMinutes: statisticsAverage(
                days
                  .filter((day) => day.averageCleaningMinutes > 0)
                  .map((day) => day.averageCleaningMinutes)
              ),
              averageQualityScore: statisticsAverage(
                days
                  .filter((day) => Number.isFinite(day.qualityScore))
                  .map((day) => day.qualityScore)
              ),
            },
            days,
          };

          setCache(
            cacheKey,
            payload,
            end === todayISO() ? 10 * 60 * 1000 : 30 * 60 * 1000
          );
        } catch (error) {
          console.error(`Statistics preload ${rangeDays}:`, error.message);
        }
      }
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error.message,
    });
  }
});


// =========================================================
// PERFIL INDIVIDUAL DE LIMPIADOR v1
// Una consulta por rango, caché y máximo 31 días.
// =========================================================
function cleanerProfileNameMatches(value, targetName) {
  const target = cleanEmployeeText(targetName);
  const raw = String(value || "");

  if (!target || !raw.trim()) return false;
  if (cleanEmployeeText(raw) === target) return true;

  return raw
    .split(/[,|]+/)
    .map((name) => cleanEmployeeText(name))
    .filter(Boolean)
    .includes(target);
}

function cleanerProfilePayrollObject(page) {
  const props = page?.properties || {};

  return {
    date: props.Date?.date?.start || "",
    cleaner: readRoomTextProperty(props, ["Cleaner", "cleaner"]),
    unit: readRoomTextProperty(props, ["Unit", "unit"]),
    amount: Number(props.Amount?.number || 0),
    roomType: readRoomTextProperty(props, ["Room Type", "room type"]),
  };
}

function cleanerProfilePhotoObject(page) {
  const props = page?.properties || {};

  return {
    id: page.id,
    date: readPlainTextFromProp(props.Date || props.date),
    reportId: readPlainTextFromProp(props["Report ID"] || props.Report),
    unit: readPlainTextFromProp(props.Unit || props.unit),
    employee: readPlainTextFromProp(
      props.Employee || props["Employee Name"] || props.Name
    ),
    url: (props["Photo URL"] || props.URL || props["Image URL"] || {})?.url || "",
  };
}

function cleanerProfileReportId(value) {
  let reportId = String(value || "").trim().split(" - ")[0];
  if (reportId && !reportId.startsWith("RPT-")) reportId = `RPT-${reportId}`;
  return reportId;
}

async function buildCleanerProfileData({ name, start, end, forceRefresh = false }) {
  const cleanName = statisticsNormalizePerson(name);

  if (!cleanName) {
    throw new Error("Nombre del limpiador requerido");
  }

  const dates = statisticsDateRange(start, end, 31);
  const cacheKey = `cleaner-profile:v2:${cleanEmployeeText(cleanName)}:${start}:${end}`;
  const cached = forceRefresh ? null : getCache(cacheKey);
  if (cached) return cached;

  const [roomPages, payrollPages, logPages, reportPages, photoPages] = await Promise.all([
    queryPagesByDateRange(NOTION_DATABASE_ID, start, end, { forceRefresh }),
    queryPagesByDateRange(NOTION_PAYROLL_DATABASE_ID, start, end, { forceRefresh }).catch(() => []),
    queryPagesByDateRange(NOTION_LOG_DATABASE_ID, start, end, { forceRefresh }).catch(() => []),
    queryPagesByDateRange(NOTION_REPORTS_DATABASE_ID, start, end, { forceRefresh }).catch(() => []),
    queryPagesByDateRange(NOTION_REPORT_PHOTOS_DATABASE_ID, start, end, { forceRefresh }).catch(() => []),
  ]);

  const allUnits = roomPages.map(pageToDashboardUnit);
  const units = allUnits.filter((unit) => cleanerProfileNameMatches(unit.cleaner, cleanName));

  if (!units.length) {
    const knownFromPayroll = payrollPages.some((page) =>
      cleanerProfileNameMatches(
        readRoomTextProperty(page.properties || {}, ["Cleaner", "cleaner"]),
        cleanName
      )
    );

    if (!knownFromPayroll) {
      const error = new Error(`No encontré actividad para ${cleanName} en este rango`);
      error.status = 404;
      throw error;
    }
  }

  const payroll = payrollPages
    .map(cleanerProfilePayrollObject)
    .filter((record) => cleanerProfileNameMatches(record.cleaner, cleanName));

  const logs = logPages
    .map(statisticsReadLogPage)
    .filter((log) =>
      cleanerProfileNameMatches(log.cleaner, cleanName) ||
      cleanerProfileNameMatches(log.cleanerError, cleanName)
    );

  const reports = reportPages
    .map(reportPageToObject)
    .filter((report) => cleanerProfileNameMatches(report.employee, cleanName));

  const photos = photoPages
    .map(cleanerProfilePhotoObject)
    .filter((photo) =>
      cleanerProfileNameMatches(photo.employee, cleanName) ||
      reports.some((report) =>
        cleanerProfileReportId(report.reportId) === cleanerProfileReportId(photo.reportId)
      )
    )
    .filter((photo) => !!photo.url);

  const photosByReportId = new Map();
  for (const photo of photos) {
    const reportId = cleanerProfileReportId(photo.reportId);
    if (!photosByReportId.has(reportId)) photosByReportId.set(reportId, []);
    photosByReportId.get(reportId).push(photo);
  }

  const reportsByUnitDate = new Map();
  for (const report of reports) {
    const key = `${String(report.date).slice(0, 10)}|${normalizeRoom(report.unit)}`;
    const reportId = cleanerProfileReportId(report.reportId);

    if (!reportsByUnitDate.has(key)) reportsByUnitDate.set(key, []);
    reportsByUnitDate.get(key).push({
      ...report,
      reportId,
      photos: photosByReportId.get(reportId) || [],
    });
  }

  const payrollByUnitDate = new Map();
  for (const record of payroll) {
    payrollByUnitDate.set(
      `${String(record.date).slice(0, 10)}|${normalizeRoom(record.unit)}`,
      record.amount
    );
  }

  const logsByUnitDate = new Map();
  for (const log of logs) {
    const key = `${String(log.date).slice(0, 10)}|${normalizeRoom(log.unit)}`;
    if (!logsByUnitDate.has(key)) logsByUnitDate.set(key, []);
    logsByUnitDate.get(key).push(log);
  }

  const dailyMap = new Map(
    dates.map((date) => [
      date,
      {
        date,
        assigned: 0,
        completed: 0,
        arrivals: 0,
        urgent: 0,
        payroll: 0,
        validTimes: [],
        unreliableTimes: 0,
        inspectionErrors: 0,
        issues: 0,
        supplies: 0,
      },
    ])
  );

  const unitRows = units.map((unit) => {
    const date = String(unit.date || "").slice(0, 10);
    const day = dailyMap.get(date);
    const statusKey = dashboardStatusKey(unit.status);
    const completed = statusKey === "ready";
    const duration = statisticsMinutesBetween(unit.startedAt, unit.finishedAt, {
      minMinutes: 5,
      maxMinutes: 720,
    });
    const key = `${date}|${normalizeRoom(unit.unit)}`;
    const unitLogs = logsByUnitDate.get(key) || [];
    const inspectionErrors = unitLogs.filter(
      (log) => String(log.action || "").toUpperCase() === "INSPECTION_REPORT"
    ).length;
    const issues = unitLogs.filter((log) =>
      ["ISSUE", "LOST_FOUND"].includes(String(log.action || "").toUpperCase())
    ).length;
    const supplies = unitLogs.filter(
      (log) => String(log.action || "").toUpperCase() === "SUPPLIES"
    ).length;
    const amount = payrollByUnitDate.get(key) ?? (completed ? Number(getUnitPay(unit.unit).amount || 0) : 0);
    const qualityScore = completed
      ? Math.max(0, Number((((1 - inspectionErrors) / 1) * 100).toFixed(1)))
      : null;
    const unitReports = reportsByUnitDate.get(key) || [];
    const unitPhotos = unitReports.flatMap((report) => report.photos || []);
    const actionHistory = unitLogs
      .map((log) => ({
        action: log.action || "",
        time: log.time || "",
        note: log.note || "",
        category: log.category || "",
        priority: log.priority || "",
        inspector: log.inspector || "",
      }))
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));

    if (day) {
      day.assigned += 1;
      if (completed) day.completed += 1;
      if (unit.arrival) day.arrivals += 1;
      if (unit.urgent) day.urgent += 1;
      day.payroll += amount;
      day.inspectionErrors += inspectionErrors;
      day.issues += issues;
      day.supplies += supplies;

      if (duration.valid) day.validTimes.push(duration.minutes);
      else if (unit.startedAt || unit.finishedAt) day.unreliableTimes += 1;
    }

    return {
      id: unit.id,
      date,
      unit: unit.unit,
      building: unit.building,
      status: unit.status,
      arrival: !!unit.arrival,
      urgent: !!unit.urgent,
      startedAt: unit.startedAt,
      finishedAt: unit.finishedAt,
      minutes: duration.valid ? duration.minutes : null,
      reliableTime: duration.valid,
      timeReason: duration.reason || "",
      payroll: Number(amount.toFixed(2)),
      inspectionErrors,
      issues,
      supplies,
      qualityScore,
      reportsCount: unitReports.length,
      photosCount: unitPhotos.length,
      reports: unitReports.map((report) => ({
        reportId: report.reportId,
        action: report.action,
        message: report.message,
        aiCategory: report.aiCategory,
        aiPriority: report.aiPriority,
        aiSummary: report.aiSummary,
        status: report.status,
        time: report.time,
        photos: (report.photos || []).map((photo) => ({
          id: photo.id,
          url: photo.url,
        })),
      })),
      actions: actionHistory,
    };
  });

  for (const log of logs) {
    const date = String(log.date || "").slice(0, 10);
    const day = dailyMap.get(date);
    if (!day) continue;

    const action = String(log.action || "").toUpperCase();
    if (action === "INSPECTION_REPORT") day.inspectionErrors += 1;
    if (["ISSUE", "LOST_FOUND"].includes(action)) day.issues += 1;
    if (action === "SUPPLIES") day.supplies += 1;
  }

  const daily = Array.from(dailyMap.values()).map((day) => {
    const averageMinutes = statisticsAverage(day.validTimes);
    const qualityBase = day.completed || day.assigned;

    return {
      date: day.date,
      assigned: day.assigned,
      completed: day.completed,
      completionRate: day.assigned
        ? Number(((day.completed / day.assigned) * 100).toFixed(1))
        : 0,
      arrivals: day.arrivals,
      urgent: day.urgent,
      payroll: Number(day.payroll.toFixed(2)),
      averageMinutes,
      validTimeCount: day.validTimes.length,
      unreliableTimes: day.unreliableTimes,
      inspectionErrors: day.inspectionErrors,
      issues: day.issues,
      supplies: day.supplies,
      qualityScore: qualityBase
        ? Math.max(
            0,
            Number(
              (((qualityBase - day.inspectionErrors) / qualityBase) * 100).toFixed(1)
            )
          )
        : 100,
    };
  });

  const assigned = unitRows.length;
  const completed = unitRows.filter((unit) => dashboardStatusKey(unit.status) === "ready").length;
  const validTimes = unitRows.filter((unit) => unit.reliableTime).map((unit) => unit.minutes);
  const unreliableTimes = unitRows.filter(
    (unit) => !unit.reliableTime && (unit.startedAt || unit.finishedAt)
  ).length;
  const totalPayroll = payroll.length
    ? payroll.reduce((sum, record) => sum + record.amount, 0)
    : unitRows.reduce((sum, unit) => sum + unit.payroll, 0);
  const inspectionErrors = logs.filter(
    (log) => String(log.action || "").toUpperCase() === "INSPECTION_REPORT"
  ).length;
  const issues = logs.filter((log) =>
    ["ISSUE", "LOST_FOUND"].includes(String(log.action || "").toUpperCase())
  ).length;
  const supplies = logs.filter(
    (log) => String(log.action || "").toUpperCase() === "SUPPLIES"
  ).length;
  const qualityBase = completed || assigned;

  const daysWithWork = daily.filter((day) => day.assigned > 0);
  const bestDay = [...daysWithWork].sort((a, b) => {
    if (b.completed !== a.completed) return b.completed - a.completed;
    return a.averageMinutes - b.averageMinutes;
  })[0] || null;
  const fastestDay = [...daysWithWork]
    .filter((day) => day.validTimeCount > 0)
    .sort((a, b) => a.averageMinutes - b.averageMinutes)[0] || null;
  const highestPayrollDay = [...daysWithWork].sort((a, b) => b.payroll - a.payroll)[0] || null;
  const mostErrorsDay = [...daysWithWork].sort((a, b) => b.inspectionErrors - a.inspectionErrors)[0] || null;

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    start,
    end,
    cleaner: {
      name: cleanName,
      role: "Cleaner",
    },
    summary: {
      assigned,
      completed,
      completionRate: assigned
        ? Number(((completed / assigned) * 100).toFixed(1))
        : 0,
      arrivals: unitRows.filter((unit) => unit.arrival).length,
      urgent: unitRows.filter((unit) => unit.urgent).length,
      averageMinutes: statisticsAverage(validTimes),
      roomsPerHour: statisticsAverage(validTimes) > 0
        ? Number((60 / statisticsAverage(validTimes)).toFixed(2))
        : 0,
      payroll: Number(totalPayroll.toFixed(2)),
      qualityScore: qualityBase
        ? Math.max(
            0,
            Number((((qualityBase - inspectionErrors) / qualityBase) * 100).toFixed(1))
          )
        : 100,
      inspectionErrors,
      issues,
      supplies,
      reports: reports.length,
      validTimeCount: validTimes.length,
      unreliableTimes,
    },
    highlights: {
      bestDay,
      fastestDay,
      highestPayrollDay,
      mostErrorsDay: mostErrorsDay?.inspectionErrors > 0 ? mostErrorsDay : null,
    },
    daily,
    units: unitRows.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return a.unit.localeCompare(b.unit);
    }),
  };

  setCache(cacheKey, payload, end === todayISO() ? 10 * 60 * 1000 : 30 * 60 * 1000);
  return payload;
}

app.get("/cleaner-profile-data", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const end = String(req.query.end || todayISO()).trim();
    const defaultStart = new Date(`${end}T12:00:00`);
    defaultStart.setDate(defaultStart.getDate() - 6);
    const start = String(req.query.start || defaultStart.toISOString().slice(0, 10)).trim();
    const forceRefresh = String(req.query.refresh || "") === "1";

    const payload = await buildCleanerProfileData({
      name,
      start,
      end,
      forceRefresh,
    });

    res.json(payload);
  } catch (error) {
    console.error("Error en /cleaner-profile-data:", error.message);
    res.status(error.status || 400).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/cleaner-profile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "cleaner-profile.html"));
});

app.get("/statistics", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "statistics.html"));
});


server.listen(PORT, () => {
  console.log(`Panel web activo en puerto ${PORT}`);
});
