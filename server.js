const express = require("express");
const axios = require("axios");
const { Client } = require("@notionhq/client");

const app = express();
app.use(express.json());

// 🔑 ENV
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || "";
const OPERATIONS_GROUP_ID = process.env.OPERATIONS_GROUP_ID || "";
const INSPECTION_GROUP_ID = process.env.INSPECTION_GROUP_ID || "";
const NOTION_API_KEY = process.env.NOTION_API_KEY || "";
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || "";

const notion = new Client({ auth: NOTION_API_KEY });

// 🏨 GRUPOS DE LIMPIEZA
const ALLOWED_GROUPS = [
"[120363427834097943@g.us](mailto:120363427834097943@g.us)",
"[120363425416827106@g.us](mailto:120363425416827106@g.us)",
"[120363408939064520@g.us](mailto:120363408939064520@g.us)",
"[120363428515985008@g.us](mailto:120363428515985008@g.us)",
"[120363425695848832@g.us](mailto:120363425695848832@g.us)",
"[120363408317536314@g.us](mailto:120363408317536314@g.us)",
"[120363426540218225@g.us](mailto:120363426540218225@g.us)"
];

const processed = new Set();

setInterval(() => {
processed.clear();
}, 600000);

app.get("/", (req, res) => {
res.send("🚀 Bot hotelero PRO + Notion + Inspectores activo");
});

function todayISO() {
return new Intl.DateTimeFormat("en-CA", {
timeZone: "America/Mexico_City",
year: "numeric",
month: "2-digit",
day: "2-digit"
}).format(new Date());
}

function detectUnitInfo(message) {
const match = message.match(/(\d{2,4})\s*(A\s*Y\s*B|B\s*Y\s*A|A|B)?/i);

if (!match) {
return { display: "", targets: [] };
}

const number = match[1];
let suffix = "";

if (match[2]) {
suffix = match[2].toUpperCase().replace(/\s+/g, " ").replace("B Y A", "A Y B");
}

if (suffix === "A Y B") {
return {
display: number + " A Y B",
targets: [number + "A", number + "B"]
};
}

if (suffix === "A" || suffix === "B") {
return {
display: number + " " + suffix,
targets: [number + suffix]
};
}

return {
display: number,
targets: [number]
};
}

function normalizeRoom(value) {
const text = String(value || "").toUpperCase();
const match = text.match(/(\d{2,4})\s*([A-Z])?/);

if (!match) return "";

let room = match[1];

if (match[2]) {
room += match[2];
}

return room;
}

function roomDigits(value) {
const match = String(value || "").match(/(\d{2,4})/);
return match ? match[1] : "";
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
lower.includes("llegue") ||
lower.includes("vamos a empezar") ||
lower.includes("voy a empezar") ||
lower.includes("empezando") ||
lower.includes("iniciando") ||
lower.includes("comenze") ||
lower.includes("comence") ||
lower.includes("comenzando") ||
lower.includes("estoy en");

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

function notionStatusFromIntent(intent) {
if (intent === "ENTRY") return "In Progress";
if (intent === "CLEANING") return "In Progress";
if (intent === "READY") return "Cleaned - Awaiting Inspection";
return null;
}

async function queryTodayRooms() {
let pages = [];
let cursor = undefined;

do {
const response = await notion.databases.query({
database_id: NOTION_DATABASE_ID,
start_cursor: cursor,
filter: {
property: "Date",
date: {
equals: todayISO()
}
}
});

pages = pages.concat(response.results);
cursor = response.has_more ? response.next_cursor : undefined;
} while (cursor);

return pages;
}

async function updateNotionRooms(unitTargets, intent, employee, message, customStatus = null) {
if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
console.log("⚠️ Notion env faltante");
return;
}

if (!unitTargets || unitTargets.length === 0) {
console.log("⚠️ No hay unidad para Notion");
return;
}

try {
const pages = await queryTodayRooms();

for (const target of unitTargets) {
const normalizedTarget = normalizeRoom(target);
const targetDigits = roomDigits(target);

let matches = pages.filter((page) => {
const title = page.properties["Room Number"]?.title?.map(t => t.plain_text).join("") || "";
return normalizeRoom(title) === normalizedTarget;
});

if (matches.length === 0) {
matches = pages.filter((page) => {
const title = page.properties["Room Number"]?.title?.map(t => t.plain_text).join("") || "";
return roomDigits(title) === targetDigits;
});
}

if (matches.length === 0) {
console.log("⚠️ No encontré unidad en Notion:", target);
continue;
}

for (const page of matches) {
const props = {
"Last Whatsapp Update": {
date: {
start: new Date().toISOString()
}
},
"Last Message": {
rich_text: [
{
text: {
content: message
}
}
]
},
"Last Update By": {
rich_text: [
{
text: {
content: employee
}
}
]
}
};

const status = customStatus || notionStatusFromIntent(intent);

if (status) {
props["Cleaning Status"] = {
select: {
name: status
}
};
}

if (intent === "ENTRY" || intent === "CLEANING") {
props["Started At"] = {
date: {
start: new Date().toISOString()
}
};
}

if (intent === "READY") {
props["Finished At"] = {
date: {
start: new Date().toISOString()
}
};
}

if (intent === "ISSUE") {
props["Issues Notes"] = {
rich_text: [
{
text: {
content: message
}
}
]
};
}

await notion.pages.update({
page_id: page.id,
properties: props
});

console.log("✅ Notion actualizado:", target, status || "");
}
}
} catch (err) {
console.log("❌ NOTION ERROR:", err.body || err.message);
}
}

function detectInspectionIntent(lower) {
const started =
lower.includes("empiezo inspeccion") ||
lower.includes("empiezo inspección") ||
lower.includes("empezando inspeccion") ||
lower.includes("empezando inspección") ||
lower.includes("voy a inspeccionar") ||
lower.includes("iniciando inspeccion") ||
lower.includes("iniciando inspección") ||
lower.includes("empecé inspeccion") ||
lower.includes("empecé inspección") ||
lower.includes("empece inspeccion") ||
lower.includes("empece inspección") ||
lower.includes("inspeccionando") ||
lower.includes("inspección iniciada") ||
lower.includes("inspeccion iniciada");

const finished =
lower.includes("termino inspeccion") ||
lower.includes("termino inspección") ||
lower.includes("terminé inspeccion") ||
lower.includes("terminé inspección") ||
lower.includes("termine inspeccion") ||
lower.includes("termine inspección") ||
lower.includes("inspeccion terminada") ||
lower.includes("inspección terminada") ||
lower.includes("aprobada") ||
lower.includes("aprobado") ||
lower.includes("ready for guest") ||
lower.includes("lista para guest") ||
lower.includes("listo para guest") ||
lower.includes("lista para huesped") ||
lower.includes("lista para huésped");

if (started) return "INSPECTION_STARTED";
if (finished) return "READY_FOR_GUEST";

return "";
}

app.post("/webhook", async (req, res) => {
try {
const msg = req.body?.messages?.[0];
if (!msg) return res.sendStatus(200);

if (msg?.type === "action" || msg?.from_me) return res.sendStatus(200);

const chatId = msg?.chat_id;

const isCleaningGroup = ALLOWED_GROUPS.includes(chatId);
const isInspectionGroup = chatId === INSPECTION_GROUP_ID;

if (!isCleaningGroup && !isInspectionGroup) return res.sendStatus(200);

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
const unitInfo = detectUnitInfo(message);
const unit = unitInfo.display;

if (isTrivialMessage(lower)) {
console.log("🧊 ignorado trivial");
return res.sendStatus(200);
}

// 🔎 FLUJO DEL GRUPO DE INSPECTORES
if (isInspectionGroup) {
const inspectionIntent = detectInspectionIntent(lower);

if (!inspectionIntent) {
return res.sendStatus(200);
}

if (!unit) {
await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: chatId,
body: "⚠️ ¿Podrían especificar la unidad que están inspeccionando?"
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);

return res.sendStatus(200);
}

let notionStatus = "";
let opsText = "";

if (inspectionIntent === "INSPECTION_STARTED") {
notionStatus = "Inspection Started";
opsText = employee + " empezó inspección en " + unit;
}

if (inspectionIntent === "READY_FOR_GUEST") {
notionStatus = "Ready for Guest";
opsText = employee + " terminó inspección en " + unit + ". Lista para guest.";
}

await updateNotionRooms(unitInfo.targets, "INSPECTION", employee, message, notionStatus);

await axios.post(
"https://gate.whapi.cloud/messages/text",
{
to: OPERATIONS_GROUP_ID,
body: opsText
},
{
headers: {
Authorization: "Bearer " + WHAPI_TOKEN
}
}
);

console.log("✅ inspección enviada a operaciones");

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
}

// 🧹 FLUJO DE LIMPIEZA
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

await updateNotionRooms(unitInfo.targets, intent, employee, message);

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
console.log("🚀 Bot hotelero PRO + Notion + Inspectores listo");
});
