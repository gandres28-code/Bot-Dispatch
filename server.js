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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

console.log("🔍 ENV CHECK");
console.log("NOTION_API_KEY existe:", !!NOTION_API_KEY);
console.log("NOTION_DATABASE_ID existe:", !!NOTION_DATABASE_ID);
console.log("OPENAI_API_KEY existe:", !!OPENAI_API_KEY);

const notion = new Client({ auth: NOTION_API_KEY });

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || "no-key",
});

// 🌎 Página principal
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// 🧪 Diagnóstico seguro
app.get("/debug-env", (req, res) => {
  res.json({
    notionApiKeyExists: !!NOTION_API_KEY,
    notionDatabaseIdExists: !!NOTION_DATABASE_ID,
    openAiKeyExists: !!OPENAI_API_KEY,
    notionDatabaseIdPreview: NOTION_DATABASE_ID
      ? NOTION_DATABASE_ID.slice(0, 6) + "..." + NOTION_DATABASE_ID.slice(-6)
      : null,
  });
});

// 🔍 Ver TODO lo que Hotel Bot puede ver
app.get("/test-page", async (req, res) => {
  try {
    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({}),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// 🔍 Ver databases visibles
app.get("/test-notion", async (req, res) => {
  try {
    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        filter: {
          property: "object",
          value: "database",
        },
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
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

// 🏠 Normalizar unidad
function normalizeRoom(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/(\d{2,4})\s*([A-Z])?/);

  if (!match) return "";

  let room = match[1];

  if (match[2]) room += match[2];

  return room;
}

// 🔢 Solo números de unidad
function roomDigits(value) {
  const match = String(value || "").match(/(\d{2,4})/);
  return match ? match[1] : "";
}

// 🔎 Query Notion API nueva para data sources
async function notionDataSourceQuery(dataSourceId, body) {
  const response = await fetch(
    `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": "2025-09-03",
      },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.log("❌ NOTION QUERY ERROR:", data);
    throw new Error(data.message || "Error consultando Notion");
  }

  return data;
}

// 🔍 Buscar unidades de hoy en Notion
async function queryTodayRooms() {
  let pages = [];
  let cursor = undefined;

  do {
    const body = {
      page_size: 100,
      filter: {
        property: "Date",
        date: {
          equals: todayISO(),
        },
      },
    };

    if (cursor) body.start_cursor = cursor;

    const response = await notionDataSourceQuery(NOTION_DATABASE_ID, body);

    pages = pages.concat(response.results || []);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

// 🧠 Convertir acción del panel a status de Notion
function notionStatusFromAction(action) {
  if (action === "START") return "In Progress";
  if (action === "DONE") return "Cleaned - Awaiting Inspection";
  if (action === "CHECK") return "Inspection Started";
  if (action === "PASS") return "Ready for Guest";
  if (action === "FAIL") return "Needs Reclean";

  return null;
}

// 📝 Texto bonito
function actionLabel(action) {
  if (action === "START") return "🟢 Limpieza iniciada";
  if (action === "DONE") return "🔴 Limpieza terminada";
  if (action === "ISSUE") return "⚠️ Problema reportado";
  if (action === "SUPPLIES") return "🧺 Supplies solicitados";
  if (action === "CHECK") return "🔍 Inspección iniciada";
  if (action === "PASS") return "✅ Unidad aprobada";
  if (action === "FAIL") return "❌ Unidad rechazada";

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

// ✅ Actualizar Notion
async function updateNotionRoom(unit, action, employee, note) {
  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    throw new Error(
      "Faltan variables de Notion. Revisa NOTION_API_KEY y NOTION_DATABASE_ID"
    );
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

  let ai = null;

  if (action === "ISSUE" || action === "FAIL" || action === "SUPPLIES") {
    ai = await analyzeNoteWithAI(action, note);
  }

  for (const page of matches) {
    const messageParts = [
      label,
      note ? `Nota: ${note}` : "Nota: Sin nota",
    ];

    if (ai) {
      messageParts.push(`Categoría: ${ai.category}`);
      messageParts.push(`Prioridad: ${ai.priority}`);
      messageParts.push(`Resumen: ${ai.summary}`);
    }

    const props = {
      "Last Whatsapp Update": {
        date: {
          start: now,
        },
      },
      "Last Message": {
        rich_text: [
          {
            text: {
              content: messageParts.join(" | "),
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
        select: {
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

    if (action === "CHECK") {
      props["Inspection Started At"] = {
        date: {
          start: now,
        },
      };
    }

    if (action === "PASS") {
      props["Inspection Finished At"] = {
        date: {
          start: now,
        },
      };
    }

    if (action === "ISSUE" || action === "FAIL" || action === "SUPPLIES") {
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
  }
}

// 📲 Ruta del panel web
app.post("/action", async (req, res) => {
  try {
    const { action, unit, note, name } = req.body;

    if (!action || !unit || !name) {
      return res.status(400).json({
        success: false,
        message: "❌ Faltan datos: nombre, unidad o acción",
      });
    }

    await updateNotionRoom(unit, action, name, note);

    res.json({
      success: true,
      message: `✅ Enviado correctamente: ${actionLabel(action)} - ${unit}`,
    });
  } catch (error) {
    console.error("❌ Error en /action:", error.message);

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
