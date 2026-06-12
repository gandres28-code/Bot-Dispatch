const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🟢 prueba básica
app.get("/", (req, res) => {
  res.send("Bot activo ✅");
});

// 📩 webhook seguro
app.post("/webhook", async (req, res) => {
  try {

    console.log("📩 WEBHOOK RECIBIDO:");
    console.log(req.body);

    const message = req.body?.body || "mensaje vacío";

    console.log("📨 MENSAJE:", message);

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un sistema de housekeeping.

Extrae:
- Unidad
- Persona
- Estado

Estados:
ENTRANDO, LIMPIANDO, LISTA, PROBLEMA
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

    res.sendStatus(200);

  } catch (error) {
    console.log("❌ ERROR:");
    console.log(error.response?.data || error.message);

    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en", PORT);
});
