(() => {
  "use strict";

  const state = {
    start: "",
    end: "",
    preview: null,
    raw: null,
    syncStatus: null,
    comparison: null,
    loading: false,
  };

  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const isoLocal = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  function getWeek(date = new Date()) {
    const current = new Date(date);
    current.setHours(12, 0, 0, 0);
    const day = current.getDay();
    current.setDate(current.getDate() + (day === 0 ? -6 : 1 - day));
    const end = new Date(current);
    end.setDate(current.getDate() + 6);
    return { start: isoLocal(current), end: isoLocal(end) };
  }

  function parseLocalDate(value) {
    return new Date(`${value}T12:00:00`);
  }

  function formatRange(start, end) {
    const formatter = new Intl.DateTimeFormat("es-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${formatter.format(parseLocalDate(start))} – ${formatter.format(parseLocalDate(end))}`;
  }

  function dayName(dateValue) {
    if (!dateValue) return "Sin fecha";
    const formatter = new Intl.DateTimeFormat("es-US", { weekday: "long" });
    const value = formatter.format(parseLocalDate(String(dateValue).slice(0, 10)));
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function setBadge(element, text, type = "blue") {
    element.className = `badge ${type}`;
    element.textContent = text;
  }

  function showToast(message, type = "") {
    const toast = $("toast");
    toast.textContent = message;
    toast.className = `toast ${type}`.trim();
    requestAnimationFrame(() => toast.classList.add("show"));
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function setLoading(loading, message = "") {
    state.loading = loading;
    ["syncButton", "compareButton", "excelButton", "refreshButton", "prevWeek", "nextWeek", "currentWeek"]
      .forEach((id) => { $(id).disabled = loading; });

    if (message) {
      $("systemBadge").textContent = message;
      $("systemBadge").className = "badge blue";
    }
  }

  function readRangeFromInputs() {
    state.start = $("startDate").value;
    state.end = $("endDate").value;

    if (!state.start || !state.end) {
      throw new Error("Selecciona el inicio y final de la semana.");
    }

    if (state.end < state.start) {
      throw new Error("La fecha final no puede ser anterior a la inicial.");
    }
  }

  function writeRange(range) {
    state.start = range.start;
    state.end = range.end;
    $("startDate").value = range.start;
    $("endDate").value = range.end;
    $("weekLabel").textContent = formatRange(range.start, range.end);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 409) {
      throw new Error(data.message || data.error || `Error HTTP ${response.status}`);
    }
    return { response, data };
  }

  async function loadDashboard({ compare = false } = {}) {
    try {
      readRangeFromInputs();
      setLoading(true, "Cargando");
      $("weekLabel").textContent = formatRange(state.start, state.end);

      const range = `start=${encodeURIComponent(state.start)}&end=${encodeURIComponent(state.end)}`;
      const requests = [
        fetchJson(`/payroll-preview?${range}`),
        fetchJson(`/api/payroll/preview?${range}`),
        fetchJson(`/api/sync/payroll/status?${range}`),
      ];

      if (compare) requests.push(fetchJson(`/api/payroll/compare?${range}`));

      const results = await Promise.all(requests);
      state.preview = results[0].data;
      state.raw = results[1].data;
      state.syncStatus = results[2].data;
      if (compare) state.comparison = results[3].data;

      renderAll();
      setBadge($("systemBadge"), "Actualizado", "green");
    } catch (error) {
      console.error(error);
      setBadge($("systemBadge"), "Error", "red");
      showToast(error.message || "No se pudo cargar Payroll.", "error");
    } finally {
      setLoading(false);
    }
  }

  function renderAll() {
    renderStats();
    renderSource();
    renderSyncStatus();
    renderComparison();
    renderEmployees();
    renderDaily();
    renderWarnings();
  }

  function renderStats() {
    const totals = state.preview?.totals || {};
    $("totalPayroll").textContent = money(totals.amount);
    $("totalEmployees").textContent = Number(totals.employees || 0).toLocaleString();
    $("totalUnits").textContent = Number(totals.units || 0).toLocaleString();
    $("totalWarnings").textContent = Number(state.preview?.warnings?.length || 0).toLocaleString();
    $("hourlyCount").textContent = Number(totals.hourlyEntries || 0).toLocaleString();
    $("postgresCount").textContent = Number(state.raw?.count || 0).toLocaleString();
    $("postgresTotal").textContent = money(state.raw?.total || 0);
  }

  function renderSource() {
    const source = state.preview?.source || state.raw?.source || "unknown";
    const fallback = Boolean(state.preview?.fallback || state.raw?.fallback);
    const sourceText = source === "postgres" ? "PostgreSQL" : source === "notion" ? "Notion" : source;

    $("sourceText").textContent = fallback ? `${sourceText} · fallback` : sourceText;
    $("activeSourceText").textContent = fallback
      ? `Modo fallback: ${state.preview?.fallbackReason || "PostgreSQL no disponible"}`
      : `${sourceText} está alimentando Payroll`;

    setBadge($("activeSourceBadge"), fallback ? "FALLBACK" : sourceText.toUpperCase(), fallback ? "amber" : "green");
    $("sourceDot").style.background = fallback ? "#fdba74" : "#86efac";
  }

  function renderSyncStatus() {
    const payload = state.syncStatus || {};
    const status = payload.status;

    if (!payload.postgresConnected) {
      $("lastSyncText").textContent = "PostgreSQL no está conectado";
      setBadge($("syncBadge"), "Sin conexión", "red");
      return;
    }

    if (payload.running) {
      $("lastSyncText").textContent = "Sincronización en proceso";
      setBadge($("syncBadge"), "Ejecutando", "blue");
      return;
    }

    if (!status) {
      $("lastSyncText").textContent = "Esta semana aún no tiene registro de sincronización";
      setBadge($("syncBadge"), "Pendiente", "amber");
      return;
    }

    const timeValue = status.last_success_at || status.last_run_at || status.updated_at;
    const formatted = timeValue
      ? new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timeValue))
      : "Fecha no disponible";
    $("lastSyncText").textContent = formatted;

    const success = status.status === "success" || status.last_status === "success" || !status.last_error;
    setBadge($("syncBadge"), success ? "Sincronizado" : "Con error", success ? "green" : "red");
  }

  function renderComparison() {
    const comparison = state.comparison;
    if (!comparison) {
      $("comparisonText").textContent = "Presiona Comparar para validar ambas fuentes";
      setBadge($("comparisonBadge"), "Pendiente", "blue");
      return;
    }

    const matches = Boolean(comparison.matches);
    $("comparisonText").textContent = matches
      ? `${comparison.notion?.count || 0} registros y ${money(comparison.notion?.total || 0)} coinciden`
      : `Diferencia: ${comparison.difference?.count || 0} registros y ${money(comparison.difference?.total || 0)}`;
    setBadge($("comparisonBadge"), matches ? "Coinciden" : "Revisar", matches ? "green" : "red");
  }

  function employeeRecords(employeeName) {
    const normalized = String(employeeName || "").trim().toLowerCase();
    return (state.raw?.records || []).filter((record) => {
      const name = String(record.cleaner || record.employee || "").trim().toLowerCase();
      return name === normalized;
    });
  }

  function renderEmployees() {
    const people = state.preview?.people || [];
    const container = $("employeeList");

    if (!people.length) {
      container.innerHTML = '<div class="empty">No hay empleados con actividad en esta semana.</div>';
      return;
    }

    container.innerHTML = people.map((person, index) => {
      const records = employeeRecords(person.employee);
      const detailRows = records.length
        ? records.map((record) => `
          <tr>
            <td>${escapeHtml(String(record.date || record.work_date || "").slice(0, 10))}</td>
            <td>${escapeHtml(record.unit || "Sin unidad")}</td>
            <td>${escapeHtml(record.roomType || record.room_type || "-")}</td>
            <td>${money(record.amount)}</td>
          </tr>`).join("")
        : '<tr><td colspan="4">Los pagos por hora se muestran en el total, pero todavía se leen desde Time Clock.</td></tr>';

      return `
        <article class="employee-card" data-employee-index="${index}">
          <button class="employee-main" type="button">
            <div>
              <div class="employee-name">${escapeHtml(person.employee)}</div>
              <div class="employee-meta">${escapeHtml((person.roles || []).join(" · ") || "Sin rol")}</div>
            </div>
            <div class="mobile-hide"><div class="metric-label">Unidades</div><div class="metric-value">${Number(person.units || 0)}</div></div>
            <div class="hide-tablet mobile-hide"><div class="metric-label">Limpieza</div><div class="metric-value">${money(person.cleaningPay)}</div></div>
            <div class="hide-tablet mobile-hide"><div class="metric-label">Horas</div><div class="metric-value">${Number(person.hours || 0).toFixed(2)}</div></div>
            <div><div class="metric-label">Total</div><div class="metric-value">${money(person.total)}</div></div>
            <span class="chevron">⌄</span>
          </button>
          <div class="employee-detail">
            <table class="detail-table">
              <thead><tr><th>Fecha</th><th>Unidad</th><th>Tipo</th><th>Pago</th></tr></thead>
              <tbody>${detailRows}</tbody>
            </table>
          </div>
        </article>`;
    }).join("");

    container.querySelectorAll(".employee-main").forEach((button) => {
      button.addEventListener("click", () => button.closest(".employee-card").classList.toggle("open"));
    });
  }

  function renderDaily() {
    const records = state.raw?.records || [];
    const daily = new Map();

    for (const record of records) {
      const date = String(record.date || record.work_date || "").slice(0, 10) || "Sin fecha";
      const current = daily.get(date) || { date, total: 0, units: 0 };
      current.total += Number(record.amount || 0);
      current.units += 1;
      daily.set(date, current);
    }

    const items = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
    const container = $("dailyList");

    if (!items.length) {
      container.innerHTML = '<div class="empty">No hay pagos por unidad para esta semana.</div>';
      return;
    }

    const max = Math.max(...items.map((item) => item.total), 1);
    container.innerHTML = items.map((item) => `
      <div class="daily-card">
        <div class="daily-head"><span>${escapeHtml(dayName(item.date))}</span><span>${money(item.total)}</span></div>
        <div class="daily-meta"><span>${escapeHtml(item.date)}</span><span>${item.units} unidades</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (item.total / max) * 100).toFixed(1)}%"></div></div>
      </div>`).join("");
  }

  function renderWarnings() {
    const warnings = [...new Set(state.preview?.warnings || [])];
    const comparison = state.comparison;

    if (comparison && !comparison.matches) {
      if (comparison.missingInPostgres?.length) warnings.push(`${comparison.missingInPostgres.length} registros faltan en PostgreSQL.`);
      if (comparison.extraInPostgres?.length) warnings.push(`${comparison.extraInPostgres.length} registros adicionales existen en PostgreSQL.`);
      if (comparison.amountMismatches?.length) warnings.push(`${comparison.amountMismatches.length} pagos tienen cantidades diferentes.`);
    }

    const container = $("warningList");
    $("totalWarnings").textContent = warnings.length.toLocaleString();

    if (!warnings.length) {
      container.innerHTML = '<div class="empty">✅ No se detectaron advertencias en la semana seleccionada.</div>';
      return;
    }

    container.innerHTML = warnings.map((warning) => `
      <div class="warning-item"><span>⚠️</span><span>${escapeHtml(warning)}</span></div>`).join("");
  }

  async function syncPayroll() {
    try {
      readRangeFromInputs();
      setLoading(true, "Sincronizando");
      const { data } = await fetchJson("/api/sync/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: state.start, end: state.end }),
      });

      if (!data.ok) throw new Error(data.message || "La sincronización no terminó correctamente.");
      showToast(`Sincronización terminada: ${data.saved ?? 0} guardados.`, "success");
      await loadDashboard({ compare: true });
    } catch (error) {
      showToast(error.message, "error");
      setLoading(false);
    }
  }

  async function comparePayroll() {
    try {
      readRangeFromInputs();
      setLoading(true, "Comparando");
      const range = `start=${encodeURIComponent(state.start)}&end=${encodeURIComponent(state.end)}`;
      const { data } = await fetchJson(`/api/payroll/compare?${range}`);
      state.comparison = data;
      renderComparison();
      renderWarnings();
      showToast(data.matches ? "Notion y PostgreSQL coinciden." : "Se encontraron diferencias.", data.matches ? "success" : "error");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function downloadExcel() {
    try {
      readRangeFromInputs();
      window.location.href = `/payroll-excel?start=${encodeURIComponent(state.start)}&end=${encodeURIComponent(state.end)}`;
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function moveWeek(delta) {
    const base = $("startDate").value ? parseLocalDate($("startDate").value) : new Date();
    base.setDate(base.getDate() + delta * 7);
    writeRange(getWeek(base));
    state.comparison = null;
    loadDashboard();
  }

  function bindEvents() {
    $("prevWeek").addEventListener("click", () => moveWeek(-1));
    $("nextWeek").addEventListener("click", () => moveWeek(1));
    $("currentWeek").addEventListener("click", () => {
      writeRange(getWeek(new Date()));
      state.comparison = null;
      loadDashboard();
    });
    $("syncButton").addEventListener("click", syncPayroll);
    $("compareButton").addEventListener("click", comparePayroll);
    $("excelButton").addEventListener("click", downloadExcel);
    $("refreshButton").addEventListener("click", () => loadDashboard());
    $("startDate").addEventListener("change", () => {
      const start = parseLocalDate($("startDate").value);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      $("endDate").value = isoLocal(end);
      state.comparison = null;
      loadDashboard();
    });
    $("endDate").addEventListener("change", () => {
      state.comparison = null;
      loadDashboard();
    });
  }

  bindEvents();
  writeRange(getWeek(new Date()));
  loadDashboard();
})();
