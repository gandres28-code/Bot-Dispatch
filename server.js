const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

// 🔑 ENV VARIABLES
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID;

// 🧠 MEMORIA TEMPORAL
const pendingMedia = {};

// 🟢 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Bot activo y funcionando ✅");
});

// 📩 WEBHOOK
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

    const key = `${chatId}_${msg?.from}`;

    console.log("🧩 KEY:", key);
    console.log("📦 TYPE:", msg?.type);

    // 📸 IMAGEN (WHAPI REAL FIX)
    if (msg?.type === "image") {

      const imageBase64 = msg?.image?.preview;

      console.log("📸 IMAGE RECEIVED (BASE64)");

      if (!imageBase64) {
        console.log("⚠️ No image preview found");
        return res.sendStatus(200);
      }

      pendingMedia[key] = {
        image: imageBase64,
        employee,
        time: Date.now()
      };

      console.log("📸 Imagen guardada correctamente:", key);

      return res.sendStatus(200);
    }

    // ✍️ TEXTO
    const message =
      msg?.text?.body ||
      msg?.text ||
      msg?.message ||
      "mensaje vacío";

    console.log("📨 MENSAJE:", message);

    if (!message || message === "mensaje vacío") {
      return res.sendStatus(200);
    }

    // 🔗 BUSCAR IMAGEN PENDIENTE
    console.log("🔍 BUSCANDO KEY:", key);
    console.log("🧠 PENDING:", Object.keys(pendingMedia));

    const pending = pendingMedia[key];

    let image = null;

    if (pending && Date.now() - pending.time < 20 * 60 * 1000) {
      image = pending.image;
      delete pendingMedia[key];
      console.log("🔗 IMAGEN COMBINADA CON MENSAJE");
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
Eres un sistema de housekeeping hotelero.

IMPORTANTE:
- El empleado ya está identificado.
- Si hay imagen, es evidencia visual.

Extrae:
- Unidad
- Estado (ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA)
- Notas

Devuelve reporte claro y profesional.
`
          },
          {
            role: "user",
            content: `
Empleado: ${employee}
Mensaje: ${message}
Evidencia visual: ${image ? "SI (imagen recibida)" : "NO"}
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

${image ? "📸 Evidencia visual incluida" : ""}`;

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
    console.log("❌ ERROR:");
    console.log(error.response?.data || error.message);

    res.sendStatus(200);
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en puerto", PORT);
});
