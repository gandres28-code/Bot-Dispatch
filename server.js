const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

// 🔑 ENV VARIABLES
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID;

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

    // 🧠 EXTRAER INFO
    const chatId = msg?.chat_id;
    const fromMe = msg?.from_me;

    const message =
      msg?.text?.body ||
      msg?.text ||
      msg?.message ||
      "mensaje vacío";

    console.log("📨 MENSAJE:", message);

    // 🚫 1. EVITAR LOOP (mensajes del propio bot)
    if (fromMe) {
      console.log("🚫 Ignorado: mensaje propio");
      return res.sendStatus(200);
    }

    // 🚫 2. EVITAR LOOP (grupo OPERACIONES)
    if (chatId === OPERATIONS_GROUP_ID) {
      console.log("🚫 Ignorado: mensaje del grupo operaciones");
      return res.sendStatus(200);
    }

    // 🚫 3. EVITAR MENSAJES VACÍOS
    if (!message || message === "mensaje vacío") {
      console.log("🚫 Mensaje vacío ignorado");
      return res.sendStatus(200);
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

Extrae:
- Unidad
- Empleado
- Estado (ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA)
- Notas

Devuelve un reporte corto y claro para supervisor.
`
          },
          {
            role: "user",
            content: message
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

    console.log("🤖 IA RESULTADO:");
    console.log(ai);

    // 📲 ENVIAR AL GRUPO OPERACIONES
    await axios.post(
      "https://gate.whapi.cloud/messages/text",
      {
        to: OPERATIONS_GROUP_ID,
        body: ai
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

    // ⚠️ NUNCA ROMPER WHAPI
    res.sendStatus(200);
  }
});

// 🚀 SERVER START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en puerto", PORT);
});
