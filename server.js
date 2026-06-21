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
const OPENAI_API_KEY =
process.env.OPENAI_API_KEY || "";
console.log("■ ENV CHECK");
console.log("NOTION_API_KEY existe:", !!NOTION_API_KEY);
console.log("NOTION_DATABASE_ID existe:", !!NOTION_DATABASE_ID);
console.log("NOTION_LOG_DATABASE_ID existe:", !!NOTION_LOG_DATABASE_ID);
console.log("NOTION_PAYROLL_DATABASE_ID existe:", !!NOTION_PAYROLL_DATABASE_ID);
console.log("NOTION_TIME_CLOCK_DATABASE_ID existe:", !!NOTION_TIME_CLOCK_DATABASE_ID);
console.log("NOTION_EMPLOYEES_DATABASE_ID existe:", !!NOTION_EMPLOYEES_DATABASE_ID);
console.log("OPENAI_API_KEY existe:", !!OPENAI_API_KEY);
console.log("PAYROLL RAW:", process.env.NOTION_PAYROLL_DATABASE_ID);
const notion = new Client({ auth: NOTION_API_KEY });
const openai = new OpenAI({
apiKey: OPENAI_API_KEY || "no-key",
});
// ■ Página principal limpiadores
app.get("/", (req, res) => {
res.sendFile(__dirname + "/public/index.html");
});
// ■ Página inspectores
app.get("/inspector", (req, res) => {
res.sendFile(__dirname + "/public/inspector.html");
});
// ■ Diagnóstico seguro
app.get("/debug-env", (req, res) => {
res.json({
notionApiKeyExists: !!NOTION_API_KEY,
notionDatabaseIdExists: !!NOTION_DATABASE_ID,
notionLogDatabaseIdExists: !!NOTION_LOG_DATABASE_ID,
notionPayrollDatabaseIdExists: !!NOTION_PAYROLL_DATABASE_ID,
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
});
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
S: Number(process.env.PAYROLL_RATE_S || 15), // Studio
M: Number(process.env.PAYROLL_RATE_M || 10), // Motel
"1": Number(process.env.PAYROLL_RATE_1 || 20),
"2": Number(process.env.PAYROLL_RATE_2 || 30),
"3": Number(process.env.PAYROLL_RATE_3 || 40),
"4": Number(process.env.PAYROLL_RATE_4 || 50),
"5": Number(process.env.PAYROLL_RATE_5 || 60),
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
    .substring(0, 31);
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
// ■ Buscar unidades de hoy en Notion usando search
async function queryTodayRooms() {
let pages = [];
let cursor = undefined;
const today = todayISO();
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
const response = await fetch("https://api.notion.com/v1/search", {
method: "POST",
headers: {
Authorization: `Bearer ${NOTION_API_KEY}`,
"Content-Type": "application/json",
"Notion-Version": "2022-06-28",
},
body: JSON.stringify(body),
});
const data = await response.json();
if (!response.ok) {
console.log("■ NOTION SEARCH ERROR:", data);
throw new Error(data.message || "Error buscando páginas en Notion");
}
const todayPages = (data.results || []).filter((page) => {
const pageDate = page.properties?.Date?.date?.start;
const roomTitle =
page.properties?.["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
return pageDate === today && roomTitle;
});
pages = pages.concat(todayPages);
cursor = data.has_more ? data.next_cursor : undefined;
} while (cursor);
return pages;
}
// ■ Buscar unidades de cualquier fecha en la página central de Notion
async function queryRoomsByDate(date) {
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

    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.log("■ NOTION SEARCH ERROR:", data);
      throw new Error(data.message || "Error buscando páginas en Notion");
    }

    const datePages = (data.results || []).filter((page) => {
      const pageDate = page.properties?.Date?.date?.start;
      const roomTitle =
        page.properties?.["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";

      return pageDate === date && roomTitle;
    });

    pages = pages.concat(datePages);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return pages;
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
async function getDatabaseSchema(databaseId) {
const db = await notion.databases.retrieve({
database_id: databaseId,
});
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

async function createPayrollRecord({ cleaner, unit, date }) {
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

  await generateWeeklyPayrollExcel(week.weekStart, week.weekEnd);
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
async function findEmployeeByCode(code) {
  const response = await notion.databases.query({
    database_id: NOTION_EMPLOYEES_DATABASE_ID,
    page_size: 100,
  });

  return response.results.find((page) => {
    const employeeCode =
      page.properties.Code?.rich_text
        ?.map((t) => t.plain_text)
        .join("") || "";

    return employeeCode.trim() === String(code).trim();
  });
}
function getEmployeeNameFromPage(page) {
  return page.properties.Employee?.title?.map((t) => t.plain_text).join("") || "";
}

function getEmployeeRoleFromPage(page) {
  return page.properties.Role?.select?.name || "";
}
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
    const cleaner = r.cleaner || "Unknown";

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
    const employee = r.employee || "Unknown";

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
        total: t.totalAmount,
      });

      quickbooksSheet.addRow({
        employee: t.cleaner,
        payType: "Unit Pay",
        payPeriod: `${weekStart} to ${weekEnd}`,
        amount: t.totalAmount,
      });

      const cleanerSheet = workbook.addWorksheet(cleanSheetName(t.cleaner));

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
        amount: t.totalAmount,
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
      employee: r.employee,
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
"INSPECTION_SUPPLIES"
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
    const selectedDate = req.body.date || todayISO();
    const week = getPayrollWeek(new Date(`${selectedDate}T12:00:00`));

    const payroll = await generateWeeklyPayrollExcel(week.weekStart, week.weekEnd);

    res.json({
      ok: true,
      message: "Payroll Excel updated successfully",
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
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
    const selectedDate = req.query.date || todayISO();
    const week = getPayrollWeek(new Date(`${selectedDate}T12:00:00`));

    const payroll = await generateWeeklyPayrollExcel(week.weekStart, week.weekEnd);

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

      const response = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
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

    const week = getPayrollWeek(new Date(`${start}T12:00:00`));
    await generateWeeklyPayrollExcel(week.weekStart, week.weekEnd);

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

    const employee = await findEmployeeByCode(code);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: "Código no encontrado",
      });
    }

    const inspectorName = getEmployeeNameFromPage(employee);
    const role = getEmployeeRoleFromPage(employee);

    const allowedRoles = ["Inspector", "Dispatch / Inspector"];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        ok: false,
        message: "Este código no tiene acceso a inspecciones",
      });
    }

    const pages = await queryTodayRooms();

    const units = pages
      .map((page) => {
        const props = page.properties;

        return {
          id: page.id,
          unit: props["Room Number"]?.title?.map((t) => t.plain_text).join("") || "",
          status: props["Cleaning Status"]?.status?.name || "",
          priority: props.Priority?.select?.name || "Normal",
          assignedInspector: props["Assigned Inspector"]?.select?.name || "",
        };
      })
      .filter((item) => item.assignedInspector === inspectorName);

    res.json({
      ok: true,
      inspector: inspectorName,
      role,
      count: units.length,
      units,
    });

  } catch (error) {
    console.error("Error en /inspector-assignments:", error.message);

    res.status(500).json({
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

    const pages = await queryTodayRooms();

    const units = pages
      .map((page) => {
        const props = page.properties;

        return {
          id: page.id,
          unit: props["Room Number"]?.title?.map((t) => t.plain_text).join("") || "",
          status: props["Cleaning Status"]?.status?.name || "",
          assignedCleaner: props["Assigned Cleaner"]?.select?.name || "",
          arrival: !!props.Arrival?.checkbox,
        };
      })
      .filter((item) => {
        return item.assignedCleaner.toLowerCase().trim() === name.toLowerCase().trim();
      });

    res.json({
      ok: true,
      cleaner: name,
      count: units.length,
      units,
    });

  } catch (error) {
    console.error("Error en /cleaner-assignments:", error.message);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});
app.post("/clock-in", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();

    if (!code) {
      return res.status(400).json({
        error: "Employee code required",
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

        Status: {
          select: {
            name: "Working",
          },
        },
      },
    });

    res.json({
      ok: true,
      message: `${employeeName} clocked in`,
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

    if (!code) {
      return res.status(400).json({
        error: "Employee code required",
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
      message: `Clock Out successful (${hours.toFixed(2)} hrs)`,
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
app.listen(PORT, () => {
  console.log(`Panel web activo en puerto ${PORT}`);
});
