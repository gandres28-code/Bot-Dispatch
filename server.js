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

// 📩 WHAPI WEBHOOK
app.post("/webhook", async (req, res) => {
  try {

    console.log("📩 WEBHOOK RECIBIDO:");
    console.log(JSON.stringify(req.body, null, 2));

    // 🧠 EXTRAER MENSAJE REAL DE WHAPI
    const message =
      req.body?.messages?.[0]?.text?.body ||
      req.body?.messages?.[0]?.text ||
      req.body?.messages?.[0]?.message ||
      "mensaje vacío";

    console.log("📨 MENSAJE EXTRAÍDO:", message);

    // 🤖 OPENAI REQUEST
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un sistema de operaciones de housekeeping de hotel.

Analiza el mensaje y extrae:

- Unidad
- Empleado
- Estado (ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA)
- Notas

Devuelve un reporte corto, claro y profesional para supervisor.
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

    // 📲 ENVIAR AL GRUPO OPERACIONES (WHAPI)
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

    console.log("📤 MENSAJE ENVIADO AL GRUPO OPERACIONES");

    // ⚠️ SIEMPRE RESPONDER 200 A WHAPI
    res.sendStatus(200);

  } catch (error) {
    console.log("❌ ERROR EN WEBHOOK:");
    console.log(error.response?.data || error.message);

    // NO ROMPER WHAPI
    res.sendStatus(200);
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en puerto", PORT);
});
