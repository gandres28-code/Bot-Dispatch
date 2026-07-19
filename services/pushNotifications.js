const admin = require("firebase-admin");

let firebaseReady = false;

function normalizeEmployeeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function initializeFirebaseAdmin() {
  if (firebaseReady) return true;

  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();

  if (!projectId || !clientEmail || !privateKey) {
    console.warn("⚠️ Firebase Push desactivado: faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY.");
    return false;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }

  firebaseReady = true;
  console.log("✅ Firebase Push Notifications activado");
  return true;
}

async function registerPushToken(query, payload = {}) {
  const employeeName = String(payload.employeeName || "").trim();
  const employeeRole = String(payload.employeeRole || "").trim();
  const token = String(payload.token || "").trim();

  if (!employeeName || !token) throw new Error("employeeName y token son requeridos");

  const employeeKey = normalizeEmployeeKey(employeeName);
  await query(`
    INSERT INTO push_device_tokens (
      employee_name, employee_key, employee_role, token, platform, user_agent,
      active, last_seen_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW(),NOW())
    ON CONFLICT (token) DO UPDATE SET
      employee_name = EXCLUDED.employee_name,
      employee_key = EXCLUDED.employee_key,
      employee_role = EXCLUDED.employee_role,
      platform = EXCLUDED.platform,
      user_agent = EXCLUDED.user_agent,
      active = TRUE,
      last_seen_at = NOW(),
      updated_at = NOW()
  `, [
    employeeName,
    employeeKey,
    employeeRole,
    token,
    String(payload.platform || "web"),
    String(payload.userAgent || "").slice(0, 1000),
  ]);

  return { employeeName, employeeKey, employeeRole };
}

async function deactivatePushToken(query, token) {
  await query(`UPDATE push_device_tokens SET active=FALSE, updated_at=NOW() WHERE token=$1`, [token]);
}

async function sendPushToEmployees(query, employeeNames, message = {}) {
  if (!initializeFirebaseAdmin()) return { sent: 0, failed: 0, skipped: true };

  const keys = [...new Set((employeeNames || []).map(normalizeEmployeeKey).filter(Boolean))];
  if (!keys.length) return { sent: 0, failed: 0, skipped: true };

  const result = await query(`
    SELECT token FROM push_device_tokens
    WHERE active=TRUE AND employee_key = ANY($1::text[])
  `, [keys]);
  const tokens = [...new Set(result.rows.map(row => row.token).filter(Boolean))];
  if (!tokens.length) return { sent: 0, failed: 0, skipped: true };

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {
      title: String(message.title || "417 Maid"),
      body: String(message.body || "Tienes una actualización."),
    },
    data: Object.fromEntries(Object.entries(message.data || {}).map(([k,v]) => [k, String(v ?? "")])),
    webpush: {
      headers: { Urgency: message.urgent ? "high" : "normal" },
      notification: {
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: String(message.tag || `417maid-${Date.now()}`),
        renotify: Boolean(message.urgent),
        requireInteraction: Boolean(message.urgent),
        vibrate: message.urgent ? [250,100,250,100,400] : [120,60,120],
      },
      fcmOptions: { link: String(message.link || "/launch") },
    },
  });

  const invalidTokens=[];
  response.responses.forEach((item,index)=>{
    if (item.success) return;
    const code = item.error?.code || "";
    if (["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(code)) {
      invalidTokens.push(tokens[index]);
    }
  });

  if (invalidTokens.length) {
    await query(`UPDATE push_device_tokens SET active=FALSE, updated_at=NOW() WHERE token = ANY($1::text[])`, [invalidTokens]);
  }

  return { sent: response.successCount, failed: response.failureCount, invalidTokens: invalidTokens.length };
}

module.exports = {
  initializeFirebaseAdmin,
  registerPushToken,
  deactivatePushToken,
  sendPushToEmployees,
  normalizeEmployeeKey,
};
