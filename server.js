const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 ENV
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID;

// 🧠 MEMORIA
const pendingMedia = {};

// 🧹 LIMPIEZA AUTOMÁTICA (evita memoria infinita)
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
  res.send("Bot ultra estable activo ✅");
});

// 📩 WEBHOOK
app.post("/webhook", async (req, res) => {
  try {

    const msg = req.body?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const chatId = msg?.chat_id;
    const employee = msg?.from_name || "Desconocido";
    const fromMe = msg?.from_me;

    if (fromMe) return res.sendStatus(200);

    const key = `${chatId}_${msg?.from}`;

    console.log("📩 EVENTO:", msg?.type);

    // 📸 DETECCIÓN ULTRA ROBUSTA DE IMAGEN
    if (msg?.type === "image") {

      const image =
        msg?.image?.preview ||
        msg?.image?.data ||
        msg?.image?.url ||
        msg?.media?.preview ||
        null;

      const imageId =
        msg?.image?.id ||
        msg?.media?.id ||
        null;

      console.log("📸 IMAGE DETECTED");
      console.log("🧠 imageId:", imageId ? "OK" : "NO ID");
      console.log("🧠 preview:", image ? "OK" : "NO PREVIEW");

      if (!image && !imageId) {
        return res.sendStatus(200);
      }

      pendingMedia[key] = {
        image,
        imageId,
        employee,
        time: Date.now()
      };

      return res.sendStatus(200);
    }

    // ✍️ TEXTO
    const message =
      msg?.text?.body ||
      msg?.text ||
      msg?.message ||
      "";

    if (!message) return res.sendStatus(200);

    console.log("📨 TEXTO:", message);

    // 🔗 MATCH IMAGE
    const pending = pendingMedia[key];

    let image = null;

    if (pending && Date.now() - pending.time < 20 * 60 * 1000) {
      image = pending.image;
      delete pendingMedia[key];
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
Eres sistema hotelero.

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

    // 📤 ENVÍO ULTRA ESTABLE
    await sendToOperations(finalMessage, image);

    res.sendStatus(200);

  } catch (err) {
    console.log("❌ ERROR:", err.response?.data || err.message);
    res.sendStatus(200);
  }
});

// 🚀 FUNCIÓN ULTRA ESTABLE DE ENVÍO
async function sendToOperations(text, image) {
  const headers = {
    Authorization: `Bearer ${WHAPI_TOKEN}`,
    "Content-Type": "application/json"
  };

  try {

    // 🟢 SI HAY IMAGEN
    if (image) {

      const payload = {
        to: OPERATIONS_GROUP_ID,
        media: image, // fallback universal
        caption: text
      };

      await axios.post(
        "https://gate.whapi.cloud/messages/image",
        payload,
        { headers }
      );

      console.log("📸 Enviado como imagen");
      return;
    }

    // 🟡 SOLO TEXTO
    await axios.post(
      "https://gate.whapi.cloud/messages/text",
      {
        to: OPERATIONS_GROUP_ID,
        body: text
      },
      { headers }
    );

    console.log("📄 Enviado como texto");

  } catch (err) {

    console.log("⚠️ FALLÓ ENVÍO, intentando fallback...");

    // 🔁 FALLBACK (WHAPI cambia reglas constantemente)
    try {
      await axios.post(
        "https://gate.whapi.cloud/messages/text",
        {
          to: OPERATIONS_GROUP_ID,
          body: text + (image ? "\n📸 Imagen disponible en sistema interno" : "")
        },
        { headers }
      );

      console.log("🟡 Fallback enviado como texto");

    } catch (err2) {
      console.log("❌ FALLBACK FALLÓ:", err2.response?.data || err2.message);
    }
  }
}

// 🚀 START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor ultra estable en puerto", PORT);
});
