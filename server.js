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

// 📩 WEBHOOK PRINCIPAL
app.post("/webhook", async (req, res) => {
  try {

    const msg = req.body?.messages?.[0];

    console.log("📩 WEBHOOK RECIBIDO:");
    console.log(JSON.stringify(req.body, null, 2));

    // 🧠 EXTRAER DATOS WHAPI
    const chatId = msg?.chat_id;
    const fromMe = msg?.from_me;

    const message =
      msg?.text?.body ||
      msg?.text ||
      msg?.message ||
      "mensaje vacío";

    // 👷 LIMPIADOR AUTOMÁTICO
    const employee = msg?.from_name || "Desconocido";

    console.log("📨 MENSAJE:", message);
    console.log("👷 EMPLEADO:", employee);

    // 🚫 EVITAR LOOP (mensajes del bot)
    if (fromMe) {
      console.log("🚫 Ignorado: mensaje propio");
      return res.sendStatus(200);
    }

    // 🚫 EVITAR LOOP (grupo operaciones)
    if (chatId === OPERATIONS_GROUP_ID) {
      console.log("🚫 Ignorado: grupo operaciones");
      return res.sendStatus(200);
    }

    // 🚫 MENSAJES VACÍOS
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
Eres un sistema de housekeeping hotelero.

IMPORTANTE:
- El empleado ya viene identificado automáticamente.
- No preguntes el nombre del empleado.

Extrae del mensaje:
- Unidad
- Estado (ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA)
- Notas

Devuelve un reporte claro para supervisión.
`
          },
          {
            role: "user",
            content: `
Empleado: ${employee}
Mensaje: ${message}
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

    // 📦 FORMATO FINAL
    const finalMessage = `👷 ${employee}\n\n${ai}`;

    console.log("🤖 IA RESULTADO:");
    console.log(finalMessage);

    // 📲 ENVIAR A OPERACIONES
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
