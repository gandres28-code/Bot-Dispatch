const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🟢 Health check
app.get("/", (req, res) => {
  res.send("Bot activo y funcionando ✅");
});

// 📩 WEBHOOK WHAPI + OPENAI
app.post("/webhook", async (req, res) => {
  try {

    console.log("📩 WEBHOOK RECIBIDO:");
    console.log(JSON.stringify(req.body, null, 2));

    // 🔥 FIX REAL PARA WHAPI (EXTRACCIÓN CORRECTA)
    const message =
      req.body?.messages?.[0]?.text?.body ||
      req.body?.messages?.[0]?.text ||
      req.body?.messages?.[0]?.message ||
      "mensaje vacío";

    console.log("📨 MENSAJE EXTRAÍDO:", message);

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un sistema de operaciones de housekeeping de hotel.

Tu trabajo es analizar mensajes de WhatsApp y extraer:

- Unidad
- Empleado
- Estado (ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA)
- Notas importantes

Devuelve un reporte corto, claro y listo para supervisor.
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

    console.log("🤖 IA RESPUESTA:");
    console.log(ai);

    // 🔥 IMPORTANTE: responder siempre OK a Whapi
    res.sendStatus(200);

  } catch (error) {
    console.log("❌ ERROR WEBHOOK:");
    console.log(error.response?.data || error.message);

    // no romper webhook
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en puerto", PORT);
});
