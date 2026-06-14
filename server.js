const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 ENV
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
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
"120363408317536314@g.us"
];

// 🧠 MEMORIA
const pendingMedia = {};
const processed = new Set();

// 🧹 LIMPIEZA MEMORIA
setInterval(() => {

const now = Date.now();

for (const key in pendingMedia) {
if (now - pendingMedia[key].time > 1800000) {
delete pendingMedia[key];
}
}

processed.clear();

}, 600000);

// 🟢 HEALTH
app.get("/", (req, res) => {
res.send("Bot hotelero activo ✅");
});

// 📩 WEBHOOK
app.post("/webhook", async (req, res) => {

try {

console.log("📥 WEBHOOK");

const msg = req.body?.messages?.[0];

if (!msg) {
return res.sendStatus(200);
}

// ignorar eventos basura
if (
msg?.type === "action" ||
msg?.from_me
) {
return res.sendStatus(200);
}

const chatId = msg?.chat_id;

if (!ALLOWED_GROUPS.includes(chatId)) {
console.log("⛔ Grupo ignorado:", chatId);
return res.sendStatus(200);
}

const employee =
msg?.from_name ||
"Desconocido";

const eventId =
msg?.id ||
(chatId + "_" + msg?.timestamp);

if (processed.has(eventId)) {
return res.sendStatus(200);
}

processed.add(eventId);

console.log("📩 EVENTO:", msg?.type);

// 📸 FOTO
if (msg?.type === "image") {

const image =
msg?.image?.preview;

if (image) {

pendingMedia[
chatId + "_" + msg?.from
] = {

image,
time: Date.now()

};

console.log("📸 guardada");
}

return res.sendStatus(200);

}

// ✍️ TEXTO
const message =
msg?.text?.body ||
msg?.text ||
msg?.message ||
"";

if (!message.trim()) {
return res.sendStatus(200);
}

console.log("📨", message);

// 🔎 detectar unidad exacta
const unitRegex =
/(\d{2,4})\s*(A\s*Y\s*B|B\s*Y\s*A|A|B)?/i;

const match =
message.match(unitRegex);

let unit = "";

if (match) {

unit =
(match[1] || "").trim();

const suffix =
(match[2] || "")
.toUpperCase()
.replace(/\s+/g," ");

if (suffix) {
unit += " " + suffix;
}

}

// 🔥 detectar estado
const lower =
message.toLowerCase();

const isReady =
lower.includes("lista") ||
lower.includes("terminada") ||
lower.includes("finalizada");

const isIssue =

lower.includes("hay") ||
lower.includes("problema") ||
lower.includes("maleta") ||
lower.includes("equipaje") ||
lower.includes("falta") ||
lower.includes("sucio") ||
lower.includes("mantenimiento") ||
lower.includes("todavia") ||
lower.includes("todavía");

// ignorar conversación
if (!unit && !isIssue && !isReady) {

console.log("🛑 ignorado");

return res.sendStatus(200);

}

// 🕒 hora
const time =
new Date()
.toLocaleTimeString(
"en-US",
{
timeZone:
"America/Mexico_City",
hour:"2-digit",
minute:"2-digit",
hour12:true
}
);

// 📦 REPORTE
let report = "";

if (isReady) {

report =
"Unidad: " +
unit +
"\nEstado: LISTA";

}

else if (isIssue) {

report =
"Unidad: " +
(unit || "No indicada") +
"\nEstado: PROBLEMA" +
"\nNotas: " +
message;

}

else {

report =
"Unidad: " +
(unit || "No indicada") +
"\nEstado: OPERATIVO" +
"\nNotas: " +
message;

}

// 📤 OPERACIONES
const finalMessage =

"👷 " +
employee +

"\n🕒 " +
time +

"\n\n" +
report;

await axios.post(

"https://gate.whapi.cloud/messages/text",

{
to:
OPERATIONS_GROUP_ID,

body:
finalMessage

},

{
headers: {

Authorization:
"Bearer " +
WHAPI_TOKEN

}
}

);

console.log("✅ OPERACIONES");

// 🔎 INSPECTORES
if (
isReady &&
unit &&
INSPECTION_GROUP_ID
) {

const text =
unit +
" lista para inspeccionar";

await axios.post(

"https://gate.whapi.cloud/messages/text",

{
to:
INSPECTION_GROUP_ID,

body:
text

},

{
headers: {

Authorization:
"Bearer " +
WHAPI_TOKEN

}
}

);

console.log(
"🔎",
text
);

}

return res.sendStatus(200);

}

catch(err){

console.log(
"❌",
err.response?.data ||
err.message
);

return res.sendStatus(200);

}

});

// 🚀 START
const PORT =
process.env.PORT ||
3000;

app.listen(
PORT,
() => {

console.log(
"Servidor hotelero listo"
);

}
);
