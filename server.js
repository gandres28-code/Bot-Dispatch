require("dotenv").config();
const express = require("express");
const { Client } = require("@notionhq/client");
const OpenAI = require("openai");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");
const app = express();
// ■ Anti duplicados
const recentActions = new Map();
app.use(express.json());
app.use(express.static("public"));
// ■ Carpeta para PDFs
const reportsDir = path.join(__dirname, "reports");
if (!fs.existsSync(reportsDir)) {
fs.mkdirSync(reportsDir);
}
app.use("/reports", express.static(reportsDir));
// ■ Carpeta para Excel de nómina
const payrollDir = path.join(__dirname, "payroll_exports");
if (!fs.existsSync(payrollDir)) {
fs.mkdirSync(payrollDir);
}
app.use("/payroll_exports", express.static(payrollDir));
// ■ ENV
const NOTION_API_KEY =
process.env.NOTION_API_KEY ||
process.env.NOTION_TOKEN ||
"";
const NOTION_DATABASE_ID =
process.env.NOTION_DATABASE_ID ||
process.env.DATABASE_ID ||
"37f25b5a514a8092ad64e6a8d478dc76";
const NOTION_LOG_DATABASE_ID =
process.env.NOTION_LOG_DATABASE_ID ||
process.env.NOTION_DAILY_CLEANING_LOGS_DB_ID ||
"";
const NOTION_PAYROLL_DATABASE_ID =
process.env.NOTION_PAYROLL_DATABASE_ID ||
process.env.NOTION_PAYROLL_RECORDS_DB_ID ||
"";
const OPENAI_API_KEY =
process.env.OPENAI_API_KEY || "";
console.log("■ ENV CHECK");
console.log("NOTION_API_KEY existe:", !!NOTION_API_KEY);
console.log("NOTION_DATABASE_ID existe:", !!NOTION_DATABASE_ID);
console.log("NOTION_LOG_DATABASE_ID existe:", !!NOTION_LOG_DATABASE_ID);
console.log("NOTION_PAYROLL_DATABASE_ID existe:", !!NOTION_PAYROLL_DATABASE_ID);
console.log("OPENAI_API_KEY existe:", !!OPENAI_API_KEY);
const notion = new Client({ auth: NOTION_API_KEY });
const openai = new OpenAI({
apiKey: OPENAI_API_KEY || "no-key",
});
// ■ Página principal limpiadores
app.get("/", (req, res) => {
res.sendFile(__dirname + "/public/index.html");
});
// ■ Página inspectores
app.get("/inspector", (req, res) => {
res.sendFile(__dirname + "/public/inspector.html");
});
// ■ Diagnóstico seguro
app.get("/debug-env", (req, res) => {
res.json({
notionApiKeyExists: !!NOTION_API_KEY,
notionDatabaseIdExists: !!NOTION_DATABASE_ID,
notionLogDatabaseIdExists: !!NOTION_LOG_DATABASE_ID,
notionPayrollDatabaseIdExists: !!NOTION_PAYROLL_DATABASE_ID,
openAiKeyExists: !!OPENAI_API_KEY,
notionDatabaseIdPreview: NOTION_DATABASE_ID
? NOTION_DATABASE_ID.slice(0, 6) + "..." + NOTION_DATABASE_ID.slice(-6)
: null,
notionLogDatabaseIdPreview: NOTION_LOG_DATABASE_ID
? NOTION_LOG_DATABASE_ID.slice(0, 6) + "..." + NOTION_LOG_DATABASE_ID.slice(-6)
: null,
notionPayrollDatabaseIdPreview: NOTION_PAYROLL_DATABASE_ID
? NOTION_PAYROLL_DATABASE_ID.slice(0, 6) + "..." + NOTION_PAYROLL_DATABASE_ID.slice(-6)
: null,
});
});
// ■ Fecha de hoy
function todayISO() {
return new Intl.DateTimeFormat("en-CA", {
timeZone: "America/Chicago",
year: "numeric",
month: "2-digit",
day: "2-digit",
}).format(new Date());
}
// ■ Hora local
function localTime() {
return new Date().toLocaleString("en-US", {
timeZone: "America/Chicago",
hour: "2-digit",
minute: "2-digit",
hour12: true,
});
}
// ■ Normalizar unidad
function normalizeRoom(value) {
const text = String(value || "").toUpperCase();
const match = text.match(/(\d{2,4})\s*([A-Z])?/);
if (!match) return "";
let room = match[1];
if (match[2]) room += match[2];
return room;
}
// ■ Solo números
function roomDigits(value) {
const match = String(value || "").match(/(\d{2,4})/);
return match ? match[1] : "";
}
// ■ Tarifas por tipo de unidad
// Cambia estos números por tus tarifas reales.
// También puedes controlarlos desde Render con PAYROLL_RATE_1, PAYROLL_RATE_2, etc.
const ROOM_RATES = {
S: Number(process.env.PAYROLL_RATE_S || 15), // Studio
M: Number(process.env.PAYROLL_RATE_M || 10), // Motel
"1": Number(process.env.PAYROLL_RATE_1 || 20),
"2": Number(process.env.PAYROLL_RATE_2 || 30),
"3": Number(process.env.PAYROLL_RATE_3 || 40),
"4": Number(process.env.PAYROLL_RATE_4 || 50),
"5": Number(process.env.PAYROLL_RATE_5 || 60),
};
// ■ Leer tipo de habitación desde lo que está entre paréntesis: 331A (2), 405 (S), 210 (M)
function getRoomType(unitName) {
const match = String(unitName || "").match(/\(([^)]+)\)/);
if (!match) return "";
return match[1].trim().toUpperCase();
}
// ■ Calcular pago por unidad
function getUnitPay(unitName) {
const roomType = getRoomType(unitName);
if (!roomType) {
return {
roomType: "",
amount: 0,
error: "No se encontró tipo de unidad entre paréntesis",
};
}
const amount = ROOM_RATES[roomType];
if (amount === undefined || Number.isNaN(amount)) {
return {
roomType,
amount: 0,
error: `No hay tarifa configurada para tipo ${roomType}`,
};
}
return {
roomType,
amount,
error: null,
};
}
// ■ Semana de nómina: lunes a domingo
function getPayrollWeek(date = new Date()) {
const d = new Date(date);
const day = d.getDay();
const diffToMonday = day === 0 ? -6 : 1 - day;
const monday = new Date(d);
monday.setDate(d.getDate() + diffToMonday);
monday.setHours(0, 0, 0, 0);
const sunday = new Date(monday);
sunday.setDate(monday.getDate() + 6);
sunday.setHours(23, 59, 59, 999);
return {
weekStart: monday.toISOString().slice(0, 10),
weekEnd: sunday.toISOString().slice(0, 10),
};
// ■ Nombre seguro para hojas de Excel
function cleanSheetName(name) {
return String(name || "Unknown")
.replace(/[\\/*?:[\]]/g, "")
.substring(0, 31);
}
}
// ■ Nombre del archivo Excel semanal
function payrollFileName(weekStart, weekEnd) {
return `Payroll_${weekStart}_to_${weekEnd}.xlsx`;
}
// ■ Leer título real de la unidad desde Notion, incluyendo paréntesis
function getRoomTitleFromPage(page) {
return page.properties?.["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
}
// ■ Evitar acciones duplicadas
function isDuplicateAction(action, unit, employee) {
const key = `${action}-${unit}-${employee}`.toUpperCase();
const now = Date.now();
const lastTime = recentActions.get(key);
if (lastTime && now - lastTime < 30000) {
return true;
}
recentActions.set(key, now);
setTimeout(() => {
recentActions.delete(key);
}, 30000);
return false;
}
// ■ Buscar unidades de hoy en Notion usando search
async function queryTodayRooms() {
let pages = [];
let cursor = undefined;
const today = todayISO();
do {
const body = {
page_size: 100,
query: "",
filter: {
property: "object",
value: "page",
},
};
if (cursor) body.start_cursor = cursor;
const response = await fetch("https://api.notion.com/v1/search", {
method: "POST",
headers: {
Authorization: `Bearer ${NOTION_API_KEY}`,
"Content-Type": "application/json",
"Notion-Version": "2022-06-28",
},
body: JSON.stringify(body),
});
const data = await response.json();
if (!response.ok) {
console.log("■ NOTION SEARCH ERROR:", data);
throw new Error(data.message || "Error buscando páginas en Notion");
}
const todayPages = (data.results || []).filter((page) => {
const pageDate = page.properties?.Date?.date?.start;
const roomTitle =
page.properties?.["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
return pageDate === today && roomTitle;
});
pages = pages.concat(todayPages);
cursor = data.has_more ? data.next_cursor : undefined;
} while (cursor);
return pages;
}
// ■ Status de Notion
function notionStatusFromAction(action) {
if (action === "START") return "In Progress";
if (action === "DONE") return "Cleaned - Awaiting Inspection";
if (action === "INSPECTION_START") return "Inspection Started";
if (action === "READY_GUEST") return "Ready for Guest";
return null;
}
async function notifyInspectors(unit) {
if (!process.env.WHAPI_TOKEN || !process.env.INSPECTORS_GROUP_ID) {
console.log("■■ WHAPI_TOKEN o INSPECTORS_GROUP_ID faltante");
return;
}
try {
const response = await fetch("https://gate.whapi.cloud/messages/text", {
method: "POST",
headers: {
Authorization: `Bearer ${process.env.WHAPI_TOKEN}`,
"Content-Type": "application/json",
},
body: JSON.stringify({
to: process.env.INSPECTORS_GROUP_ID,
body: `■ ${unit} lista para inspeccionar`,
}),
});
const data = await response.json();
console.log("■ Aviso enviado a inspectores:", data);
} catch (error) {
console.log("■ Error enviando a inspectores:", error.message);
}
}
// ■ Labels
function actionLabel(action) {
if (action === "START") return "■ Limpieza iniciada";
if (action === "DONE") return "■ Limpieza terminada";
if (action === "ISSUE") return "■■ Problema reportado";
if (action === "SUPPLIES") return "■ Supplies solicitados";
if (action === "INSPECTION_START") return "■ Inspección iniciada";
if (action === "READY_GUEST") return "■ Ready for Guest";
if (action === "INSPECTION_REPORT") return "■ Error de limpieza reportado";
if (action === "INSPECTION_SUPPLIES") return "■ Solicitud de inspector";
return "Actualización";
}
// ■ Analizar nota con OpenAI
async function analyzeNoteWithAI(action, note) {
const safeNote = String(note || "").trim();
if (!OPENAI_API_KEY || !safeNote) {
return {
category: "Other",
priority: "Normal",
summary: safeNote || "Sin nota",
};
}
try {
const response = await openai.chat.completions.create({
model: "gpt-4o-mini",
temperature: 0.2,
messages: [
{
role: "system",
content: "Clasifica reportes de housekeeping de hotel. Responde solo JSON válido.",
},
{
role: "user",
content: `
Acción: ${action}
Nota: ${safeNote}
Devuelve exactamente:
{
"category": "Cleaning | Maintenance | Supplies | Damage | Guest Item | Other",
"priority": "Low | Normal | High | Urgent",
"summary": "resumen corto en español"
}
`,
},
],
});
const text = response.choices[0].message.content;
const cleanText = text.replace(/```json|```/g, "").trim();
return JSON.parse(cleanText);
} catch (error) {
console.log("■■ OpenAI error:", error.message);
return {
category: "Other",
priority: "Normal",
summary: safeNote || "Sin nota",
};
}
}
// ■ Sacar limpiador asignado desde Notion
function getAssignedCleaner(page) {
return page.properties?.["Assigned Cleaner"]?.select?.name || "";
}
async function getDatabaseSchema(databaseId) {
const db = await notion.databases.retrieve({
database_id: databaseId,
});
return db.properties;
}
function findPropName(schema, possibleNames) {
return possibleNames.find((name) => schema[name]);
}
function buildTextProperty(schema, possibleNames, value) {
const name = findPropName(schema, possibleNames);
if (!name) return null;
const type = schema[name].type;
if (type === "title") {
return {
name,
value: {
title: [
{
text: {
content: String(value || ""),
},
},
],
},
};
}
if (type === "rich_text") {
return {
name,
value: {
rich_text: [
{
text: {
content: String(value || ""),
},
},
],
},
};
}
return null;
}
function buildDateProperty(schema, possibleNames, value) {
const name = findPropName(schema, possibleNames);
if (!name) return null;
return {
name,
value: {
date: {
start: value,
},
},
};
}
function buildSelectProperty(schema, possibleNames, value) {
const name = findPropName(schema, possibleNames);
if (!name) return null;
return {
name,
value: {
select: {
name: String(value || "Other"),
},
},
};
}
async function dailyLogAlreadyExists(action, unit, employee, inspector) {
const today = todayISO();
const person = employee || inspector || "";
const response = await notion.databases.query({
database_id: NOTION_LOG_DATABASE_ID,
filter: {
and: [
{
property: "Date",
date: {
equals: today,
},
},
{
property: "Unit",
rich_text: {
equals: unit,
},
},
{
property: "Action",
select: {
equals: action,
},
},
],
},
});
page_size: 10,
return response.results.some((page) => {
const cleaner =
page.properties.Cleaner?.rich_text?.map((t) => t.plain_text).join("") || "";
const inspectorName =
page.properties.Inspector?.rich_text?.map((t) => t.plain_text).join("") || "";
return cleaner === person || inspectorName === person;
});
}
async function saveDailyLog({
action,
unit,
employee,
inspector,
assignedCleaner,
note,
ai = null,
}) {
if (!NOTION_LOG_DATABASE_ID) {
console.log("■■ NOTION_LOG_DATABASE_ID faltante, no se guardó historial");
return;
}
const now = new Date().toISOString();
try {
const schema = await getDatabaseSchema(NOTION_LOG_DATABASE_ID);
const alreadyExists = await dailyLogAlreadyExists(
action,
unit,
employee,
inspector
);
if (alreadyExists) {
console.log("■■ Registro duplicado, no se guardó en Daily Cleaning Logs");
return;
}
const props = {};
const fields = [
buildTextProperty(schema, ["log", "Log"], `${unit} - ${action} - ${employee || inspector || ""}
buildDateProperty(schema, ["date", "Date"], todayISO()),
buildDateProperty(schema, ["time", "Time"], now),
buildTextProperty(schema, ["unit", "Unit"], unit),
buildTextProperty(schema, ["cleaner", "Cleaner"], employee || ""),
buildTextProperty(schema, ["inspector", "Inspector"], inspector || ""),
buildSelectProperty(schema, ["action", "Action"], action),
buildTextProperty(schema, ["note", "Note"], note || ""),
buildSelectProperty(schema, ["category", "Category"], ai?.category || "Other"),
buildSelectProperty(schema, ["priority", "Priority"], ai?.priority || "Normal"),
buildSelectProperty(schema, ["status", "Status"], notionStatusFromAction(action) || action),
buildTextProperty(schema, ["cleaner error", "Cleaner Error"], assignedCleaner || ""),
];
fields.forEach((field) => {
if (field) {
props[field.name] = field.value;
}
});
await notion.pages.create({
parent: {
database_id: NOTION_LOG_DATABASE_ID,
},
});
properties: props,
console.log("■ Daily Cleaning Log guardado");
} catch (error) {
console.log("■ ERROR guardando Daily Cleaning Log:", error.body || error.message);
}
}
// ■ Evitar duplicados en Payroll Records
async function payrollRecordAlreadyExists({ cleaner, unit, date }) {
if (!NOTION_PAYROLL_DATABASE_ID) return false;
const response = await notion.databases.query({
database_id: NOTION_PAYROLL_DATABASE_ID,
filter: {
and: [
{
},
{
},
{
},
],
},
property: "Date",
date: {
equals: date,
},
property: "Cleaner",
rich_text: {
equals: cleaner || "",
},
property: "Unit",
rich_text: {
equals: unit || "",
},
page_size: 10,
});
return response.results.length > 0;
}
// ■ Crear registro de nómina cuando se termina una unidad
async function createPayrollRecord({ cleaner, unit, date }) {
if (!NOTION_PAYROLL_DATABASE_ID) {
console.log("■■ NOTION_PAYROLL_DATABASE_ID faltante, no se guardó Payroll Record");
return;
}
if (!cleaner || !unit) {
console.log("■■ Payroll incompleto, falta cleaner o unit:", { cleaner, unit });
return;
}
const pay = getUnitPay(unit);
if (pay.error) {
console.log("■■ Payroll error:", pay.error, unit);
return;
}
const exists = await payrollRecordAlreadyExists({ cleaner, unit, date });
if (exists) {
return;
console.log("■■ Payroll duplicado ignorado:", cleaner, unit, date);
}
const week = getPayrollWeek(new Date(`${date}T12:00:00`));
await notion.pages.create({
parent: {
database_id: NOTION_PAYROLL_DATABASE_ID,
},
properties: {
Payroll: {
title: [
{
text: {
content: `${cleaner} - ${unit} - $${pay.amount}`,
},
},
],
},
Date: {
date: {
start: date,
},
},
Cleaner: {
rich_text: [
{
text: {
content: cleaner,
},
},
],
},
Unit: {
rich_text: [
{
text: {
content: unit,
},
},
],
},
"Room Type": {
select: {
name: pay.roomType,
},
},
Amount: {
number: pay.amount,
},
"Week Start": {
date: {
start: week.weekStart,
},
},
"Week End": {
date: {
start: week.weekEnd,
},
},
Status: {
select: {
name: "Pending",
},
},
},
});
console.log("■ Payroll Record guardado:", cleaner, unit, `$${pay.amount}`);
await generateWeeklyPayrollExcel(week.weekStart, week.weekEnd);
}
// ■ Leer Payroll Records desde Notion
async function getPayrollRecords(weekStart, weekEnd) {
if (!NOTION_PAYROLL_DATABASE_ID) {
throw new Error("Falta NOTION_PAYROLL_DATABASE_ID");
}
let results = [];
let cursor = undefined;
do {
const body = {
database_id: NOTION_PAYROLL_DATABASE_ID,
page_size: 100,
filter: {
and: [
{
property: "Date",
date: {
on_or_after: weekStart,
},
},
{
property: "Date",
date: {
on_or_before: weekEnd,
},
},
],
},
sorts: [
{
property: "Date",
direction: "ascending",
},
],
};
if (cursor) body.start_cursor = cursor;
const response = await notion.databases.query(body);
results = results.concat(response.results);
cursor = response.has_more ? response.next_cursor : undefined;
} while (cursor);
return results.map((page) => {
const p = page.properties;
return {
date: p.Date?.date?.start || "",
cleaner: p.Cleaner?.rich_text?.map((t) => t.plain_text).join("") || "",
unit: p.Unit?.rich_text?.map((t) => t.plain_text).join("") || "",
roomType: p["Room Type"]?.select?.name || "",
amount: p.Amount?.number || 0,
};
});
}
// ■ Generar / actualizar Excel semanal con hoja por limpiador
async function generateWeeklyPayrollExcel(weekStart, weekEnd) {
const records = await getPayrollRecords(weekStart, weekEnd);
const workbook = new ExcelJS.Workbook();
workbook.creator = process.env.COMPANY_NAME || "Housekeeping Payroll System";
workbook.created = new Date();
const summarySheet = workbook.addWorksheet("Payroll Summary");
const quickbooksSheet = workbook.addWorksheet("QuickBooks Upload");
const dailySheet = workbook.addWorksheet("Daily Payroll");
dailySheet.columns = [
{ header: "Date", key: "date", width: 15 },
{ header: "Cleaner", key: "cleaner", width: 22 },
{ header: "Unit", key: "unit", width: 22 },
{ header: "Room Type", key: "roomType", width: 15 },
{ header: "Amount", key: "amount", width: 15 },
];
records.forEach((r) => {
dailySheet.addRow({
date: r.date,
cleaner: r.cleaner,
unit: r.unit,
roomType: r.roomType,
amount: Number(r.amount || 0),
});
});
const totals = {};
records.forEach((r) => {
const cleaner = r.cleaner || "Unknown";
if (!totals[cleaner]) {
totals[cleaner] = {
cleaner,
totalUnits: 0,
totalAmount: 0,
records: [],
};
}
totals[cleaner].totalUnits += 1;
totals[cleaner].totalAmount += Number(r.amount || 0);
totals[cleaner].records.push(r);
});
summarySheet.columns = [
{ header: "Cleaner", key: "cleaner", width: 22 },
{ header: "Total Units", key: "totalUnits", width: 15 },
{ header: "Weekly Total", key: "totalAmount", width: 15 },
];
quickbooksSheet.columns = [
{ header: "Employee", key: "cleaner", width: 22 },
{ header: "Pay Period", key: "payPeriod", width: 25 },
{ header: "Amount", key: "amount", width: 15 },
];
Object.values(totals)
.sort((a, b) => a.cleaner.localeCompare(b.cleaner))
.forEach((t) => {
summarySheet.addRow({
cleaner: t.cleaner,
totalUnits: t.totalUnits,
totalAmount: t.totalAmount,
});
quickbooksSheet.addRow({
cleaner: t.cleaner,
payPeriod: `${weekStart} to ${weekEnd}`,
amount: t.totalAmount,
});
const cleanerSheet = workbook.addWorksheet(cleanSheetName(t.cleaner));
cleanerSheet.columns = [
{ header: "Date", key: "date", width: 15 },
{ header: "Unit", key: "unit", width: 22 },
{ header: "Room Type", key: "roomType", width: 15 },
{ header: "Amount", key: "amount", width: 15 },
];
t.records.forEach((r) => {
cleanerSheet.addRow({
date: r.date,
unit: r.unit,
roomType: r.roomType,
amount: Number(r.amount || 0),
});
});
cleanerSheet.addRow({});
cleanerSheet.addRow({
date: "TOTAL",
amount: t.totalAmount,
});
});
[summarySheet, quickbooksSheet, dailySheet, ...workbook.worksheets.slice(3)].forEach((sheet) => {
const header = sheet.getRow(1);
header.font = { bold: true };
sheet.eachRow((row) => {
row.eachCell((cell) => {
cell.alignment = { vertical: "middle" };
});
});
});
const filePath = path.join(payrollDir, payrollFileName(weekStart, weekEnd));
await workbook.xlsx.writeFile(filePath);
console.log("■ Excel de nómina actualizado:", filePath);
return {
fileName: payrollFileName(weekStart, weekEnd),
filePath,
fileUrl: `/payroll_exports/${payrollFileName(weekStart, weekEnd)}`,
totalRecords: records.length,
};
}
// ■ Actualizar habitación principal
async function updateNotionRoom(unit, action, employee, note, mode = "cleaner") {
if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
throw new Error("Faltan variables de Notion. Revisa NOTION_API_KEY y NOTION_DATABASE_ID");
}
const allowedActions = [
"START",
"DONE",
"ISSUE",
"SUPPLIES",
"INSPECTION_START",
"READY_GUEST",
"INSPECTION_REPORT",
"INSPECTION_SUPPLIES",
if (!allowedActions.includes(action)) {
throw new Error("Acción no permitida");
];
}
const pages = await queryTodayRooms();
const normalizedTarget = normalizeRoom(unit);
const targetDigits = roomDigits(unit);
let matches = pages.filter((page) => {
const title =
page.properties["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
return normalizeRoom(title) === normalizedTarget;
});
if (matches.length === 0) {
matches = pages.filter((page) => {
const title =
page.properties["Room Number"]?.title?.map((t) => t.plain_text).join("") || "";
return roomDigits(title) === targetDigits;
});
if (matches.length === 0) {
throw new Error(`No encontré la unidad ${unit} en Notion para hoy`);
}
}
const now = new Date().toISOString();
const label = actionLabel(action);
const status = notionStatusFromAction(action);
const needsAI = [
"ISSUE",
"SUPPLIES",
"INSPECTION_REPORT",
"INSPECTION_SUPPLIES",
].includes(action);
let ai = null;
if (needsAI) {
ai = await analyzeNoteWithAI(action, note);
}
for (const page of matches) {
const assignedCleaner = getAssignedCleaner(page);
const historyLine =
`${localTime()} - ${employee} - ${label}` +
`${assignedCleaner && mode === "inspector" ? ` - Cleaner: ${assignedCleaner}` : ""}` +
`${note ? ` - ${note}` : ""}` +
`${ai ? ` | ${ai.category} | ${ai.priority} | ${ai.summary}` : ""}`;
const oldLastMessage =
page.properties["Last Message"]?.rich_text?.map((t) => t.plain_text).join("") || "";
const newLastMessage =
oldLastMessage
? `${oldLastMessage}\n${historyLine}`
: historyLine;
const props = {
"Last Whatsapp Update ": {
date: {
start: now,
},
},
"Last Message": {
rich_text: [
{
text: {
content: newLastMessage.slice(-1900),
},
},
],
},
"Last Update By": {
rich_text: [
{
text: {
content: employee,
},
},
],
},
};
if (status) {
props["Cleaning Status"] = {
status: {
name: status,
},
};
}
if (action === "START") {
props["Started At"] = {
date: {
start: now,
},
};
}
if (action === "DONE") {
props["Finished At"] = {
date: {
start: now,
},
};
}
if (needsAI) {
props["Issues Notes"] = {
rich_text: [
{
text: {
content: ai ? ai.summary : note || label,
},
},
],
};
props["Issue Category"] = {
select: {
name: ai ? ai.category : "Other",
},
};
props["Priority"] = {
select: {
name: ai ? ai.priority : "Normal",
},
};
}
await notion.pages.update({
page_id: page.id,
properties: props,
});
await saveDailyLog({
action,
unit,
employee: mode === "cleaner" ? employee : assignedCleaner,
inspector: mode === "inspector" ? employee : "",
assignedCleaner: mode === "inspector" ? assignedCleaner : "",
note,
ai,
});
// ■ Nómina automática:
// Solo se paga cuando el cleaner marca DONE.
// Usa el título real de Notion para leer el tipo entre paréntesis: 331A (2), 405 (S), etc.
if (mode === "cleaner" && action === "DONE") {
const fullUnitTitle = getRoomTitleFromPage(page) || unit;
await createPayrollRecord({
cleaner: employee,
unit: fullUnitTitle,
date: todayISO(),
});
}
}
return {
label,
ai,
};
}
// ■ Helpers para PDF
function getProp(page, names) {
for (const name of names) {
if (page.properties[name]) return page.properties[name];
}
return null;
}
function readText(page, names) {
const prop = getProp(page, names);
if (!prop) return "";
if (prop.title) return prop.title.map((t) => t.plain_text).join("");
if (prop.rich_text) return prop.rich_text.map((t) => t.plain_text).join("");
if (prop.select) return prop.select.name || "";
if (prop.status) return prop.status.name || "";
if (prop.date) return prop.date.start || "";
if (prop.number !== null && prop.number !== undefined) return String(prop.number);
if (prop.checkbox !== undefined) return prop.checkbox ? "Yes" : "No";
return "";
}
function formatReportTime(value) {
if (!value) return "N/A";
return new Date(value).toLocaleString("en-US", {
timeZone: "America/Chicago",
hour: "2-digit",
minute: "2-digit",
hour12: true,
});
}
async function getDailyLogsForReport(date) {
if (!NOTION_LOG_DATABASE_ID) {
throw new Error("Falta NOTION_LOG_DATABASE_ID o NOTION_DAILY_CLEANING_LOGS_DB_ID");
}
const response = await notion.databases.query({
database_id: NOTION_LOG_DATABASE_ID,
filter: {
property: "Date",
date: {
equals: date,
},
},
sorts: [
{
property: "Time",
direction: "ascending",
},
],
});
return response.results;
}
async function generateDailyReport(date = todayISO()) {
const logs = await getDailyLogsForReport(date);
const fileName = `daily-housekeeping-report-${date}.pdf`;
const filePath = path.join(reportsDir, fileName);
const doc = new PDFDocument({ margin: 50 });
doc.pipe(fs.createWriteStream(filePath));
const units = new Set();
const cleaners = new Set();
const inspectors = new Set();
const productivity = {};
const issuesByUnit = {};
const errorsByCleaner = {};
let issues = 0;
let cleanerErrors = 0;
let highPriority = 0;
let completed = 0;
logs.forEach((log) => {
const unit = readText(log, ["Unit", "unit"]);
const cleaner = readText(log, ["Cleaner", "cleaner"]);
const inspector = readText(log, ["Inspector", "inspector"]);
const action = readText(log, ["Action", "action"]);
const category = readText(log, ["Category", "category"]);
const priority = readText(log, ["Priority", "priority"]);
const status = readText(log, ["Status", "status"]);
const cleanerError = readText(log, ["Cleaner Error", "cleaner error"]);
if (unit) units.add(unit);
if (cleaner) cleaners.add(cleaner);
if (inspector) inspectors.add(inspector);
const actionLower = action.toLowerCase();
const categoryLower = category.toLowerCase();
const priorityLower = priority.toLowerCase();
const statusLower = status.toLowerCase();
const cleanerErrorLower = cleanerError.toLowerCase();
if (
(
cleaner &&
actionLower.includes("done") ||
actionLower.includes("finished") ||
actionLower.includes("completed") ||
actionLower.includes("terminada") ||
actionLower.includes("terminado") ||
actionLower.includes("lista") ||
actionLower.includes("ready")
)
) {
productivity[cleaner] = (productivity[cleaner] || 0) + 1;
}
if (
actionLower.includes("issue") ||
actionLower.includes("problem") ||
actionLower.includes("problema") ||
actionLower.includes("report") ||
categoryLower.includes("issue") ||
categoryLower.includes("problem") ||
categoryLower.includes("problema")
) {
issues++;
if (unit) issuesByUnit[unit] = (issuesByUnit[unit] || 0) + 1;
}
if (
cleanerErrorLower &&
cleanerErrorLower !== "no" &&
cleanerErrorLower !== "none" &&
cleanerErrorLower !== "n/a"
) {
cleanerErrors++;
const cleanerName = cleaner || cleanerError || "Unknown";
errorsByCleaner[cleanerName] = (errorsByCleaner[cleanerName] || 0) + 1;
}
if (
priorityLower.includes("high") ||
priorityLower.includes("urgent") ||
priorityLower.includes("alta") ||
priorityLower.includes("urgente")
) {
highPriority++;
}
if (
statusLower.includes("complete") ||
statusLower.includes("completed") ||
statusLower.includes("ready") ||
statusLower.includes("lista") ||
actionLower.includes("ready_guest")
) {
completed++;
}
});
doc.fontSize(20).text("DAILY REPORT", {
align: "center",
});
doc.moveDown();
doc.fontSize(12).text(`Date: ${date}`);
doc.text(`Company: ${process.env.COMPANY_NAME || "417 Maid Cleaning Services "}`);
doc.moveDown();
doc.fontSize(16).text("1. Executive Summary");
doc.moveDown(0.5);
doc.fontSize(12).text(`Total Records: ${logs.length}`);
doc.text(`Total Units Registered: ${units.size}`);
doc.text(`Completed / Ready Records: ${completed}`);
doc.text(`Issues Reported: ${issues}`);
doc.text(`High Priority Records: ${highPriority}`);
doc.text(`Cleaner Errors: ${cleanerErrors}`);
doc.text(`Active Cleaners: ${cleaners.size}`);
doc.text(`Active Inspectors: ${inspectors.size}`);
doc.moveDown();
doc.fontSize(16).text("2. Productivity by Cleaner");
doc.moveDown(0.5);
if (Object.keys(productivity).length === 0) {
doc.fontSize(12).text("No completed cleaning records found.");
} else {
Object.entries(productivity).forEach(([cleaner, count]) => {
doc.fontSize(12).text(`${cleaner}: ${count} completed unit(s)`);
});
}
doc.moveDown();
doc.fontSize(16).text("3. Issues & Cleaner Errors");
doc.moveDown(0.5);
doc.fontSize(12).text("Issues by Unit:");
if (Object.keys(issuesByUnit).length === 0) {
doc.text("No issues reported.");
} else {
Object.entries(issuesByUnit).forEach(([unit, count]) => {
doc.text(`Unit ${unit}: ${count} issue(s)`);
});
}
doc.moveDown(0.5);
doc.text("Cleaner Errors:");
if (Object.keys(errorsByCleaner).length === 0) {
doc.text("No cleaner errors reported.");
} else {
Object.entries(errorsByCleaner).forEach(([cleaner, count]) => {
doc.text(`${cleaner}: ${count} error(s)`);
});
}
// ■ Agrupar actividad por limpiador e inspector
const cleanersActivity = {};
const inspectorsActivity = {};
logs.forEach((log) => {
const time = readText(log, ["Time", "time"]);
const unit = readText(log, ["Unit", "unit"]);
const cleaner = readText(log, ["Cleaner", "cleaner"]);
const inspector = readText(log, ["Inspector", "inspector"]);
const action = readText(log, ["Action", "action"]);
const note = readText(log, ["Note", "note"]);
const category = readText(log, ["Category", "category"]);
const priority = readText(log, ["Priority", "priority"]);
const actionLower = action.toLowerCase();
if (cleaner) {
if (!cleanersActivity[cleaner]) {
cleanersActivity[cleaner] = {};
}
if (!cleanersActivity[cleaner][unit]) {
cleanersActivity[cleaner][unit] = {
start: "",
finish: "",
requests: [],
issues: [],
};
}
if (
) {
actionLower.includes("start")
cleanersActivity[cleaner][unit].start = formatReportTime(time);
}
if (
actionLower.includes("done") ||
actionLower.includes("finish") ||
actionLower.includes("terminada") ||
actionLower.includes("terminado")
) {
cleanersActivity[cleaner][unit].finish = formatReportTime(time);
}
if (
) {
actionLower.includes("supplies") ||
category.toLowerCase().includes("supplies")
cleanersActivity[cleaner][unit].requests.push(
`${formatReportTime(time)} - ${note || "Supply request"}${priority ? ` (${priority})` : ""}`
);
}
if (
actionLower.includes("issue") ||
actionLower.includes("problem") ||
category.toLowerCase().includes("maintenance") ||
category.toLowerCase().includes("damage")
) {
cleanersActivity[cleaner][unit].issues.push(
`${formatReportTime(time)} - ${note || "Issue reported"}${priority ? ` (${priority})` : ""}`
);
}
}
if (inspector) {
if (!inspectorsActivity[inspector]) {
inspectorsActivity[inspector] = {};
}
if (!inspectorsActivity[inspector][unit]) {
inspectorsActivity[inspector][unit] = {
inspectionStart: "",
ready: "",
requests: [],
issues: [],
};
}
if (
actionLower.includes("inspection_start")
) {
inspectorsActivity[inspector][unit].inspectionStart = formatReportTime(time);
}
if (
) {
actionLower.includes("ready_guest") ||
actionLower.includes("ready")
inspectorsActivity[inspector][unit].ready = formatReportTime(time);
}
if (
actionLower.includes("inspection_supplies") ||
actionLower.includes("supplies") ||
category.toLowerCase().includes("supplies")
) {
inspectorsActivity[inspector][unit].requests.push(
`${formatReportTime(time)} - ${note || "Supply request"}${priority ? ` (${priority})` : ""}`
);
}
if (
actionLower.includes("inspection_report") ||
actionLower.includes("issue") ||
actionLower.includes("problem") ||
category.toLowerCase().includes("maintenance") ||
category.toLowerCase().includes("damage")
) {
inspectorsActivity[inspector][unit].issues.push(
`${formatReportTime(time)} - ${note || "Issue reported"}${priority ? ` (${priority})` : ""}`
);
}
}
});
// ■ Sección por limpiador
doc.addPage();
doc.fontSize(13).text("Cleaners Activity", {
align: "center",
});
doc.moveDown();
Object.entries(cleanersActivity)
.sort(([a], [b]) => a.localeCompare(b))
.forEach(([cleaner, units]) => {
doc.fontSize(11).text(cleaner);
doc.moveDown(0.3);
Object.entries(units)
.sort(([a], [b]) => a.localeCompare(b))
.forEach(([unit, data]) => {
doc.fontSize(9).text(`Unit ${unit || "N/A"}`);
if (data.start) doc.text(`Start: ${data.start}`);
if (data.finish) doc.text(`Finished: ${data.finish}`);
if (data.requests.length > 0) {
doc.text("Requests:");
data.requests.forEach((item) => {
doc.text(`- ${item}`);
});
}
if (data.issues.length > 0) {
doc.text("Issues:");
data.issues.forEach((item) => {
doc.text(`- ${item}`);
});
}
doc.moveDown(0.3);
doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke();
doc.moveDown(0.4);
});
doc.moveDown(0.5);
});
// ■ Sección por inspector
doc.addPage();
doc.fontSize(13).text("Inspectors Activity", {
align: "center",
});
doc.moveDown();
Object.entries(inspectorsActivity)
.sort(([a], [b]) => a.localeCompare(b))
.forEach(([inspector, units]) => {
doc.fontSize(11).text(inspector);
doc.moveDown(0.3);
Object.entries(units)
.sort(([a], [b]) => a.localeCompare(b))
.forEach(([unit, data]) => {
doc.fontSize(9).text(`Unit ${unit || "N/A"}`);
if (data.inspectionStart) doc.text(`Inspection Started: ${data.inspectionStart}`);
if (data.ready) doc.text(`Ready for Guest: ${data.ready}`);
if (data.requests.length > 0) {
doc.text("Requests:");
data.requests.forEach((item) => {
doc.text(`- ${item}`);
});
}
if (data.issues.length > 0) {
doc.text("Issues:");
data.issues.forEach((item) => {
doc.text(`- ${item}`);
});
}
});
doc.moveDown(0.5);
doc.moveDown(0.3);
doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke();
doc.moveDown(0.4);
});
doc.addPage();
doc.fontSize(18).text("Activity Ledger", {
align: "center",
});
doc.moveDown();
logs.forEach((log, index) => {
const logTitle = readText(log, ["Log", "log"]);
const time = readText(log, ["Time", "time"]);
const unit = readText(log, ["Unit", "unit"]);
const cleaner = readText(log, ["Cleaner", "cleaner"]);
const action = readText(log, ["Action", "action"]);
const note = readText(log, ["Note", "note"]);
const inspector = readText(log, ["Inspector", "inspector"]);
const category = readText(log, ["Category", "category"]);
const priority = readText(log, ["Priority", "priority"]);
const status = readText(log, ["Status", "status"]);
const cleanerError = readText(log, ["Cleaner Error", "cleaner error"]);
doc.fontSize(11).text(
`${index + 1}. ${formatReportTime(time)} | Unit: ${unit || "N/A"} | Action: ${action || "N/A"}`
);
if (logTitle) doc.text(` Log: ${logTitle}`);
if (cleaner) doc.text(` Cleaner: ${cleaner}`);
if (inspector) doc.text(` Inspector: ${inspector}`);
if (category) doc.text(` Category: ${category}`);
if (priority) doc.text(` Priority: ${priority}`);
if (status) doc.text(` Status: ${status}`);
if (cleanerError) doc.text(` if (note) doc.text(` Note: ${note}`);
Cleaner Error: ${cleanerError}`);
doc.moveDown(0.6);
});
doc.end();
return {
fileName,
fileUrl: `/reports/${fileName}`,
totalRecords: logs.length,
};
}
// ■ Ruta limpiadores
app.post("/action", async (req, res) => {
try {
const { action, unit, note, name } = req.body;
if (!action || !unit || !name) {
return res.status(400).json({
success: false,
message: "■ Faltan datos: nombre, unidad o acción",
});
}
if (isDuplicateAction(action, unit, name)) {
return res.status(400).json({
success: false,
message: "■■ Acción ya registrada recientemente",
});
}
if ((action === "ISSUE" || action === "SUPPLIES") && !String(note || "").trim()) {
return res.status(400).json({
success: false,
message: "■ Debes escribir una nota",
});
}
const result = await updateNotionRoom(unit, action, name, note, "cleaner");
if (action === "DONE") {
await notifyInspectors(unit);
}
res.json({
success: true,
message: `■ Enviado correctamente: ${result.label} - ${unit}`,
});
} catch (error) {
console.error("■ Error en /action:", error.message);
res.status(500).json({
success: false,
message: `■ Error: ${error.message}`,
});
}
});
// ■ Ruta inspectores
app.post("/inspector-action", async (req, res) => {
try {
const { action, unit, note, name } = req.body;
if (!action || !unit || !name) {
return res.status(400).json({
success: false,
message: "■ Faltan datos: inspector, unidad o acción",
});
}
if (isDuplicateAction(action, unit, name)) {
return res.status(400).json({
success: false,
message: "■■ Acción ya registrada recientemente",
});
}
if (
(action === "INSPECTION_REPORT" || action === "INSPECTION_SUPPLIES") &&
!String(note || "").trim()
) {
return res.status(400).json({
success: false,
message: "■ Debes escribir una nota",
});
}
const result = await updateNotionRoom(unit, action, name, note, "inspector");
res.json({
success: true,
message: `■ Inspector: ${result.label} - ${unit}`,
});
} catch (error) {
console.error("■ Error inspector:", error.message);
res.status(500).json({
success: false,
message: `■ Error: ${error.message}`,
});
}
});
// ■ Eventos para Centro de Operaciones
app.get("/operations-events", async (req, res) => {
try {
if (!NOTION_LOG_DATABASE_ID) {
return res.json({
count: 0,
events: [],
});
}
const response = await notion.databases.query({
database_id: NOTION_LOG_DATABASE_ID,
page_size: 20,
sorts: [
{
property: "Time",
direction: "descending",
},
],
});
const events = response.results.map((page) => {
const props = page.properties;
return {
id: page.id,
time:
props.Time?.date?.start
? new Date(props.Time.date.start).toLocaleString("en-US", {
timeZone: "America/Chicago",
hour: "2-digit",
minute: "2-digit",
hour12: true,
})
: "",
unit:
props.Unit?.rich_text
?.map((t) => t.plain_text)
.join("") || "",
action:
props.Action?.select?.name || "",
person:
props.Cleaner?.rich_text
?.map((t) => t.plain_text)
.join("") ||
props.Inspector?.rich_text
?.map((t) => t.plain_text)
.join("") ||
"",
note:
props.Note?.rich_text
?.map((t) => t.plain_text)
.join("") || "",
};
});
res.json({
count: events.length,
events,
});
} catch (error) {
console.error("■ Error en /operations-events:", error.message);
res.status(500).json({
count: 0,
events: [],
error: error.message,
});
}
});
// ■ Generar Daily Report PDF
app.post("/generate-daily-report", async (req, res) => {
try {
const date = req.body.date || todayISO();
const report = await generateDailyReport(date);
res.json({
ok: true,
message: "Daily report generated successfully",
date,
totalRecords: report.totalRecords,
file: report.fileName,
url: report.fileUrl,
fullUrl: `${req.protocol}://${req.get("host")}${report.fileUrl}`,
});
} catch (error) {
console.error("■ Error generating daily report:", error.message);
res.status(500).json({
ok: false,
error: error.message,
});
}
});
// ■ Abrir reporte desde navegador
app.get("/generate-daily-report", async (req, res) => {
try {
const date = req.query.date || todayISO();
const report = await generateDailyReport(date);
res.redirect(report.fileUrl);
} catch (error) {
console.error("■ Error generating daily report:", error.message);
res.status(500).send(`Error generating report: ${error.message}`);
}
// ■ Descargar reporte al finalizar el día
app.get("/finalizar-dia", async (req, res) => {
try {
const date = req.query.date || todayISO();
const report = await generateDailyReport(date);
const filePath = path.join(reportsDir, report.fileName);
res.download(filePath, report.fileName);
} catch (error) {
console.error("■ Error finalizando día:", error.message);
res.status(500).send(`Error finalizando día: ${error.message}`);
}
});
});
app.get("/finalizar-dia", async (req, res) => {
try {
const date = req.query.date || todayISO();
const report = await generateDailyReport(date);
const filePath = path.join(reportsDir, report.fileName);
setTimeout(() => {
res.download(filePath, report.fileName);
}, 1500);
} catch (error) {
console.error("■ Error finalizando día:", error.message);
res.status(500).send(`Error finalizando día: ${error.message}`);
}
});
// ■ Generar / actualizar Excel de nómina semanal
app.post("/generate-payroll-excel", async (req, res) => {
try {
const selectedDate = req.body.date || todayISO();
const week = getPayrollWeek(new Date(`${selectedDate}T12:00:00`));
const payroll = await generateWeeklyPayrollExcel(week.weekStart, week.weekEnd);
res.json({
ok: true,
message: "Payroll Excel updated successfully",
weekStart: week.weekStart,
weekEnd: week.weekEnd,
totalRecords: payroll.totalRecords,
file: payroll.fileName,
url: payroll.fileUrl,
fullUrl: `${req.protocol}://${req.get("host")}${payroll.fileUrl}`,
});
} catch (error) {
console.error("■ Error generating payroll Excel:", error.message);
res.status(500).json({
ok: false,
error: error.message,
});
}
});
// ■ Descargar Excel de nómina de la semana actual o de una fecha específica
app.get("/payroll-excel", async (req, res) => {
try {
const selectedDate = req.query.date || todayISO();
const week = getPayrollWeek(new Date(`${selectedDate}T12:00:00`));
const payroll = await generateWeeklyPayrollExcel(week.weekStart, week.weekEnd);
res.download(payroll.filePath, payroll.fileName);
} catch (error) {
console.error("■ Error descargando Payroll Excel:", error.message);
res.status(500).send(`Error descargando Payroll Excel: ${error.message}`);
}
});
// ❤■ Health check para Render
app.get("/health", (req, res) => {
res.send("OK");
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`■ Panel web activo en puerto ${PORT}`);
});
