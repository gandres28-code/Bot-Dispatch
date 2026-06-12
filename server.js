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

    const chatId = msg?.chat_id;
    const fromMe = msg?.from_me;
    const employee = msg?.from_name || "Desconocido";

    if (fromMe) return res.sendStatus(200);

    const key = `${chatId}_${msg?.from}`;

    // 📸 IMAGEN
    if (msg?.type === "image") {

      const imageBase64 = msg?.image?.preview;

      if (!imageBase64) return res.sendStatus(200);

      pendingMedia[key] = {
        image: imageBase64,
        time: Date.now()
      };

      return res.sendStatus(200);
    }

    // ✍️ TEXTO
    const message =
      msg?.text?.body ||
      msg?.text ||
      msg?.message ||
      "mensaje vacío";

    if (!message || message === "mensaje vacío") return res.sendStatus(200);

    // 🔗 BUSCAR IMAGEN
    const pending = pendingMedia[key];

    let image = null;

    if (pending && Date.now() - pending.time < 20 * 60 * 1000) {
      image = pending.image;
      delete pendingMedia[key];
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

Reglas:
- No menciones imágenes ni evidencia.
- Solo reporta datos claros.

Extrae:
- Unidad
- Estado (ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA)
- Notas
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

    // 📤 MENSAJE BASE
    const finalMessage = `👷 ${employee}\n\n${ai}`;

    // 📡 SI HAY IMAGEN → ENVIAR COMO IMAGEN (SEPARADO)
    if (image) {
      await axios.post(
        "https://gate.whapi.cloud/messages/image",
        {
          to: OPERATIONS_GROUP_ID,
          image: image,
          caption: finalMessage
        },
        {
          headers: {
            Authorization: `Bearer ${WHAPI_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
    } 
    // 📄 SI NO HAY IMAGEN → SOLO TEXTO
    else {
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
    }

    res.sendStatus(200);

  } catch (error) {
    console.log("❌ ERROR:", error.response?.data || error.message);
    res.sendStatus(200);
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo en puerto", PORT);
});
