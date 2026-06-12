const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

// 🔑 ENV VARIABLES
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID;

// 🧠 MEMORIA TEMPORAL (IMÁGENES)
const pendingMedia = {};

// 🟢 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Bot activo y funcionando ✅");
});

// 📩 WEBHOOK PRINCIPAL
app.post("/webhook", async (req, res) => {
  try {

    const msg = req.body?.messages?.[0];

    console.log("📩 WEBHOOK RECIBIDO:");
    console.log(JSON.stringify(req.body, null, 2));

    const chatId = msg?.chat_id;
    const fromMe = msg?.from_me;

    const employee = msg?.from_name || "Desconocido";

    // 🚫 evitar loops
    if (fromMe) {
      console.log("🚫 Mensaje propio ignorado");
      return res.sendStatus(200);
    }

    // 📸 SI ES IMAGEN → GUARDAR TEMPORALMENTE
    if (msg?.type === "image") {
      const imageUrl =
        msg?.image?.url ||
        msg?.media?.url ||
        msg?.file?.url ||
        null;

      pendingMedia[chatId] = {
        image: imageUrl,
        employee,
        time: Date.now()
      };

      console.log("📸 Imagen guardada temporalmente");
      return res.sendStatus(200);
    }

    // ✍️ MENSAJE DE TEXTO
    const message =
      msg?.text?.body ||
      msg?.text ||
      msg?.message ||
      "mensaje vacío";

    console.log("📨 MENSAJE:", message);
    console.log("👷 EMPLEADO:", employee);

    // 🚫 ignorar vacío
    if (!message || message === "mensaje vacío") {
      return res.sendStatus(200);
    }

    // 🔗 VER SI HAY IMAGEN PENDIENTE
    const pending = pendingMedia[chatId];

    let image = null;

    if (pending && Date.now() - pending.time < 5 * 60 * 1000) {
      image = pending.image;
      delete pendingMedia[chatId];
      console.log("🔗 Imagen combinada con mensaje");
    }

    // 🤖 OPENAI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un sistema de housekeeping de hotel.

IMPORTANTE:
- El empleado ya viene identificado.
- Si hay imagen, úsala como evidencia de limpieza.

Extrae:
- Unidad
- Estado (ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA)
- Notas

Devuelve reporte claro para supervisión.
`
          },
          {
            role: "user",
            content: `
Empleado: ${employee}
Mensaje: ${message}
Imagen: ${image ? "SI HAY EVIDENCIA VISUAL" : "NO HAY IMAGEN"}
`
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const ai = response.data.choices[0].message.content;

    // 📦 MENSAJE FINAL
    const finalMessage =
`👷 ${employee}

${ai}

${image ? "📸 Evidencia adjunta" : ""}`;

    console.log("🤖 IA RESULTADO:");
    console.log(finalMessage);

    // 📤 ENVIAR A OPERACIONES
    await axios.post(
      "https://gate.whapi.cloud/messages/text",
      {
        to: OPERATIONS_GROUP_ID,
        body: finalMessage
      },
      {
        headers: {
          Authorization: `Bearer ${WHAPI_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("📤 ENVIADO A OPERACIONES");

    res.sendStatus(200);

  } catch (error) {
    console.log("❌ ERROR WEBHOOK:");
    console.log(error.response?.data || error.message);

    res.sendStatus(200);
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en puerto", PORT);
});
