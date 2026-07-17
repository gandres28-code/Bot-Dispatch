const { query } = require("../db");

function normalizeEmployeeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|,]+/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

function readTextProperty(property) {
  if (!property) return "";
  if (property.title) return property.title.map((item) => item.plain_text || "").join("").trim();
  if (property.rich_text) return property.rich_text.map((item) => item.plain_text || "").join("").trim();
  if (property.select?.name) return String(property.select.name).trim();
  if (property.status?.name) return String(property.status.name).trim();
  if (property.multi_select) return property.multi_select.map((item) => item.name).join(" / ").trim();
  if (property.number !== undefined && property.number !== null) return String(property.number);
  return "";
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getPayrollWeek(dateValue) {
  const date = new Date(`${String(dateValue || "").slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { weekStart: "", weekEnd: "" };
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

function getPayrollRecordFromNotionPage(page) {
  const properties = page?.properties || {};
  const workDate = properties.Date?.date?.start?.slice(0, 10) || "";
  const employee =
    readTextProperty(properties.Cleaner) ||
    readTextProperty(properties.Employee) ||
    readTextProperty(properties.Name);
  const unit = readTextProperty(properties.Unit) || readTextProperty(properties.Room);
  const roomType = readTextProperty(properties["Room Type"]) || readTextProperty(properties.Type);
  const amount = roundMoney(properties.Amount?.number || 0);
  const grossUnitAmount = roundMoney(
    properties["Gross Unit Amount"]?.number ??
    properties["Unit Amount"]?.number ??
    amount
  );
  const splitCount = Math.max(1, Number(properties["Split Count"]?.number || 1));
  const splitPercent = Number(properties["Split Percent"]?.number || (splitCount > 1 ? 1 / splitCount : 1));
  const payType = readTextProperty(properties["Pay Type"]) || "unit";
  const roleWorked = readTextProperty(properties["Role Worked"]) || "Cleaner";
  const status = readTextProperty(properties.Status) || "Pending";
  const computedWeek = getPayrollWeek(workDate);
  const weekStart = properties["Week Start"]?.date?.start?.slice(0, 10) || computedWeek.weekStart;
  const weekEnd = properties["Week End"]?.date?.start?.slice(0, 10) || computedWeek.weekEnd;

  return {
    notionId: page?.id || "",
    workDate,
    employee,
    normalizedEmployee: normalizeEmployeeName(employee),
    unit,
    roomType,
    grossUnitAmount,
    splitCount,
    splitPercent,
    amount,
    payType,
    roleWorked,
    weekStart,
    weekEnd,
    status,
    rawData: page,
  };
}

async function upsertPayrollRecord(record) {
  if (!record.workDate || !record.employee || !record.normalizedEmployee) {
    return { saved: false, reason: "missing-date-or-employee", record };
  }

  const result = await query(
    `
      INSERT INTO payroll_records (
        notion_id, work_date, employee, normalized_employee, unit, room_type,
        gross_unit_amount, split_count, split_percent, amount, pay_type,
        role_worked, week_start, week_end, status, source, raw_data, updated_at
      )
      VALUES (
        NULLIF($1, ''), $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, 'notion', $16::jsonb, NOW()
      )
      ON CONFLICT (work_date, normalized_employee, unit, pay_type, role_worked)
      DO UPDATE SET
        notion_id = EXCLUDED.notion_id,
        employee = EXCLUDED.employee,
        room_type = EXCLUDED.room_type,
        gross_unit_amount = EXCLUDED.gross_unit_amount,
        split_count = EXCLUDED.split_count,
        split_percent = EXCLUDED.split_percent,
        amount = EXCLUDED.amount,
        week_start = EXCLUDED.week_start,
        week_end = EXCLUDED.week_end,
        status = EXCLUDED.status,
        source = 'notion',
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW()
      RETURNING *
    `,
    [
      record.notionId,
      record.workDate,
      record.employee,
      record.normalizedEmployee,
      record.unit,
      record.roomType,
      record.grossUnitAmount,
      record.splitCount,
      record.splitPercent,
      record.amount,
      record.payType,
      record.roleWorked,
      record.weekStart,
      record.weekEnd,
      record.status,
      JSON.stringify(record.rawData || {}),
    ]
  );

  return { saved: true, record: result.rows[0] };
}

async function syncPayrollFromNotion({ notion, databaseId, queryDatabase, weekStart, weekEnd }) {
  if (!databaseId) throw new Error("Falta NOTION_PAYROLL_DATABASE_ID");
  if (!weekStart || !weekEnd) throw new Error("weekStart y weekEnd son requeridos");

  const syncKey = `payroll-notion-postgres:${weekStart}:${weekEnd}`;
  const startedAt = new Date();

  await query(
    `
      INSERT INTO sync_status (
        sync_key, source, destination, status, last_started_at,
        records_processed, error_message, metadata, updated_at
      )
      VALUES ($1, 'notion', 'postgres', 'running', NOW(), 0, '', $2::jsonb, NOW())
      ON CONFLICT (sync_key)
      DO UPDATE SET
        status = 'running', last_started_at = NOW(), records_processed = 0,
        error_message = '', metadata = EXCLUDED.metadata, updated_at = NOW()
    `,
    [syncKey, JSON.stringify({ weekStart, weekEnd })]
  );

  try {
    let pages = [];
    let cursor;

    do {
      const body = {
        database_id: databaseId,
        page_size: 100,
        filter: {
          and: [
            { property: "Date", date: { on_or_after: weekStart } },
            { property: "Date", date: { on_or_before: weekEnd } },
          ],
        },
        sorts: [{ property: "Date", direction: "ascending" }],
      };
      if (cursor) body.start_cursor = cursor;
      const response = queryDatabase ? await queryDatabase(body) : await notion.databases.query(body);
      pages = pages.concat(response.results || []);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    let saved = 0;
    let skipped = 0;
    const warnings = [];

    for (const page of pages) {
      const record = getPayrollRecordFromNotionPage(page);
      const result = await upsertPayrollRecord(record);
      if (result.saved) saved += 1;
      else {
        skipped += 1;
        warnings.push({ notionId: page?.id || "", reason: result.reason });
      }
    }

    await query(
      `
        UPDATE sync_status
        SET status = 'success', last_completed_at = NOW(), last_success_at = NOW(),
            records_processed = $2, error_message = '', metadata = $3::jsonb, updated_at = NOW()
        WHERE sync_key = $1
      `,
      [syncKey, saved, JSON.stringify({ weekStart, weekEnd, totalFromNotion: pages.length, saved, skipped, warnings, durationMs: Date.now() - startedAt.getTime() })]
    );

    return { ok: true, weekStart, weekEnd, totalFromNotion: pages.length, saved, skipped, warnings, durationMs: Date.now() - startedAt.getTime() };
  } catch (error) {
    await query(
      `UPDATE sync_status SET status = 'error', last_completed_at = NOW(), error_message = $2, updated_at = NOW() WHERE sync_key = $1`,
      [syncKey, error.message]
    );
    throw error;
  }
}

async function listPayrollPostgres({ weekStart, weekEnd, employee = "" }) {
  const normalizedEmployee = normalizeEmployeeName(employee);
  const result = await query(
    `
      SELECT *
      FROM payroll_records
      WHERE work_date BETWEEN $1 AND $2
        AND ($3 = '' OR normalized_employee = $3)
      ORDER BY work_date ASC, employee ASC, unit ASC
    `,
    [weekStart, weekEnd, normalizedEmployee]
  );
  return result.rows;
}

async function getPayrollSummaryPostgres(weekStart, weekEnd) {
  const result = await query(
    `
      SELECT
        employee,
        normalized_employee,
        COUNT(*)::integer AS records,
        COUNT(*) FILTER (WHERE pay_type = 'unit')::integer AS units,
        COALESCE(SUM(amount), 0)::numeric(12,2) AS total
      FROM payroll_records
      WHERE work_date BETWEEN $1 AND $2
      GROUP BY employee, normalized_employee
      ORDER BY employee ASC
    `,
    [weekStart, weekEnd]
  );
  return result.rows;
}

async function getPayrollSyncStatus(weekStart, weekEnd) {
  const syncKey = `payroll-notion-postgres:${weekStart}:${weekEnd}`;
  const result = await query(`SELECT * FROM sync_status WHERE sync_key = $1 LIMIT 1`, [syncKey]);
  return result.rows[0] || null;
}


function mapPayrollPostgresToLegacy(record) {
  return {
    date: String(record?.work_date || record?.workDate || "").slice(0, 10),
    cleaner: String(record?.employee || "").trim(),
    unit: String(record?.unit || "").trim(),
    roomType: String(record?.room_type || record?.roomType || "").trim(),
    amount: roundMoney(record?.amount || 0),
    notionId: record?.notion_id || record?.notionId || "",
    payType: record?.pay_type || record?.payType || "unit",
    roleWorked: record?.role_worked || record?.roleWorked || "Cleaner",
  };
}

function payrollComparisonKey(record) {
  return [
    String(record?.date || record?.work_date || "").slice(0, 10),
    normalizeEmployeeName(record?.cleaner || record?.employee || ""),
    String(record?.unit || "").trim().toUpperCase(),
    String(record?.payType || record?.pay_type || "unit").trim().toLowerCase(),
    String(record?.roleWorked || record?.role_worked || "Cleaner").trim().toLowerCase(),
  ].join("|");
}

function comparePayrollRecordSets(notionRecords = [], postgresRecords = []) {
  const notionMap = new Map();
  const postgresMap = new Map();

  for (const record of notionRecords) {
    notionMap.set(payrollComparisonKey(record), record);
  }

  for (const record of postgresRecords) {
    const legacy = mapPayrollPostgresToLegacy(record);
    postgresMap.set(payrollComparisonKey(legacy), legacy);
  }

  const missingInPostgres = [];
  const extraInPostgres = [];
  const amountMismatches = [];

  for (const [key, notionRecord] of notionMap.entries()) {
    const postgresRecord = postgresMap.get(key);

    if (!postgresRecord) {
      missingInPostgres.push(notionRecord);
      continue;
    }

    const notionAmount = roundMoney(notionRecord.amount || 0);
    const postgresAmount = roundMoney(postgresRecord.amount || 0);

    if (notionAmount !== postgresAmount) {
      amountMismatches.push({
        key,
        notion: notionRecord,
        postgres: postgresRecord,
        difference: roundMoney(postgresAmount - notionAmount),
      });
    }
  }

  for (const [key, postgresRecord] of postgresMap.entries()) {
    if (!notionMap.has(key)) extraInPostgres.push(postgresRecord);
  }

  const notionTotal = roundMoney(
    notionRecords.reduce((sum, record) => sum + Number(record.amount || 0), 0)
  );
  const postgresTotal = roundMoney(
    postgresRecords.reduce((sum, record) => sum + Number(record.amount || 0), 0)
  );

  return {
    matches:
      missingInPostgres.length === 0 &&
      extraInPostgres.length === 0 &&
      amountMismatches.length === 0 &&
      notionTotal === postgresTotal,
    notion: {
      count: notionRecords.length,
      total: notionTotal,
    },
    postgres: {
      count: postgresRecords.length,
      total: postgresTotal,
    },
    difference: {
      count: postgresRecords.length - notionRecords.length,
      total: roundMoney(postgresTotal - notionTotal),
    },
    missingInPostgres,
    extraInPostgres,
    amountMismatches,
  };
}

module.exports = {
  normalizeEmployeeName,
  getPayrollRecordFromNotionPage,
  syncPayrollFromNotion,
  listPayrollPostgres,
  getPayrollSummaryPostgres,
  getPayrollSyncStatus,
  mapPayrollPostgresToLegacy,
  comparePayrollRecordSets,
};
