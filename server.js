require("dotenv").config();

const express = require("express");
const { Client } = require("@notionhq/client");

const app = express();

app.use(express.json());
app.use(express.static("public"));

// 🔑 ENV
const NOTION_API_KEY = process.env.NOTION_API_KEY || "";
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || "";

const notion = new Client({ auth: NOTION_API_KEY });

// 🌎 Página principal
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
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

  if (match[2]) {
    room += match[2];
  }

  return room;
}

// 🔢 Solo números de unidad
function roomDigits(value) {
  const match = String(value || "").match(/(\d{2,4})/);
  return match ? match[1] : "";
}

// 🔍 Buscar unidades de hoy en Notion
async function queryTodayRooms() {
  let pages = [];
  let cursor = undefined;

  do {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      filter: {
        property: "Date",
        date: {
          equals: todayISO(),
        },
      },
    });

    pages = pages.concat(response.results);
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
  if (action === "ISSUE") return null;
  if (action === "SUPPLIES") return null;

  return null;
}

// 📝 Texto bonito para guardar
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

// ✅ Actualizar Notion
async function updateNotionRoom(unit, action, employee, note) {
  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    throw new Error("Faltan variables de Notion");
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

  for (const page of matches) {
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
              content: `${label} - ${note || "Sin nota"}`,
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
              content: note || label,
            },
          },
        ],
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
