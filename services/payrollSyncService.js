const { query } = require('../db');
const {
  normalizeEmployeeName,
  splitEmployeeNames,
  assertPayrollWeekOpen,
  ensurePayrollWeek,
} = require('./payrollManagementService');

function readTextProperty(property) {
  if (!property) return '';
  if (property.title) return property.title.map((item) => item.plain_text || '').join('').trim();
  if (property.rich_text) return property.rich_text.map((item) => item.plain_text || '').join('').trim();
  if (property.select?.name) return String(property.select.name).trim();
  if (property.status?.name) return String(property.status.name).trim();
  if (property.multi_select) return property.multi_select.map((item) => item.name).join(' / ').trim();
  if (property.number !== undefined && property.number !== null) return String(property.number);
  return '';
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getPayrollWeek(dateValue) {
  const date = new Date(`${String(dateValue || '').slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { weekStart: '', weekEnd: '' };
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { weekStart: monday.toISOString().slice(0, 10), weekEnd: sunday.toISOString().slice(0, 10) };
}

async function findEffectiveRate(propertyName, roomType, workDate) {
  if (!roomType || !workDate) return null;
  const result = await query(
    `
      SELECT * FROM payroll_rates
      WHERE active = TRUE
        AND LOWER(room_type) = LOWER($1)
        AND effective_from <= $2
        AND (effective_to IS NULL OR effective_to >= $2)
        AND (LOWER(property_name) = LOWER($3) OR property_name = 'ALL')
      ORDER BY CASE WHEN LOWER(property_name) = LOWER($3) THEN 0 ELSE 1 END,
               effective_from DESC
      LIMIT 1
    `,
    [roomType, workDate, propertyName || 'ALL']
  );
  return result.rows[0] || null;
}

async function getPayrollRecordsFromNotionPage(page) {
  const properties = page?.properties || {};
  const workDate = properties.Date?.date?.start?.slice(0, 10) || '';
  const employeeText = readTextProperty(properties.Cleaner) || readTextProperty(properties.Employee) || readTextProperty(properties.Name);
  const employees = splitEmployeeNames(employeeText);
  const unit = readTextProperty(properties.Unit) || readTextProperty(properties.Room);
  const roomType = readTextProperty(properties['Room Type']) || readTextProperty(properties.Type);
  const propertyName = readTextProperty(properties.Property) || readTextProperty(properties.Hotel) || readTextProperty(properties.Location) || 'ALL';
  const statedAmount = Number(properties.Amount?.number ?? properties.Total?.number ?? 0);
  const statedGross = Number(properties['Gross Unit Amount']?.number ?? properties['Unit Amount']?.number ?? 0);
  const payType = readTextProperty(properties['Pay Type']) || 'unit';
  const roleWorked = readTextProperty(properties['Role Worked']) || 'Cleaner';
  const status = readTextProperty(properties.Status) || 'Pending';
  const computedWeek = getPayrollWeek(workDate);
  const weekStart = properties['Week Start']?.date?.start?.slice(0, 10) || computedWeek.weekStart;
  const weekEnd = properties['Week End']?.date?.start?.slice(0, 10) || computedWeek.weekEnd;

  const names = employees.length ? employees : employeeText ? [employeeText] : [];
  const splitCount = Math.max(1, names.length);
  const effectiveRate = await findEffectiveRate(propertyName, roomType, workDate);

  // Cuando Notion tiene varios nombres juntos, Amount se interpreta como el valor total de la unidad.
  // Para un solo nombre se conserva Amount tal como está. Si falta, se usa la tarifa configurada.
  const grossUnitAmount = roundMoney(
    statedGross > 0
      ? statedGross
      : splitCount > 1 && statedAmount > 0
        ? statedAmount
        : effectiveRate?.amount || statedAmount
  );

  return names.map((employee, index) => {
    const amount = roundMoney(
      splitCount > 1
        ? grossUnitAmount / splitCount
        : statedAmount > 0
          ? statedAmount
          : grossUnitAmount
    );

    return {
      notionId: `${page?.id || 'notion'}:${index + 1}:${normalizeEmployeeName(employee)}`,
      sourceNotionId: page?.id || '',
      workDate,
      employee,
      normalizedEmployee: normalizeEmployeeName(employee),
      unit,
      roomType,
      propertyName,
      grossUnitAmount,
      splitCount,
      splitPercent: Number((1 / splitCount).toFixed(4)),
      amount,
      payType,
      roleWorked,
      weekStart,
      weekEnd,
      status,
      rawData: { sourcePageId: page?.id || '', originalEmployeeText: employeeText, splitIndex: index + 1, splitCount, page },
    };
  });
}

async function upsertPayrollRecord(record) {
  if (!record.workDate || !record.employee || !record.normalizedEmployee) {
    return { saved: false, reason: 'missing-date-or-employee', record };
  }

  const result = await query(
    `
      INSERT INTO payroll_records (
        notion_id, work_date, employee, normalized_employee, unit, room_type,
        property_name, gross_unit_amount, split_count, split_percent, amount,
        pay_type, role_worked, week_start, week_end, status, source, raw_data, updated_at
      ) VALUES (
        NULLIF($1,''),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'notion',$17::jsonb,NOW()
      )
      ON CONFLICT (work_date, normalized_employee, unit, pay_type, role_worked)
      DO UPDATE SET
        notion_id = EXCLUDED.notion_id,
        employee = EXCLUDED.employee,
        room_type = EXCLUDED.room_type,
        property_name = EXCLUDED.property_name,
        gross_unit_amount = EXCLUDED.gross_unit_amount,
        split_count = EXCLUDED.split_count,
        split_percent = EXCLUDED.split_percent,
        amount = CASE WHEN payroll_records.manual_override THEN payroll_records.amount ELSE EXCLUDED.amount END,
        week_start = EXCLUDED.week_start,
        week_end = EXCLUDED.week_end,
        status = CASE WHEN payroll_records.status = 'Closed' THEN payroll_records.status ELSE EXCLUDED.status END,
        source = 'notion', raw_data = EXCLUDED.raw_data, updated_at = NOW()
      RETURNING *
    `,
    [record.notionId, record.workDate, record.employee, record.normalizedEmployee, record.unit, record.roomType,
      record.propertyName, record.grossUnitAmount, record.splitCount, record.splitPercent, record.amount,
      record.payType, record.roleWorked, record.weekStart, record.weekEnd, record.status,
      JSON.stringify(record.rawData || {})]
  );
  return { saved: true, record: result.rows[0] };
}

async function syncPayrollFromNotion({ notion, databaseId, queryDatabase, weekStart, weekEnd }) {
  if (!databaseId) throw new Error('Falta NOTION_PAYROLL_DATABASE_ID');
  if (!weekStart || !weekEnd) throw new Error('weekStart y weekEnd son requeridos');
  await assertPayrollWeekOpen(weekStart, weekEnd);
  await ensurePayrollWeek(weekStart, weekEnd);

  const syncKey = `payroll-notion-postgres:${weekStart}:${weekEnd}`;
  const startedAt = new Date();
  await query(
    `INSERT INTO sync_status (sync_key,source,destination,status,last_started_at,records_processed,error_message,metadata,updated_at)
     VALUES ($1,'notion','postgres','running',NOW(),0,'',$2::jsonb,NOW())
     ON CONFLICT (sync_key) DO UPDATE SET status='running',last_started_at=NOW(),records_processed=0,error_message='',metadata=EXCLUDED.metadata,updated_at=NOW()`,
    [syncKey, JSON.stringify({ weekStart, weekEnd })]
  );

  try {
    let pages = [];
    let cursor;
    do {
      const body = {
        database_id: databaseId,
        page_size: 100,
        filter: { and: [
          { property: 'Date', date: { on_or_after: weekStart } },
          { property: 'Date', date: { on_or_before: weekEnd } },
        ] },
        sorts: [{ property: 'Date', direction: 'ascending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const response = queryDatabase ? await queryDatabase(body) : await notion.databases.query(body);
      pages = pages.concat(response.results || []);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    let saved = 0;
    let skipped = 0;
    let splitSourceRecords = 0;
    const warnings = [];

    for (const page of pages) {
      await query(
        `DELETE FROM payroll_records
         WHERE manual_override = FALSE
           AND status <> 'Closed'
           AND (notion_id = $1 OR raw_data->>'sourcePageId' = $1)`,
        [page?.id || '']
      );
      const records = await getPayrollRecordsFromNotionPage(page);
      if (records.length > 1) splitSourceRecords += 1;
      if (!records.length) {
        skipped += 1;
        warnings.push({ notionId: page?.id || '', reason: 'missing-employee' });
        continue;
      }
      for (const record of records) {
        const result = await upsertPayrollRecord(record);
        if (result.saved) saved += 1;
        else { skipped += 1; warnings.push({ notionId: page?.id || '', reason: result.reason }); }
      }
    }

    await query(
      `UPDATE sync_status SET status='success',last_completed_at=NOW(),last_success_at=NOW(),records_processed=$2,error_message='',metadata=$3::jsonb,updated_at=NOW() WHERE sync_key=$1`,
      [syncKey, saved, JSON.stringify({ weekStart, weekEnd, totalFromNotion: pages.length, saved, skipped, splitSourceRecords, warnings, durationMs: Date.now() - startedAt.getTime() })]
    );
    return { ok: true, weekStart, weekEnd, totalFromNotion: pages.length, saved, skipped, splitSourceRecords, warnings, durationMs: Date.now() - startedAt.getTime() };
  } catch (error) {
    await query(`UPDATE sync_status SET status='error',last_completed_at=NOW(),error_message=$2,updated_at=NOW() WHERE sync_key=$1`, [syncKey, error.message]);
    throw error;
  }
}

async function listPayrollPostgres({ weekStart, weekEnd, employee = '' }) {
  const normalizedEmployee = normalizeEmployeeName(employee);
  const result = await query(
    `SELECT * FROM payroll_records WHERE work_date BETWEEN $1 AND $2 AND ($3='' OR normalized_employee=$3) ORDER BY work_date,employee,unit`,
    [weekStart, weekEnd, normalizedEmployee]
  );
  return result.rows;
}

async function getPayrollSummaryPostgres(weekStart, weekEnd) {
  const result = await query(
    `SELECT employee,normalized_employee,COUNT(*)::integer AS records,
            COUNT(*) FILTER (WHERE pay_type='unit')::integer AS units,
            COALESCE(SUM(amount),0)::numeric(12,2) AS total
     FROM payroll_records WHERE work_date BETWEEN $1 AND $2
     GROUP BY employee,normalized_employee ORDER BY employee`,
    [weekStart, weekEnd]
  );
  return result.rows;
}

async function getPayrollSyncStatus(weekStart, weekEnd) {
  const result = await query(`SELECT * FROM sync_status WHERE sync_key=$1 LIMIT 1`, [`payroll-notion-postgres:${weekStart}:${weekEnd}`]);
  return result.rows[0] || null;
}

function mapPayrollPostgresToLegacy(record) {
  return {
    id: record?.id,
    date: String(record?.work_date || record?.workDate || '').slice(0,10),
    cleaner: String(record?.employee || '').trim(),
    unit: String(record?.unit || '').trim(),
    roomType: String(record?.room_type || record?.roomType || '').trim(),
    propertyName: String(record?.property_name || 'ALL').trim(),
    grossUnitAmount: roundMoney(record?.gross_unit_amount || 0),
    splitCount: Number(record?.split_count || 1),
    splitPercent: Number(record?.split_percent || 1),
    amount: roundMoney(record?.amount || 0),
    notionId: record?.notion_id || '',
    payType: record?.pay_type || 'unit',
    roleWorked: record?.role_worked || 'Cleaner',
    manualOverride: Boolean(record?.manual_override),
    adjustmentReason: record?.adjustment_reason || '',
    status: record?.status || 'Pending',
  };
}

function payrollComparisonKey(record) {
  return [String(record?.date || record?.work_date || '').slice(0,10), normalizeEmployeeName(record?.cleaner || record?.employee || ''), String(record?.unit || '').trim().toUpperCase(), String(record?.payType || record?.pay_type || 'unit').toLowerCase(), String(record?.roleWorked || record?.role_worked || 'Cleaner').toLowerCase()].join('|');
}

function comparePayrollRecordSets(notionRecords = [], postgresRecords = []) {
  const notionMap = new Map();
  const postgresMap = new Map();
  notionRecords.forEach((record) => notionMap.set(payrollComparisonKey(record), record));
  postgresRecords.forEach((record) => { const legacy = mapPayrollPostgresToLegacy(record); postgresMap.set(payrollComparisonKey(legacy), legacy); });
  const missingInPostgres = [];
  const extraInPostgres = [];
  const amountMismatches = [];
  for (const [key, notionRecord] of notionMap) {
    const postgresRecord = postgresMap.get(key);
    if (!postgresRecord) { missingInPostgres.push(notionRecord); continue; }
    const notionAmount = roundMoney(notionRecord.amount || 0);
    const postgresAmount = roundMoney(postgresRecord.amount || 0);
    if (notionAmount !== postgresAmount && !postgresRecord.manualOverride) {
      amountMismatches.push({ key, notion: notionRecord, postgres: postgresRecord, difference: roundMoney(postgresAmount - notionAmount) });
    }
  }
  for (const [key, postgresRecord] of postgresMap) if (!notionMap.has(key)) extraInPostgres.push(postgresRecord);
  const notionTotal = roundMoney(notionRecords.reduce((sum,r) => sum + Number(r.amount || 0),0));
  const postgresTotal = roundMoney(postgresRecords.reduce((sum,r) => sum + Number(r.amount || 0),0));
  const approvedAdjustments = postgresRecords.filter((record) => Boolean(record.manual_override)).length;
  return {
    matches: missingInPostgres.length===0 && extraInPostgres.length===0 && amountMismatches.length===0,
    notion: { count: notionRecords.length, total: notionTotal },
    postgres: { count: postgresRecords.length, total: postgresTotal },
    difference: { count: postgresRecords.length-notionRecords.length, total: roundMoney(postgresTotal-notionTotal) },
    approvedAdjustments, missingInPostgres, extraInPostgres, amountMismatches,
  };
}

module.exports = {
  normalizeEmployeeName,
  getPayrollRecordFromNotionPage: getPayrollRecordsFromNotionPage,
  getPayrollRecordsFromNotionPage,
  syncPayrollFromNotion,
  listPayrollPostgres,
  getPayrollSummaryPostgres,
  getPayrollSyncStatus,
  mapPayrollPostgresToLegacy,
  comparePayrollRecordSets,
};
