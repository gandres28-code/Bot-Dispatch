const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 ENV
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
"120363408317536314@g.us"
];

// 🧠 MEMORIA
const pendingMedia = {};

// 🧹 LIMPIEZA
setInterval(() => {
const now = Date.now();

for (const key in pendingMedia) {
if (now - pendingMedia[key].time > 1800000) {
delete pendingMedia[key];
}
}

}, 600000);

// 🟢 HEALTH
app.get("/", (req, res) => {
res.send("Bot hotelero activo ✅");
});

// 📩 WEBHOOK
app.post("/webhook", async (req, res) => {

try {

const msg = req.body?.messages?.[0];
if (!msg) return res.sendStatus(200);

const chatId = msg?.chat_id;

// 🚫 SOLO GRUPOS AUTORIZADOS
if (!ALLOWED_GROUPS.includes(chatId)) {
console.log("⛔ Grupo ignorado:", chatId);
return res.sendStatus(200);
}

if (msg?.from_me) return res.sendStatus(200);

const employee = msg?.from_name || "Desconocido";

// 🔑 KEY (SIN TEMPLATE STRINGS PARA EVITAR ERRORES RENDER)
const key = chatId + "_" + msg?.from;

console.log("📩 EVENTO:", msg?.type);

// 📸 IMAGEN
if (msg?.type === "image") {

const image = msg?.image?.preview;

if (!image) return res.sendStatus(200);

pendingMedia[key] = {
image: image,
time: Date.now()
};

console.log("📸 Imagen guardada");
return res.sendStatus(200);
}

// ✍️ TEXTO
const message =
msg?.text?.body ||
msg?.text ||
msg?.message ||
"";

if (!message) return res.sendStatus(200);

console.log("📨", message);

// 🔗 MATCH IMAGEN
let image = null;

if (
pendingMedia[key] &&
Date.now() - pendingMedia[key].time < 1200000
) {
image = pendingMedia[key].image;
delete pendingMedia[key];
}

const hasImage = !!image;

// 🕒 HORA
const time = new Date().toLocaleString("en-US", {
timeZone: "America/Mexico_City",
hour: "2-digit",
minute: "2-digit",
hour12: true
});

// 🤖 IA
const ai = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model: "gpt-4o-mini",
messages: [
{
role: "system",
content: `
Eres un sistema hotelero.

Decide si el mensaje debe enviarse a OPERACIONES.

ENVIAR SOLO SI:
- unidad
- problema
- limpieza
- entrada
- salida
- mantenimiento
- inspección
- solicitud
- estado operativo

NO ENVIAR:
- hola
- gracias
- ok
- emojis
- conversación casual

Si no es relevante responde EXACTO:
NO REPORTABLE

Si es relevante:
Unidad:
Estado:
Notas:
`
},
{
role: "user",
content:
"Empleado: " + employee + "\nMensaje: " + message
}
]
},
{
headers: {
Authorization: "Bearer " + OPENAI_API_KEY,
"Content-Type": "application/json"
}
}
);

// 📋 REPORTE
const report = ai.data?.choices?.[0]?.message?.content?.trim() || "";

// 🚫 IGNORAR
if (report.toUpperCase().includes("NO REPORTABLE")) {
console.log("🛑 Ignorado");
return res.sendStatus(200);
}

// 📦 MENSAJE FINAL
let finalMessage =
"👷 " + employee +
"\n🕒 " + time +
"\n\n" + report;

if (hasImage) {
finalMessage =
"👷 " + employee +
"\n📸 Foto recibida" +
"\n🕒 " + time +
"\n\n" + report;
}

// 📤 ENVÍO
const sendUrl = "https://gate.whapi.cloud/messages/text";

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
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);
} catch (err) {
await axios.post(
sendUrl,
{
to: OPERATIONS_GROUP_ID,
body: finalMessage
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);
}
} else {
await axios.post(
sendUrl,
{
to: OPERATIONS_GROUP_ID,
body: finalMessage
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);
}

res.sendStatus(200);

} catch (err) {
console.log(err.response?.data || err.message);
res.sendStatus(200);
}

});

// 🚀 START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log("Servidor hotelero listo");
});
