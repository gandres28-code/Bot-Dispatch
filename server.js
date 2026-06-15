require("dotenv").config();

const express = require("express");
const { Client } = require("@notionhq/client");
const OpenAI = require("openai");

const app = express();

app.use(express.json());
app.use(express.static("public"));

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
  process.env.NOTION_LOG_DATABASE_ID || "";

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
          content:
            "Clasifica reportes de housekeeping de hotel. Responde solo JSON válido.",
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
  return (
    page.properties?.["Assigned Cleaner"]?.select?.name ||
    ""
  );
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
    throw new Error(
      "Faltan variables de Notion. Revisa NOTION_API_KEY y NOTION_DATABASE_ID"
    );
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

    if ((action === "ISSUE" || action === "SUPPLIES") && !String(note || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "❌ Debes escribir una nota",
      });
    }

    const result = await updateNotionRoom(unit, action, name, note, "cleaner");

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

// ❤️ Health check para Render
app.get("/health", (req, res) => {
  res.send("OK");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Panel web activo en puerto ${PORT}`);
});
