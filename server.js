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

    console.log("📩 WEBHOOK RAW:");
    console.log(JSON.stringify(req.body, null, 2));

    const message =
      req.body?.text?.body ||
      req.body?.message?.text?.body ||
      req.body?.body ||
      req.body?.text ||
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
Eres un sistema de housekeeping hotelero.

Extrae:
- Unidad
- Persona
- Estado
- Notas

Estados: ENTRANDO, LIMPIANDO, LISTA, PROBLEMA
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
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const ai = response.data.choices[0].message.content;

    console.log("🤖 IA:");
    console.log(ai);

    res.sendStatus(200);

  } catch (error) {
    console.log("❌ ERROR:");
    console.log(error.response?.data || error.message);

    res.sendStatus(200);
  }
});
