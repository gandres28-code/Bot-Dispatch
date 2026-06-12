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

// 🧹 CLEANUP
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
res.send("Bot hotelero activo ✅");
});

// 📩 WEBHOOK
app.post("/webhook", async (req, res) => {

try {

const msg = req.body?.messages?.[0];
if (!msg) return res.sendStatus(200);

// 🚨 ignorar actions
if (msg?.type === "action") return res.sendStatus(200);

const chatId = msg?.chat_id;

if (!ALLOWED_GROUPS.includes(chatId)) return res.sendStatus(200);
if (msg?.from_me) return res.sendStatus(200);

const employee = msg?.from_name || "Desconocido";

// 🔑 anti duplicados
const eventId = msg?.id || `${chatId}_${msg?.from}_${msg?.timestamp}`;
if (processed.has(eventId)) return res.sendStatus(200);
processed.add(eventId);

console.log("📩 EVENTO:", msg?.type);

// 📸 IMAGE
if (msg?.type === "image") {

const image = msg?.image?.preview;
if (!image) return res.sendStatus(200);

pendingMedia[chatId + "_" + msg?.from] = {
image,
time: Date.now()
};

return res.sendStatus(200);
}

// ✍️ TEXT
const message =
msg?.text?.body ||
msg?.text ||
msg?.message ||
"";

if (!message || message.trim().length < 2) return res.sendStatus(200);

console.log("📨", message);

// 🔗 IMAGE MATCH
const key = chatId + "_" + msg?.from;

let image = null;

if (pendingMedia[key] && Date.now() - pendingMedia[key].time < 20 * 60 * 1000) {
image = pendingMedia[key].image;
delete pendingMedia[key];
}

// 🕒 TIME
const time = new Date().toLocaleString("en-US", {
timeZone: "America/Mexico_City",
hour: "2-digit",
minute: "2-digit",
hour12: true
});

// 🤖 OPENAI (solo operaciones)
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

Si NO es operativo responde EXACTO:
NO REPORTABLE

Si es operativo responde:

Unidad:
Estado:
Notas:
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
Authorization: "Bearer " + OPENAI_API_KEY,
"Content-Type": "application/json"
}
}
);

report = ai.data?.choices?.[0]?.message?.content?.trim() || "";
} catch (e) {
console.log("⚠️ OpenAI error:", e.message);
return res.sendStatus(200);
}

// 🚫 ignore
if (report.toUpperCase().includes("NO REPORTABLE")) {
return res.sendStatus(200);
}

// 📦 OPERACIONES
const finalMessage =
`👷 ${employee}
🕒 ${time}

${report}`;

await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: OPERATIONS_GROUP_ID,
body: finalMessage
},
{
headers: { Authorization: "Bearer " + WHAPI_TOKEN }
}
);

// 🔥 INSPECTORES (FIX REAL A/B)
const upperMsg = message.toUpperCase();

// detectar unidad tipo 235 A y B
const unitMatch = upperMsg.match(/(\d+)\s*([AB](?:\s*Y\s*[AB])?)?/i);

let unitNumber = unitMatch?.[1];
let abPart = unitMatch?.[2] || "";

// normalizar A/B
let suffix = "";

if (abPart.includes("A") && abPart.includes("B")) {
suffix = "A y B";
} else if (abPart.includes("A")) {
suffix = "A";
} else if (abPart.includes("B")) {
suffix = "B";
}

if (unitNumber && report.toUpperCase().includes("LISTA")) {

let finalUnit = unitNumber;
if (suffix) finalUnit += " " + suffix;

const inspectionMsg = `${finalUnit} lista para inspeccionar`;

await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: INSPECTION_GROUP_ID,
body: inspectionMsg
},
{
headers: { Authorization: "Bearer " + WHAPI_TOKEN }
}
);

console.log("🔎 INSPECTORES:", inspectionMsg);
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
console.log("Servidor hotelero listo");
});
