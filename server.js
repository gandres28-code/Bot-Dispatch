const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 ENV
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID;

// 🧠 MEMORIA TEMPORAL
const pendingMedia = {};

// 🧹 LIMPIEZA AUTOMÁTICA
setInterval(() => {
  const now = Date.now();
  for (const key in pendingMedia) {
    if (now - pendingMedia[key].time > 30 * 60 * 1000) {
      delete pendingMedia[key];
    }
  }
}, 10 * 60 * 1000);

// 🟢 HEALTH
app.get("/", (req, res) => {
  res.send("Bot activo y funcionando 🚀");
});

// 📩 WEBHOOK
app.post("/webhook", async (req, res) => {
  try {

    const msg = req.body?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const chatId = msg?.chat_id;
    const employee = msg?.from_name || "Desconocido";

    if (msg?.from_me) return res.sendStatus(200);

    const key = `${chatId}_${msg?.from}`;

    console.log("📩 EVENTO:", msg?.type);

    // 📸 IMAGEN (HQ FIX REAL)
    if (msg?.type === "image") {

      const imageId = msg?.image?.id;

      console.log("📸 IMAGE ID:", imageId);

      if (!imageId) return res.sendStatus(200);

      try {

        // 📥 DESCARGAR IMAGEN REAL (FULL QUALITY)
        const fileRes = await axios.get(
          `https://gate.whapi.cloud/messages/file/${imageId}`,
          {
            headers: {
              Authorization: `Bearer ${WHAPI_TOKEN}`
            }
          }
        );

        const imageUrl =
          fileRes.data?.url ||
          fileRes.data?.link ||
          fileRes.data?.data?.url;

        console.log("🖼️ FULL QUALITY IMAGE URL:", imageUrl);

        if (!imageUrl) {
          console.log("⚠️ No se obtuvo URL HQ");
          return res.sendStatus(200);
        }

        pendingMedia[key] = {
          image: imageUrl,
          employee,
          time: Date.now()
        };

        console.log("📸 Imagen HQ guardada:", key);

      } catch (err) {
        console.log("❌ ERROR DESCARGANDO IMAGEN HQ:");
        console.log(err.response?.data || err.message);
      }

      return res.sendStatus(200);
    }

    // ✍️ TEXTO
    const message =
      msg?.text?.body ||
      msg?.text ||
      msg?.message ||
      "";

    if (!message) return res.sendStatus(200);

    console.log("📨 MENSAJE:", message);

    // 🔗 MATCH IMAGEN
    const pending = pendingMedia[key];

    let image = null;

    if (pending && Date.now() - pending.time < 20 * 60 * 1000) {
      image = pending.image;
      delete pendingMedia[key];
      console.log("🔗 IMAGEN HQ ASOCIADA AL TEXTO");
    }

    // 🤖 IA
    const ai = await axios.post(
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
- Estado
- Notas

No menciones imágenes.
`
          },
          {
            role: "user",
            content: `Empleado: ${employee}\nMensaje: ${message}`
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

    const report = ai.data.choices[0].message.content;

    const finalMessage = `👷 ${employee}\n\n${report}`;

    // 📤 ENVÍO A OPERACIONES
    if (image) {

      await axios.post(
        "https://gate.whapi.cloud/messages/image",
        {
          to: OPERATIONS_GROUP_ID,
          media: image, // ✅ HQ IMAGE URL
          caption: finalMessage
        },
        {
          headers: {
            Authorization: `Bearer ${WHAPI_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      console.log("📸 Enviado con imagen HQ");

    } else {

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

      console.log("📄 Enviado solo texto");
    }

    res.sendStatus(200);

  } catch (err) {
    console.log("❌ ERROR:", err.response?.data || err.message);
    res.sendStatus(200);
  }
});

// 🚀 START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor HQ listo en puerto", PORT);
});
