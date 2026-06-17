const { Client } = require("@notionhq/client");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const dayjs = require("dayjs");

const notion = new Client({
  auth: process.env.NOTION_TOKEN
});

function getText(page, propertyName) {
  const prop = page.properties[propertyName];

  if (!prop) return "";

  if (prop.title) return prop.title[0]?.plain_text || "";
  if (prop.rich_text) return prop.rich_text[0]?.plain_text || "";
  if (prop.select) return prop.select.name || "";
  if (prop.date) return prop.date.start || "";
  if (prop.number !== null && prop.number !== undefined) return String(prop.number);
  if (prop.checkbox !== undefined) return prop.checkbox ? "Yes" : "No";

  return "";
}

function formatTime(value) {
  if (!value) return "N/A";
  return dayjs(value).format("hh:mm A");
}

async function getDailyLogs(date) {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DAILY_CLEANING_LOGS_DB_ID,
    filter: {
      property: "date",
      date: {
        equals: date
      }
    },
    sorts: [
      {
        property: "time",
        direction: "ascending"
      }
    ]
  });

  return response.results;
}

async function generateDailyReport(date = dayjs().format("YYYY-MM-DD")) {
  const logs = await getDailyLogs(date);

  const fileName = `daily-housekeeping-report-${date}.pdf`;
  const doc = new PDFDocument({ margin: 50 });

  doc.pipe(fs.createWriteStream(fileName));

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
    const unit = getText(log, "unit");
    const cleaner = getText(log, "cleaner");
    const inspector = getText(log, "inspector");
    const action = getText(log, "action");
    const category = getText(log, "category");
    const priority = getText(log, "priority");
    const status = getText(log, "status");
    const cleanerError = getText(log, "cleaner error");

    if (unit) units.add(unit);
    if (cleaner) cleaners.add(cleaner);
    if (inspector) inspectors.add(inspector);

    const actionLower = action.toLowerCase();
    const categoryLower = category.toLowerCase();
    const priorityLower = priority.toLowerCase();
    const statusLower = status.toLowerCase();
    const cleanerErrorLower = cleanerError.toLowerCase();

    if (
      cleaner &&
      (
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
      categoryLower.includes("issue") ||
      categoryLower.includes("problem") ||
      categoryLower.includes("problema")
    ) {
      issues++;
      if (unit) issuesByUnit[unit] = (issuesByUnit[unit] || 0) + 1;
    }

    if (
      cleanerErrorLower.includes("yes") ||
      cleanerErrorLower.includes("true") ||
      cleanerErrorLower.includes("si") ||
      cleanerErrorLower.includes("sí")
    ) {
      cleanerErrors++;
      if (cleaner) errorsByCleaner[cleaner] = (errorsByCleaner[cleaner] || 0) + 1;
    }

    if (
      priorityLower.includes("high") ||
      priorityLower.includes("alta")
    ) {
      highPriority++;
    }

    if (
      statusLower.includes("complete") ||
      statusLower.includes("completed") ||
      statusLower.includes("ready") ||
      statusLower.includes("lista")
    ) {
      completed++;
    }
  });

  doc.fontSize(16).text("DAILY REPORT", {
  align: "center",
});

doc.moveDown(0.5);
doc.fontSize(9).text(`Date: ${date}`);
doc.text(`Company: ${process.env.COMPANY_NAME || "417 Maid Cleaning Services "}`);

doc.moveDown();

doc.fontSize(12).text("1. Executive Summary");
doc.moveDown(0.4);
doc.fontSize(9).text(`Total Records: ${logs.length}`);
doc.text(`Total Units Registered: ${units.size}`);
doc.text(`Completed / Ready Records: ${completed}`);
doc.text(`Issues Reported: ${issues}`);
doc.text(`High Priority Records: ${highPriority}`);
doc.text(`Active Cleaners: ${cleaners.size}`);
doc.text(`Active Inspectors: ${inspectors.size}`);

if (cleanerErrors > 0) {
  doc.text(`Cleaner Errors: ${cleanerErrors}`);
}

doc.moveDown();

doc.fontSize(12).text("2. Productivity by Cleaner");
doc.moveDown(0.4);

if (Object.keys(productivity).length === 0) {
  doc.fontSize(9).text("No completed cleaning records found.");
} else {
  Object.entries(productivity)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cleaner, count], index) => {
      doc.fontSize(9).text(`${index + 1}. ${cleaner}: ${count} completed unit(s)`);
    });
}

doc.moveDown();

doc.fontSize(12).text("3. Issues Summary");
doc.moveDown(0.4);

doc.fontSize(9).text("Issues by Unit:");

if (Object.keys(issuesByUnit).length === 0) {
  doc.text("No issues reported.");
} else {
  Object.entries(issuesByUnit)
    .sort((a, b) => b[1] - a[1])
    .forEach(([unit, count]) => {
      doc.text(`Unit ${unit}: ${count} issue(s)`);
    });
}

if (Object.keys(errorsByCleaner).length > 0) {
  doc.moveDown(0.5);
  doc.fontSize(12).text("4. Cleaner Errors");
  doc.moveDown(0.4);

  Object.entries(errorsByCleaner)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cleaner, count]) => {
      doc.fontSize(9).text(`${cleaner}: ${count} error(s)`);
    });
}

  doc.addPage();

  doc.fontSize(13).text("4. Activity Ledger", {
    align: "center"
  });

  doc.moveDown();

  logs.forEach((log, index) => {
    const logTitle = getText(log, "log");
    const time = getText(log, "time");
    const unit = getText(log, "unit");
    const cleaner = getText(log, "cleaner");
    const action = getText(log, "action");
    const note = getText(log, "note");
    const inspector = getText(log, "inspector");
    const category = getText(log, "category");
    const priority = getText(log, "priority");
    const status = getText(log, "status");
    const cleanerError = getText(log, "cleaner error");

    doc.fontSize(8.5).text(
  `${index + 1}. ${formatReportTime(time)} | Unit: ${unit || "N/A"} | ${action || "N/A"}`
);

if (cleaner) doc.text(`Cleaner: ${cleaner}`);
if (inspector) doc.text(`Inspector: ${inspector}`);
if (category) doc.text(`Category: ${category}`);
if (priority) doc.text(`Priority: ${priority}`);
if (status) doc.text(`Status: ${status}`);

if (
  cleanerError &&
  cleanerError.trim() &&
  !["no", "none", "n/a", "na"].includes(
    cleanerError.toLowerCase().trim()
  )
) {
  doc.text(`Cleaner Error: ${cleanerError}`);
}

if (note) {
  doc.text(`Note: ${note}`);
}

doc.moveDown(0.3);

doc.moveTo(50, doc.y)
   .lineTo(560, doc.y)
   .stroke();

doc.moveDown(0.4);
  });

  doc.end();

  return fileName;
}

module.exports = {
  generateDailyReport
};
