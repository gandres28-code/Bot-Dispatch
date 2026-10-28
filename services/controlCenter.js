const express = require("express");

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function dateValue(value) {
  const date = text(value, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) fail("Fecha inválida.");
  return date;
}
function canManage(user) {
  const roles = text(user?.role).toLowerCase().split(/\s*[/,;]\s*/);
  return roles.some(role => ["admin", "manager", "owner", "company owner", "general manager", "corporate", "dispatch", "operations", "supervisor"].includes(role));
}
function taskInput(body) {
  const title = text(body.title, 160), owner = text(body.owner, 120);
  if (!title || !owner) fail("Escribe la tarea y asigna un responsable.");
  const priority = body.priority || "normal";
  if (!["normal", "high", "urgent"].includes(priority)) fail("Prioridad inválida.");
  const due = body.dueAt ? new Date(body.dueAt) : null;
  if (due && Number.isNaN(due.getTime())) fail("Hora límite inválida.");
  return { title, owner, priority, dueAt: due?.toISOString() || null, room: text(body.room,80), note: text(body.note,2000) };
}
function summarize(rooms, orders, tasks, now = Date.now()) {
  const openOrders = orders.filter(o => !["completed", "cancelled"].includes(o.status));
  const openTasks = tasks.filter(t => t.status !== "done");
  const ready = rooms.filter(r => r.statusGroup === "ready");
  const unassigned = rooms.filter(r => r.statusGroup !== "ready" && !r.assignedCleaner && !r.assignedCleaners?.length);
  return { total: rooms.length, ready: ready.length, awaitingInspection: rooms.filter(r => ["awaitingInspection", "inspection"].includes(r.statusGroup)).length,
    unassigned: unassigned.length, arrivalsPending: rooms.filter(r => r.arrival && r.statusGroup !== "ready").length,
    openOrders: openOrders.length, unassignedOrders: openOrders.filter(o => !text(o.assigned_to) || /^(runner|unassigned|sin asignar)$/i.test(text(o.assigned_to))).length,
    overdueTasks: openTasks.filter(t => t.due_at && Date.parse(t.due_at) < now).length,
    openTasks: openTasks.length, urgentOrders: openOrders.filter(o => o.priority === "urgent").length };
}
function createControlRouter({ query, pool, resolveUser, listRooms, listEmployees, today, emit = () => {} }) {
  const router = express.Router();
  const attempts = new Map();
  // Authentication is checked on the server on every request. Never trust a browser role/name.
  router.use(async (req, res, next) => {
    const ip = req.ip, now = Date.now();
    for (const [key, val] of attempts) if (now - val.start > 60000) attempts.delete(key);
    const attempt = attempts.get(ip) || { start: now, failures: 0 };
    if (attempt.failures >= 20) return res.status(429).json({ ok:false, error:"Demasiados intentos. Espera un minuto." });
    try {
      const code = text(req.get("X-Care-Code"), 120);
      const user = code ? await resolveUser(code) : null;
      if (!user?.active) { attempt.failures++; attempts.set(ip, attempt); return res.status(401).json({ok:false,error:"Inicia sesión con tu código activo."}); }
      if (!canManage(user)) return res.status(403).json({ok:false,error:"Esta vista requiere un encargado de operaciones o administrador."});
      req.careUser = user;
      res.set("Cache-Control", "no-store");
      next();
    } catch { res.status(503).json({ok:false,error:"No fue posible verificar tu acceso. Intenta nuevamente."}); }
  });
  const route = fn => async (req,res) => { try { await fn(req,res); } catch(error) {
    if (!error.status) console.error("CONTROL CENTER:", error.message);
    res.status(error.status || 503).json({ok:false,error:error.status ? error.message : "No se pudo guardar o cargar. Revisa la conexión y vuelve a intentar."});
  }};
  async function transaction(fn) {
    const client = await pool().connect();
    try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
    catch(error) { await client.query("ROLLBACK").catch(()=>{}); throw error; } finally { client.release(); }
  }
  async function audit(client, date, user, action, detail) {
    await client.query("INSERT INTO care_control_audit (work_date,actor,action,detail) VALUES ($1,$2,$3,$4::jsonb)", [date,user.name,action,JSON.stringify(detail)]);
  }
  router.get("/day", route(async(req,res) => {
    const date = dateValue(req.query.date || today());
    const [rooms, employees, orders, tasks, shift, history] = await Promise.all([
      listRooms({ date }), listEmployees({ activeOnly:true }),
      query("SELECT * FROM service_orders WHERE (status NOT IN ('completed','cancelled') AND (created_at AT TIME ZONE 'America/Chicago')::date <= $1::date) OR (created_at AT TIME ZONE 'America/Chicago')::date=$1::date ORDER BY created_at DESC LIMIT 1000",[date]),
      query("SELECT * FROM care_control_tasks WHERE work_date=$1::date OR (work_date<$1::date AND status<>'done') ORDER BY created_at DESC",[date]),
      query("SELECT * FROM care_control_shifts WHERE work_date=$1::date",[date]),
      query("SELECT actor,action,detail,created_at FROM care_control_audit WHERE work_date=$1::date ORDER BY id DESC LIMIT 100",[date])
    ]);
    // Deliberately omit employee codes and payroll data from this operational view.
    res.json({ok:true,date,user:{name:req.careUser.name,role:req.careUser.role},rooms,
      employees:employees.map(e => ({name:e.name,role:e.role})),orders:orders.rows,tasks:tasks.rows,
      shift:shift.rows[0] || {version:0,settings:{},status:"open"},history:history.rows,
      summary:summarize(rooms,orders.rows,tasks.rows),updatedAt:new Date().toISOString()});
  }));
  router.post("/tasks", route(async(req,res) => {
    const date = dateValue(req.body.date), task = taskInput(req.body);
    const requestId = text(req.body.requestId, 80);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail("Identificador de solicitud inválido.");
    const result = await transaction(async client => {
      const result = await client.query(`INSERT INTO care_control_tasks (work_date,title,owner,room,priority,due_at,note,created_by,request_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (request_id) DO NOTHING RETURNING *`,
        [date,task.title,task.owner,task.room,task.priority,task.dueAt,task.note,req.careUser.name,requestId]);
      if (!result.rows[0]) return (await client.query("SELECT * FROM care_control_tasks WHERE request_id=$1",[requestId])).rows[0];
      await audit(client,date,req.careUser,"task_created",{id:result.rows[0].id,title:task.title,owner:task.owner});
      return result.rows[0];
    });
    emit("care-control:updated",{date}); res.json({ok:true,task:result});
  }));
  router.patch("/tasks/:id", route(async(req,res) => {
    if (!/^\d+$/.test(req.params.id)) fail("Tarea inválida.");
    if (!["pending","in_progress","done"].includes(req.body.status)) fail("Estado inválido.");
    const version = Number(req.body.version);
    if (!Number.isInteger(version) || version < 1) fail("Versión inválida.");
    const task = await transaction(async client => {
      const result = await client.query(`UPDATE care_control_tasks SET status=$1,version=version+1,updated_at=NOW(),updated_by=$2 WHERE id=$3 AND version=$4 RETURNING *`,[req.body.status,req.careUser.name,req.params.id,version]);
      if (!result.rows[0]) fail("La tarea cambió en otro dispositivo. Actualiza antes de continuar.",409);
      const task = result.rows[0];
      await audit(client,task.work_date,req.careUser,"task_status",{id:task.id,status:task.status}); return task;
    });
    emit("care-control:updated",{}); res.json({ok:true,task});
  }));
  router.put("/shift", route(async(req,res) => {
    const date = dateValue(req.body.date), version = Number(req.body.version);
    if (!Number.isInteger(version) || version < 0) fail("Versión inválida.");
    const settings = {};
    for (const key of ["operations","backup","inspection","supplies","admin","handoff"]) settings[key] = text(req.body.settings?.[key], key === "handoff" ? 3000 : 120);
    if (!settings.operations || !settings.backup) fail("Asigna encargado y suplente.");
    if (settings.operations === settings.backup) fail("El suplente debe ser una persona distinta.");
    const status = req.body.status || "open";
    if (!["open","reviewed"].includes(status)) fail("Estado de turno inválido.");
    // 'reviewed' is a documented handoff, never a claim that rooms are guest-ready or payroll is closed.
    const shift = await transaction(async client => {
      const result = version === 0
        ? await client.query(`INSERT INTO care_control_shifts (work_date,settings,status,updated_by) VALUES ($1,$2::jsonb,$3,$4) ON CONFLICT (work_date) DO NOTHING RETURNING *`,[date,JSON.stringify(settings),status,req.careUser.name])
        : await client.query(`UPDATE care_control_shifts SET settings=$1::jsonb,status=$2,version=version+1,updated_by=$3,updated_at=NOW() WHERE work_date=$4 AND version=$5 RETURNING *`,[JSON.stringify(settings),status,req.careUser.name,date,version]);
      if (!result.rows[0]) fail("El turno cambió en otro dispositivo. Actualiza y vuelve a intentar.",409);
      await audit(client,date,req.careUser,status === "reviewed" ? "handoff_reviewed" : "shift_saved",{settings,status}); return result.rows[0];
    });
    emit("care-control:updated",{date}); res.json({ok:true,shift});
  }));
  router.patch("/orders/:id/delegate", route(async(req,res) => {
    if (!/^\d+$/.test(req.params.id)) fail("Orden inválida.");
    const owner = text(req.body.owner,120), ticket = text(req.body.ticket,120);
    if (!owner) fail("Asigna una persona responsable.");
    const order = await transaction(async client => {
      const result = await client.query("SELECT * FROM service_orders WHERE id=$1 FOR UPDATE",[req.params.id]);
      const existing = result.rows[0];
      if (!existing) fail("Orden no encontrada.",404);
      if (["completed","cancelled"].includes(existing.status)) fail("La orden ya está cerrada.",409);
      if (String(existing.updated_at instanceof Date ? existing.updated_at.toISOString() : existing.updated_at) !== text(req.body.updatedAt,80)) fail("La orden cambió. Actualiza antes de asignar.",409);
      const next = await client.query("UPDATE service_orders SET assigned_to=$1,hotsos_ticket=$2,updated_at=NOW() WHERE id=$3 RETURNING *",[owner,ticket,req.params.id]);
      await client.query("INSERT INTO service_order_events (order_id,event_type,actor,note) VALUES ($1,'delegated',$2,$3)",[req.params.id,req.careUser.name,`Responsable: ${owner}. HotSOS: ${ticket || 'sin ticket'}`]);
      await audit(client,today(),req.careUser,"order_delegated",{id:req.params.id,owner,ticket}); return next.rows[0];
    });
    emit("service-order:updated",order); emit("care-control:updated",{}); res.json({ok:true,order});
  }));
  return router;
}
module.exports = { createControlRouter, summarize, taskInput, dateValue, canManage };
