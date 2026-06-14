const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 ENV
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || "";
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID || "";
const INSPECTION_GROUP_ID = process.env.INSPECTION_GROUP_ID || "";

// 🏨 GRUPOS
const ALLOWED_GROUPS = [
"120363427834097943@g.us",
"120363425416827106@g.us",
"120363408939064520@g.us",
"120363428515985008@g.us",
"120363425695848832@g.us",
"120363408317536314@g.us",
"120363426540218225@g.us"
];

// 🧠 MEMORIA
const processed = new Set();

// 🧹 LIMPIEZA
setInterval(() => {
processed.clear();
}, 600000);

// 🟢 HEALTH
app.get("/", (req, res) => {
res.send("Bot hotelero PRO activo 🏨");
});

// ======================================================
// 🧠 MOTOR INTELIGENTE DE INTENCIÓN
// ======================================================

function detectIntent(text) {
const lower = text.toLowerCase();

// ❌ trivial chat
const trivial =
lower.match(/^(hola|ok|gracias|jaja|buenas|que tal|hey)$/);

// 🧠 operación real (lo importante)
const operational =
/\d{2,4}/.test(lower) || // tiene unidad
lower.includes("unidad") ||
lower.includes("habitación") ||
lower.includes("cuarto") ||
lower.includes("limpi") ||
lower.includes("entr") ||
lower.includes("sal") ||
lower.includes("falta") ||
lower.includes("hay") ||
lower.includes("necesito") ||
lower.includes("problema") ||
lower.includes("mantenimiento") ||
lower.includes("todavía") ||
lower.includes("aún");

// 🎯 clasificación
if (trivial) return "TRIVIAL";
if (operational) return "OPERATIONAL";

return "UNKNOWN";
}

// ======================================================
// 📩 WEBHOOK
// ======================================================

app.post("/webhook", async (req, res) => {

try {

const msg = req.body?.messages?.[0];
if (!msg) return res.sendStatus(200);

if (msg?.type === "action" || msg?.from_me) return res.sendStatus(200);

const chatId = msg?.chat_id;

if (!ALLOWED_GROUPS.includes(chatId)) return res.sendStatus(200);

const employee = msg?.from_name || "Desconocido";

const eventId = msg?.id || (chatId + "_" + msg?.timestamp);
if (processed.has(eventId)) return res.sendStatus(200);
processed.add(eventId);

// 📨 mensaje
const message =
msg?.text?.body ||
msg?.text ||
msg?.message ||
"";

if (!message.trim()) return res.sendStatus(200);

console.log("📨", message);

// 🧠 detectar intención
const intent = detectIntent(message);

// 🚫 ignorar charla trivial
if (intent === "TRIVIAL") {
console.log("🧊 ignorado trivial");
return res.sendStatus(200);
}

// ❓ si no entiende pero parece operación → pedir aclaración
if (intent === "UNKNOWN") {

await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: chatId,
body: `👷 ${employee} necesito un poco más de detalle para poder reportarlo correctamente (unidad + qué sucede)`
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);

return res.sendStatus(200);
}

// 🔎 detectar unidad
const unitMatch = message.match(/(\d{2,4})\s*(A|B|A\s*Y\s*B|B\s*Y\s*A)?/i);

let unit = "";

if (unitMatch) {
unit = unitMatch[1];
if (unitMatch[2]) {
unit += " " + unitMatch[2].toUpperCase().replace(/\s+/g, " ");
}
}

// 🧠 estados humanos
const lower = message.toLowerCase();

let action = "";

if (lower.includes("entr") || lower.includes("acabo de entrar") || lower.includes("lleg")) {
action = "ENTRÓ A";
}
else if (lower.includes("limpi")) {
action = "LIMPIANDO";
}
else if (lower.includes("lista") || lower.includes("terminad") || lower.includes("finalizad")) {
action = "TERMINÓ";
}
else if (lower.includes("sal")) {
action = "SALIÓ DE";
}
else if (lower.includes("falta") || lower.includes("hay") || lower.includes("problema") || lower.includes("necesito")) {
action = "NECESITA ATENCIÓN EN";
}
else {
action = "REVISAR";
}

// 🕒 hora
const time = new Date().toLocaleTimeString("en-US", {
timeZone: "America/Mexico_City",
hour: "2-digit",
minute: "2-digit",
hour12: true
});

// 📦 MENSAJE OPERACIONES (ULTRA SIMPLE)
const opsMessage =
`👷 ${employee}
🕒 ${time}
🏨 ${action} ${unit || "unidad no especificada"}`;

// 📤 OPERACIONES
await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: OPERATIONS_GROUP_ID,
body: opsMessage
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);

console.log("✅ operaciones enviado");

// 🔎 INSPECTORES
if (
lower.includes("lista") ||
lower.includes("terminad") ||
lower.includes("finalizad")
) {

if (unit) {

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

console.log("🔎 inspectores enviado");
}
}

// 🤖 RESPUESTA AUTOMÁTICA SOLO CUANDO IMPORTA
await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: chatId,
body: `✅ ${employee}, ya lo reporté a operaciones`
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);

return res.sendStatus(200);

} catch (err) {
console.log("❌ ERROR:", err.response?.data || err.message);
return res.sendStatus(200);
}

});

// 🚀 START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log("🚀 Bot hotelero PRO listo");
});
