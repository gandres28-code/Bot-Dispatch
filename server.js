const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 ENV VARIABLES
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID;

// 🏨 GRUPOS AUTORIZADOS
const ALLOWED_GROUPS = [

"120363427834097943@g.us",
"120363425416827106@g.us",
"120363408939064520@g.us",
"120363428515985008@g.us",
"120363425695848832@g.us",

"120363408317536314@g.us",

];
// 🧠 MEMORIA TEMPORAL
const pendingMedia = {};

// 🧹 LIMPIEZA AUTOMÁTICA (evita basura en memoria)
setInterval(() => {
  const now = Date.now();
  for (const key in pendingMedia) {
    if (now - pendingMedia[key].time > 30 * 60 * 1000) {
      delete pendingMedia[key];
    }
  }
}, 10 * 60 * 1000);

// 🟢 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Bot hotelero activo ✅");
});

// 📩 WEBHOOK PRINCIPAL
app.post("/webhook", async (req, res) => {
  try {
    
console.log("========== WEBHOOK COMPLETO ==========");
console.log(JSON.stringify(req.body, null, 2));
console.log("======================================");
    
    const msg = req.body?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const chatId = msg?.chat_id;
    
    // 🚫 IGNORAR CHATS QUE NO SON DE LIMPIEZA
if (!ALLOWED_GROUPS.includes(chatId)) {

console.log("⛔ Grupo ignorado:", chatId);

return res.sendStatus(200);

}
    
    const employee = msg?.from_name || "Desconocido";
    const fromMe = msg?.from_me;

    if (fromMe) return res.sendStatus(200);

    const key = `${chatId}_${msg?.from}`;

    console.log("📩 EVENTO:", msg?.type);

    // 📸 SI ES IMAGEN
    if (msg?.type === "image") {

      const imageBase64 = msg?.image?.preview;

      if (!imageBase64) {
        console.log("⚠️ Imagen sin preview");
        return res.sendStatus(200);
      }

      pendingMedia[key] = {
        image: imageBase64,
        time: Date.now()
      };

      console.log("📸 Imagen guardada:", key);
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
    let hasImage = false;

    if (pending && Date.now() - pending.time < 20 * 60 * 1000) {
      image = pending.image;
      hasImage = true;
      delete pendingMedia[key];
    }

    // 🕒 HORA ACTUAL
    const now = new Date();
    const time = now.toLocaleString("en-US", {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });

    // 🤖 OPENAI
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
- Estado (ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA)
- Notas

NO menciones fotos ni evidencia.
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

    const report = ai.data.choices[0].message.content;

    // 📦 MENSAJE FINAL
    let finalMessage = `👷 ${employee}\n🕒 ${time}\n\n${report}`;

    if (hasImage) {
      finalMessage = `👷 ${employee}\n📸 Foto recibida\n🕒 ${time}\n\n${report}`;
    }

    // 📤 ENVÍO A OPERACIONES
    if (hasImage) {

      try {
        await axios.post(
          "https://gate.whapi.cloud/messages/image",
          {
            to: OPERATIONS_GROUP_ID,
            media: image,
            caption: finalMessage
          },
          {
            headers: {
              Authorization: `Bearer ${WHAPI_TOKEN}`,
              "Content-Type": "application/json"
            }
          }
        );

        console.log("📸 Foto + reporte enviado");

      } catch (err) {

        console.log("⚠️ fallback texto");

        await axios.post(
          "https://gate.whapi.cloud/messages/text",
          {
            to: OPERATIONS_GROUP_ID,
            body: finalMessage
          },
          {
            headers: {
              Authorization: `Bearer ${WHAPI_TOKEN}`
            }
          }
        );
      }

    } else {

      await axios.post(
        "https://gate.whapi.cloud/messages/text",
        {
          to: OPERATIONS_GROUP_ID,
          body: finalMessage
        },
        {
          headers: {
            Authorization: `Bearer ${WHAPI_TOKEN}`
          }
        }
      );
    }

    res.sendStatus(200);

  } catch (err) {
    console.log("❌ ERROR:", err.response?.data || err.message);
    res.sendStatus(200);
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor hotelero listo en puerto", PORT);
});
