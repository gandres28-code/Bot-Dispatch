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

const processed = new Set();

setInterval(() => {
processed.clear();
}, 600000);

app.get("/", (req, res) => {
res.send("Bot hotelero PRO activo 🏨");
});

function detectUnit(message) {
const match = message.match(/(\d{2,4})\s*(A\s*Y\s*B|B\s*Y\s*A|A|B)?/i);

if (!match) return "";

let unit = match[1];

if (match[2]) {
let suffix = match[2]
.toUpperCase()
.replace(/\s+/g, " ")
.replace("B Y A", "A Y B");

unit += " " + suffix;
}

return unit;
}

function isTrivialMessage(lower) {
const clean = lower.trim();

return (
clean === "hola" ||
clean === "ok" ||
clean === "okay" ||
clean === "gracias" ||
clean === "thanks" ||
clean === "jaja" ||
clean === "👍" ||
clean === "👌" ||
clean === "buenos dias" ||
clean === "buenos días" ||
clean === "buenas"
);
}

function getIntent(lower, unit) {
const isEntry =
lower.includes("acabo de entrar") ||
lower.includes("ya entré") ||
lower.includes("ya entre") ||
lower.includes("entrando") ||
lower.includes("entré") ||
lower.includes("entre") ||
lower.includes("llegué") ||
lower.includes("llegue");

const isCleaning =
lower.includes("limpiando") ||
lower.includes("empecé") ||
lower.includes("empece") ||
lower.includes("trabajando");

const isReady =
lower.includes("lista") ||
lower.includes("terminada") ||
lower.includes("finalizada") ||
lower.includes("terminé") ||
lower.includes("termine");

const isExit =
lower.includes("salí") ||
lower.includes("sali") ||
lower.includes("salgo") ||
lower.includes("ya salí") ||
lower.includes("ya sali");

const isIssue =
lower.includes("hay") ||
lower.includes("falta") ||
lower.includes("maleta") ||
lower.includes("equipaje") ||
lower.includes("problema") ||
lower.includes("sucio") ||
lower.includes("mantenimiento") ||
lower.includes("necesito") ||
lower.includes("toalla") ||
lower.includes("papel") ||
lower.includes("basura") ||
lower.includes("dañado") ||
lower.includes("roto") ||
lower.includes("no funciona");

const hasOperationalHint =
lower.includes("unidad") ||
lower.includes("cuarto") ||
lower.includes("habitación") ||
lower.includes("habitacion") ||
lower.includes("room") ||
unit;

if (isEntry) return "ENTRY";
if (isCleaning) return "CLEANING";
if (isReady) return "READY";
if (isExit) return "EXIT";
if (isIssue) return "ISSUE";

if (hasOperationalHint) return "INCOMPLETE";

return "TRIVIAL";
}

function buildReport(employee, unit, intent, originalMessage) {
const target = unit || "la unidad";

if (intent === "ENTRY") return employee + " entró a " + target;
if (intent === "CLEANING") return employee + " está limpiando " + target;
if (intent === "READY") return employee + " terminó " + target;
if (intent === "EXIT") return employee + " salió de " + target;
if (intent === "ISSUE") return employee + " necesita atención en " + target + ": " + originalMessage;

return "";
}

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

const message =
msg?.text?.body ||
msg?.text ||
msg?.message ||
"";

if (!message.trim()) return res.sendStatus(200);

console.log("📨", message);

const lower = message.toLowerCase();
const unit = detectUnit(message);

if (isTrivialMessage(lower)) {
console.log("🧊 ignorado trivial");
return res.sendStatus(200);
}

const intent = getIntent(lower, unit);

if (intent === "TRIVIAL") {
return res.sendStatus(200);
}

if (intent === "INCOMPLETE" && !unit) {
await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: chatId,
body: "⚠️ ¿Podrían especificar la unidad y qué necesitan reportar?"
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);

return res.sendStatus(200);
}

if ((intent === "ENTRY" || intent === "CLEANING" || intent === "READY" || intent === "EXIT" || intent === "ISSUE") && !unit) {
await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: chatId,
body: "⚠️ ¿Podrían especificar la unidad para poder reportarlo?"
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);

return res.sendStatus(200);
}

const report = buildReport(employee, unit, intent, message);

if (!report) return res.sendStatus(200);

const time = new Date().toLocaleTimeString("en-US", {
timeZone: "America/Mexico_City",
hour: "2-digit",
minute: "2-digit",
hour12: true
});

const opsMessage =
"🕒 " + time +
"\n\n" +
report;

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

if (intent === "READY" && unit && INSPECTION_GROUP_ID) {
const inspectionMsg = unit + " lista para inspeccionar";

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

await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: chatId,
body: "✅ " + employee + ", ya lo reporté a operaciones"
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log("🚀 Bot hotelero PRO listo");
});
