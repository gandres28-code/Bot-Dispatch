const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 ENV
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || "";
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID || "";
const INSPECTION_GROUP_ID = process.env.INSPECTION_GROUP_ID || "";

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
const processed = new Set();

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

// 🚨 IGNORAR ACTION
if (msg?.type === "action") {
return res.sendStatus(200);
}

const chatId = msg?.chat_id;

if (!ALLOWED_GROUPS.includes(chatId)) return res.sendStatus(200);
if (msg?.from_me) return res.sendStatus(200);

const employee = msg?.from_name || "Desconocido";

// 🔑 anti duplicados
const eventId = msg?.id || (chatId + "_" + msg?.from + "_" + msg?.timestamp);
if (processed.has(eventId)) return res.sendStatus(200);
processed.add(eventId);

console.log("📩 EVENTO:", msg?.type);

// 📸 IMAGEN
if (msg?.type === "image") {

const image = msg?.image?.preview;
if (!image) return res.sendStatus(200);

pendingMedia[chatId + "_" + msg?.from] = {
image,
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

if (!message || message.trim().length < 2) return res.sendStatus(200);

console.log("📨", message);

// 🔥 FIX CLAVE: detectar unidad REAL desde texto natural
const unitMatch = message.toUpperCase().match(/(\d{2,4})\s*([AB])?/);

let unitNumber = unitMatch?.[1] || null;
let unitLetter = unitMatch?.[2] || "";

// 🔥 detectar problema real
const isIssue =
message.toLowerCase().includes("maleta") ||
message.toLowerCase().includes("sucio") ||
message.toLowerCase().includes("falta") ||
message.toLowerCase().includes("problema") ||
message.toLowerCase().includes("todavía") ||
message.toLowerCase().includes("hay") ||
message.toLowerCase().includes("limpieza");

// 🔗 imagen match
const key = chatId + "_" + msg?.from;

let image = null;

if (pendingMedia[key] && Date.now() - pendingMedia[key].time < 1200000) {
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

// 🤖 IA (solo estructura, NO decisión crítica)
let report = "";

try {
const ai = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model: "gpt-4o-mini",
messages: [
{
role: "system",
content: `
Eres un sistema hotelero.

Responde SOLO si es operativo.

Formato:
Unidad:
Estado:
Notas:

Si no es operativo responde EXACTO: NO REPORTABLE
`
},
{
role: "user",
content: "Empleado: " + employee + "\nMensaje: " + message
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

report = ai.data?.choices?.[0]?.message?.content?.trim() || "";

} catch (err) {
console.log("IA ERROR:", err.message);
}

// 🚫 SI IA bloquea pero hay señal real, NO lo mates
const aiBlocked = report.toUpperCase().includes("NO REPORTABLE");

if (aiBlocked && !isIssue && !unitNumber) {
return res.sendStatus(200);
}

// 🧠 construir unidad FINAL
let finalUnit = unitNumber
? unitNumber + (unitLetter ? " " + unitLetter : "")
: "Unidad no especificada";

// 📦 MENSAJE OPERACIONES
const finalMessage =
"👷 " + employee +
"\n🕒 " + time +
"\n🏨 " + finalUnit +
"\n\n" +
(aiBlocked ? message : report);

// 📤 OPERACIONES
await axios.post(
"https://gate.whapi.cloud/messages/text",
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

// 🔎 INSPECTORES (LISTA ONLY)
const isList =
message.toLowerCase().includes("lista") ||
message.toLowerCase().includes("terminada") ||
message.toLowerCase().includes("finalizada");

if (isList && unitNumber) {

let inspectionMsg = `${unitNumber}${unitLetter ? " " + unitLetter : ""} lista para inspeccionar`;

await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: INSPECTION_GROUP_ID,
body: inspectionMsg
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);

console.log("🔎 INSPECTORES enviado:", inspectionMsg);
}

res.sendStatus(200);

} catch (err) {
console.log("ERROR:", err.response?.data || err.message);
res.sendStatus(200);
}

});

// 🚀 START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log("Servidor hotelero listo");
});
