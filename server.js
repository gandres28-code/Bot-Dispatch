const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/", (req, res) => {
  res.send("Bot activo ✅");
});

app.post("/webhook", async (req, res) => {
  try {

    const message = req.body.body;

    console.log("📩 Mensaje:", message);

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un sistema de operaciones de housekeeping.

Extrae:
- Unidad
- Empleado
- Estado
- Problema
- Acción

Estados:
ENTRANDO
LIMPIANDO
LISTA
INSPECCIONADA
PROBLEMA
SUMINISTROS

Devuelve un reporte limpio para supervisor.
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

    console.log("🤖 IA:", ai);

    res.json({
      ok: true,
      input: message,
      ai: ai
    });

  } catch (error) {
    console.log(error.response?.data || error.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en", PORT);
});
