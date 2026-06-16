require("dotenv").config();

const express = require("express");
const { Client } = require("@notionhq/client");
const OpenAI = require("openai");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");

const app = express();

// 🚫 Anti duplicados
const recentActions = new Map();

app.use(express.json());
app.use(express.static("public"));

// 📁 Carpeta para PDFs
const reportsDir = path.join(__dirname, "reports");
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir);
}
app.use("/reports", express.static(reportsDir));

// 🔑 ENV
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

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || "";

console.log("🔍 ENV CHECK");
console.log("NOTION_API_KEY existe:", !!NOTION_API_KEY);
console.log("NOTION_DATABASE_ID existe:", !!NOTION_DATABASE_ID);
console.log("NOTION_LOG_DATABASE_ID existe:", !!NOTION_LOG_DATABASE_ID);
console.log("OPENAI_API_KEY existe:", !!OPENAI_API_KEY);

const notion = new Client({ auth: NOTION_API_KEY });

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || "no-key",
});

// 🌎 Página principal limpiadores
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// 🔍 Página inspectores
app.get("/inspector", (req, res) => {
  res.sendFile(__dirname + "/public/inspector.html");
});

// 🧪 Diagnóstico seguro
app.get("/debug-env", (req, res) => {
  res.json({
    notionApiKeyExists: !!NOTION_API_KEY,
    notionDatabaseIdExists: !!NOTION_DATABASE_ID,
    notionLogDatabaseIdExists: !!NOTION_LOG_DATABASE_ID,
    openAiKeyExists: !!OPENAI_API_KEY,
    notionDatabaseIdPreview: NOTION_DATABASE_ID
      ? NOTION_DATABASE_ID.slice(0, 6) + "..." + NOTION_DATABASE_ID.slice(-6)
      : null,
    notionLogDatabaseIdPreview: NOTION_LOG_DATABASE_ID
      ? NOTION_LOG_DATABASE_ID.slice(0, 6) + "..." + NOTION_LOG_DATABASE_ID.slice(-6)
      : null,
  });
});

// 📅 Fecha de hoy
function todayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// 🕒 Hora local
function localTime() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// 🏠 Normalizar unidad
function normalizeRoom(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/(\d{2,4})\s*([A-Z])?/);

  if (!match) return "";

  let room = match[1];

  if (match[2]) room += match[2];

  return room;
}

// 🔢 Solo números
function roomDigits(value) {
  const match = String(value || "").match(/(\d{2,4})/);
  return match ? match[1] : "";
}

// 🚫 Evitar acciones duplicadas
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

// 🔍 Buscar unidades de hoy en Notion usando search
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
      console.log("❌ NOTION SEARCH ERROR:", data);
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

// 🧠 Status de Notion
function notionStatusFromAction(action) {
  if (action === "START") return "In Progress";
  if (action === "DONE") return "Cleaned - Awaiting Inspection";
  if (action === "INSPECTION_START") return "Inspection Started";
  if (action === "READY_GUEST") return "Ready for Guest";

  return null;
}

async function notifyInspectors(unit) {
  if (!process.env.WHAPI_TOKEN || !process.env.INSPECTORS_GROUP_ID) {
    console.log("⚠️ WHAPI_TOKEN o INSPECTORS_GROUP_ID faltante");
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
        body: `🔍 ${unit} lista para inspeccionar`,
      }),
    });

    const data = await response.json();
    console.log("✅ Aviso enviado a inspectores:", data);
  } catch (error) {
    console.log("❌ Error enviando a inspectores:", error.message);
  }
}

// 📝 Labels
function actionLabel(action) {
  if (action === "START") return "🟢 Limpieza iniciada";
  if (action === "DONE") return "🔴 Limpieza terminada";
  if (action === "ISSUE") return "⚠️ Problema reportado";
  if (action === "SUPPLIES") return "🧺 Supplies solicitados";

  if (action === "INSPECTION_START") return "🔍 Inspección iniciada";
  if (action === "READY_GUEST") return "✅ Ready for Guest";
  if (action === "INSPECTION_REPORT") return "📝 Error de limpieza reportado";
  if (action === "INSPECTION_SUPPLIES") return "🧺 Solicitud de inspector";

  return "Actualización";
}

// 🧠 Analizar nota con OpenAI
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
    console.log("⚠️ OpenAI error:", error.message);

    return {
      category: "Other",
      priority: "Normal",
      summary: safeNote || "Sin nota",
    };
  }
}

// 🧹 Sacar limpiador asignado desde Notion
function getAssignedCleaner(page) {
  return page.properties?.["Assigned Cleaner"]?.select?.name || "";
}

// 🗃️ Guardar historial diario
async function saveDailyLog({
  action,
  unit,
  employee,
  inspector,
  assignedCleaner,
  note,
  ai = null,
}) {
  if (!NOTION_LOG_DATABASE_ID) {
    console.log("⚠️ NOTION_LOG_DATABASE_ID faltante, no se guardó historial");
    return;
  }

  const now = new Date().toISOString();

  try {
    const props = {
      Log: {
        title: [
          {
            text: {
              content: `${unit} - ${action} - ${employee || inspector}`,
            },
          },
        ],
      },
      Date: {
        date: {
          start: todayISO(),
        },
      },
      Time: {
        date: {
          start: now,
        },
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
      Action: {
        select: {
          name: action,
        },
      },
      Note: {
        rich_text: [
          {
            text: {
              content: note || "",
            },
          },
        ],
      },
      Category: {
        select: {
          name: ai?.category || "Other",
        },
      },
      Priority: {
        select: {
          name: ai?.priority || "Normal",
        },
      },
      Status: {
        select: {
          name: notionStatusFromAction(action) || action,
        },
      },
    };

    if (employee) {
      props.Cleaner = {
        rich_text: [
          {
            text: {
              content: employee,
            },
          },
        ],
      };
    }

    if (inspector) {
      props.Inspector = {
        rich_text: [
          {
            text: {
              content: inspector,
            },
          },
        ],
      };
    }

    if (assignedCleaner) {
      props["Cleaner Error"] = {
        rich_text: [
          {
            text: {
              content: assignedCleaner,
            },
          },
        ],
      };
    }

    await notion.pages.create({
      parent: {
        database_id: NOTION_LOG_DATABASE_ID,
      },
      properties: props,
    });

    console.log("✅ Daily Cleaning Log guardado");
  } catch (error) {
    console.log("❌ ERROR guardando Daily Cleaning Log:", error.body || error.message);
  }
}

// ✅ Actualizar habitación principal
async function updateNotionRoom(unit, action, employee, note, mode = "cleaner") {
  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    throw new Error("Faltan variables de Notion. Revisa NOTION_API_KEY y NOTION_DATABASE_ID");
  }

  const allowedActions = [
    "START",
    "DONE",
    "ISSUE",
    "SUPPLIES",
    "INSPECTION_START",
    "READY_GUEST",
    "INSPECTION_REPORT",
    "INSPECTION_SUPPLIES",
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

    const historyLine =
      `${localTime()} - ${employee} - ${label}` +
      `${assignedCleaner && mode === "inspector" ? ` - Cleaner: ${assignedCleaner}` : ""}` +
      `${note ? ` - ${note}` : ""}` +
      `${ai ? ` | ${ai.category} | ${ai.priority} | ${ai.summary}` : ""}`;

    const oldLastMessage =
      page.properties["Last Message"]?.rich_text?.map((t) => t.plain_text).join("") || "";

    const newLastMessage =
      oldLastMessage
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
      unit,
      employee: mode === "cleaner" ? employee : assignedCleaner,
      inspector: mode === "inspector" ? employee : "",
      assignedCleaner: mode === "inspector" ? assignedCleaner : "",
      note,
      ai,
    });
  }

  return {
    label,
    ai,
  };
}

// 📄 Helpers para PDF
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
      or: [
        {
          property: "Date",
          date: {
            equals: date,
          },
        },
        {
          property: "date",
          date: {
            equals: date,
          },
        },
      ],
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

async function generateDailyReport(date = todayISO()) {
  const logs = await getDailyLogsForReport(date);

  const fileName = `daily-housekeeping-report-${date}.pdf`;
  const filePath = path.join(reportsDir, fileName);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(filePath));

  const units = new Set();
  const cleaners = new Set();
  const inspectors = new Set();

  const productivity = {};
  const issuesByUnit = {};
  const errorsByCleaner = {};

  let issues = 0;
  let cleanerErrors = 0;
  let highPriority = 0;
  let completed = 0;

  logs.forEach((log) => {
    const unit = readText(log, ["Unit", "unit"]);
    const cleaner = readText(log, ["Cleaner", "cleaner"]);
    const inspector = readText(log, ["Inspector", "inspector"]);
    const action = readText(log, ["Action", "action"]);
    const category = readText(log, ["Category", "category"]);
    const priority = readText(log, ["Priority", "priority"]);
    const status = readText(log, ["Status", "status"]);
    const cleanerError = readText(log, ["Cleaner Error", "cleaner error"]);

    if (unit) units.add(unit);
    if (cleaner) cleaners.add(cleaner);
    if (inspector) inspectors.add(inspector);

    const actionLower = action.toLowerCase();
    const categoryLower = category.toLowerCase();
    const priorityLower = priority.toLowerCase();
    const statusLower = status.toLowerCase();
    const cleanerErrorLower = cleanerError.toLowerCase();

    if (
      cleaner &&
      (
        actionLower.includes("done") ||
        actionLower.includes("finished") ||
        actionLower.includes("completed") ||
        actionLower.includes("terminada") ||
        actionLower.includes("terminado") ||
        actionLower.includes("lista") ||
        actionLower.includes("ready")
      )
    ) {
      productivity[cleaner] = (productivity[cleaner] || 0) + 1;
    }

    if (
      actionLower.includes("issue") ||
      actionLower.includes("problem") ||
      actionLower.includes("problema") ||
      actionLower.includes("report") ||
      categoryLower.includes("issue") ||
      categoryLower.includes("problem") ||
      categoryLower.includes("problema")
    ) {
      issues++;
      if (unit) issuesByUnit[unit] = (issuesByUnit[unit] || 0) + 1;
    }

    if (
      cleanerErrorLower &&
      cleanerErrorLower !== "no" &&
      cleanerErrorLower !== "none" &&
      cleanerErrorLower !== "n/a"
    ) {
      cleanerErrors++;
      const cleanerName = cleaner || cleanerError || "Unknown";
      errorsByCleaner[cleanerName] = (errorsByCleaner[cleanerName] || 0) + 1;
    }

    if (
      priorityLower.includes("high") ||
      priorityLower.includes("urgent") ||
      priorityLower.includes("alta") ||
      priorityLower.includes("urgente")
    ) {
      highPriority++;
    }

    if (
      statusLower.includes("complete") ||
      statusLower.includes("completed") ||
      statusLower.includes("ready") ||
      statusLower.includes("lista") ||
      actionLower.includes("ready_guest")
    ) {
      completed++;
    }
  });

  doc.fontSize(20).text("DAILY HOUSEKEEPING OPERATIONS REPORT", {
    align: "center",
  });

  doc.moveDown();
  doc.fontSize(12).text(`Date: ${date}`);
  doc.text(`Company: ${process.env.COMPANY_NAME || "Housekeeping Operations"}`);
  doc.text(`Property: ${process.env.PROPERTY_NAME || "Property"}`);
  doc.moveDown();

  doc.fontSize(16).text("1. Executive Summary");
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Total Records: ${logs.length}`);
  doc.text(`Total Units Registered: ${units.size}`);
  doc.text(`Completed / Ready Records: ${completed}`);
  doc.text(`Issues Reported: ${issues}`);
  doc.text(`High Priority Records: ${highPriority}`);
  doc.text(`Cleaner Errors: ${cleanerErrors}`);
  doc.text(`Active Cleaners: ${cleaners.size}`);
  doc.text(`Active Inspectors: ${inspectors.size}`);

  doc.moveDown();

  doc.fontSize(16).text("2. Productivity by Cleaner");
  doc.moveDown(0.5);

  if (Object.keys(productivity).length === 0) {
    doc.fontSize(12).text("No completed cleaning records found.");
  } else {
    Object.entries(productivity).forEach(([cleaner, count]) => {
      doc.fontSize(12).text(`${cleaner}: ${count} completed unit(s)`);
    });
  }

  doc.moveDown();

  doc.fontSize(16).text("3. Issues & Cleaner Errors");
  doc.moveDown(0.5);

  doc.fontSize(12).text("Issues by Unit:");

  if (Object.keys(issuesByUnit).length === 0) {
    doc.text("No issues reported.");
  } else {
    Object.entries(issuesByUnit).forEach(([unit, count]) => {
      doc.text(`Unit ${unit}: ${count} issue(s)`);
    });
  }

  doc.moveDown(0.5);
  doc.text("Cleaner Errors:");

  if (Object.keys(errorsByCleaner).length === 0) {
    doc.text("No cleaner errors reported.");
  } else {
    Object.entries(errorsByCleaner).forEach(([cleaner, count]) => {
      doc.text(`${cleaner}: ${count} error(s)`);
    });
  }

  doc.addPage();

  doc.fontSize(18).text("4. Complete Activity Ledger", {
    align: "center",
  });

  doc.moveDown();

  logs.forEach((log, index) => {
    const logTitle = readText(log, ["Log", "log"]);
    const time = readText(log, ["Time", "time"]);
    const unit = readText(log, ["Unit", "unit"]);
    const cleaner = readText(log, ["Cleaner", "cleaner"]);
    const action = readText(log, ["Action", "action"]);
    const note = readText(log, ["Note", "note"]);
    const inspector = readText(log, ["Inspector", "inspector"]);
    const category = readText(log, ["Category", "category"]);
    const priority = readText(log, ["Priority", "priority"]);
    const status = readText(log, ["Status", "status"]);
    const cleanerError = readText(log, ["Cleaner Error", "cleaner error"]);

    doc.fontSize(11).text(
      `${index + 1}. ${formatReportTime(time)} | Unit: ${unit || "N/A"} | Action: ${action || "N/A"}`
    );

    if (logTitle) doc.text(`   Log: ${logTitle}`);
    if (cleaner) doc.text(`   Cleaner: ${cleaner}`);
    if (inspector) doc.text(`   Inspector: ${inspector}`);
    if (category) doc.text(`   Category: ${category}`);
    if (priority) doc.text(`   Priority: ${priority}`);
    if (status) doc.text(`   Status: ${status}`);
    if (cleanerError) doc.text(`   Cleaner Error: ${cleanerError}`);
    if (note) doc.text(`   Note: ${note}`);

    doc.moveDown(0.6);
  });

  doc.end();

  return {
    fileName,
    fileUrl: `/reports/${fileName}`,
    totalRecords: logs.length,
  };
}

// 📲 Ruta limpiadores
app.post("/action", async (req, res) => {
  try {
    const { action, unit, note, name } = req.body;

    if (!action || !unit || !name) {
      return res.status(400).json({
        success: false,
        message: "❌ Faltan datos: nombre, unidad o acción",
      });
    }

    if (isDuplicateAction(action, unit, name)) {
      return res.status(400).json({
        success: false,
        message: "⚠️ Acción ya registrada recientemente",
      });
    }

    if ((action === "ISSUE" || action === "SUPPLIES") && !String(note || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "❌ Debes escribir una nota",
      });
    }

    const result = await updateNotionRoom(unit, action, name, note, "cleaner");

    if (action === "DONE") {
      await notifyInspectors(unit);
    }

    res.json({
      success: true,
      message: `✅ Enviado correctamente: ${result.label} - ${unit}`,
    });
  } catch (error) {
    console.error("❌ Error en /action:", error.message);

    res.status(500).json({
      success: false,
      message: `❌ Error: ${error.message}`,
    });
  }
});

// 🔍 Ruta inspectores
app.post("/inspector-action", async (req, res) => {
  try {
    const { action, unit, note, name } = req.body;

    if (!action || !unit || !name) {
      return res.status(400).json({
        success: false,
        message: "❌ Faltan datos: inspector, unidad o acción",
      });
    }

    if (isDuplicateAction(action, unit, name)) {
      return res.status(400).json({
        success: false,
        message: "⚠️ Acción ya registrada recientemente",
      });
    }

    if (
      (action === "INSPECTION_REPORT" || action === "INSPECTION_SUPPLIES") &&
      !String(note || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "❌ Debes escribir una nota",
      });
    }

    const result = await updateNotionRoom(unit, action, name, note, "inspector");

    res.json({
      success: true,
      message: `✅ Inspector: ${result.label} - ${unit}`,
    });
  } catch (error) {
    console.error("❌ Error inspector:", error.message);

    res.status(500).json({
      success: false,
      message: `❌ Error: ${error.message}`,
    });
  }
});

// 🚨 Eventos para Centro de Operaciones
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
      };
    });

    res.json({
      count: events.length,
      events,
    });
  } catch (error) {
    console.error("❌ Error en /operations-events:", error.message);

    res.status(500).json({
      count: 0,
      events: [],
      error: error.message,
    });
  }
});

// 📄 Generar Daily Report PDF
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
    console.error("❌ Error generating daily report:", error.message);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 📄 Abrir reporte desde navegador
app.get("/generate-daily-report", async (req, res) => {
  try {
    const date = req.query.date || todayISO();

    const report = await generateDailyReport(date);

    res.redirect(report.fileUrl);
  } catch (error) {
    console.error("❌ Error generating daily report:", error.message);
    res.status(500).send(`Error generating report: ${error.message}`);
  }
});

// ❤️ Health check para Render
app.get("/health", (req, res) => {
  res.send("OK");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Panel web activo en puerto ${PORT}`);
});
