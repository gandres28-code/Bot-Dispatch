const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 ENV (SAFE)
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
console.log("⛔ action ignorado");
return res.sendStatus(200);
}

const chatId = msg?.chat_id;

if (!ALLOWED_GROUPS.includes(chatId)) {
return res.sendStatus(200);
}

if (msg?.from_me) return res.sendStatus(200);

const employee = msg?.from_name || "Desconocido";

// 🔑 ANTI DUPLICADOS
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

console.log("📸 imagen guardada");
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

// 🔗 MATCH IMAGEN
const key = chatId + "_" + msg?.from;

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

// 🧠 VALIDACIÓN ENV (CRÍTICO)
if (!OPENAI_API_KEY || !WHAPI_TOKEN || !OPERATIONS_GROUP_ID) {
console.log("❌ ENV faltante (revisar Render)");
return res.sendStatus(200);
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
Eres un sistema hotelero.

Si NO es operativo responde EXACTO:
NO REPORTABLE

Si es operativo responde:

Unidad:
Estado:
Notas:

Estados válidos:
ENTRANDO, LIMPIANDO, LISTA, PROBLEMA, INSPECCIONADA, SALIDA, MANTENIMIENTO, TERMINADA, FINALIZADA
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

// 📋 REPORTE
const report = ai.data?.choices?.[0]?.message?.content?.trim() || "";

if (report.toUpperCase().includes("NO REPORTABLE")) {
return res.sendStatus(200);
}

// 📦 MENSAJE OPERACIONES
const finalMessage =
"👷 " + employee +
"\n🕒 " + time +
"\n\n" + report;

// 📤 SEND OPERATIONS
try {
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

console.log("✅ OPERACIONES enviado");

} catch (err) {
console.log("❌ ERROR OPERACIONES:", err.response?.data || err.message);
}

// 🔎 INSPECTORES (ROBUSTO)
try {

let unitMatch = report.match(/Unidad:\s*([A-Za-z0-9]+)/i);
let stateMatch = report.match(/Estado:\s*([A-Za-z]+)/i);

let unit = unitMatch?.[1]?.toUpperCase();
let state = (stateMatch?.[1] || "").toUpperCase();

// normalización fuerte
if (
state.includes("LISTA") ||
state.includes("TERMINADA") ||
state.includes("FINALIZADA")
) {
state = "LISTA";
}

if (unit && state === "LISTA") {

const inspectionMsg = `${unit} lista para inspeccionar`;

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

} catch (err) {
console.log("❌ ERROR INSPECTORES:", err.response?.data || err.message);
}

res.sendStatus(200);

} catch (err) {
console.log("❌ ERROR GENERAL:", err.response?.data || err.message);
res.sendStatus(200);
}

});

// 🚀 START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log("Servidor hotelero listo");
});
