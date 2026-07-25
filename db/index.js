const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const connectionString = process.env.DATABASENEW_URL || "";

let pool = null;

function getPool() {
  if (!connectionString) {
    throw new Error(
      "Falta DATABASENEW_URL en las variables de entorno de Render."
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.POSTGRES_POOL_MAX || 10),
      idleTimeoutMillis: Number(
        process.env.POSTGRES_IDLE_TIMEOUT_MS || 30000
      ),
      connectionTimeoutMillis: Number(
        process.env.POSTGRES_CONNECTION_TIMEOUT_MS || 8000
      ),
      statement_timeout: Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || 12000),
      query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || 15000),
      keepAlive: true,
      allowExitOnIdle: false,
    });

    pool.on("error", (error) => {
      console.error("POSTGRES POOL ERROR:", error.message);
    });
  }

  return pool;
}

async function query(text, params = []) {
  const startedAt = Date.now();

  try {
    return await getPool().query(text, params);
  } catch (error) {
    console.error("POSTGRES QUERY ERROR:", {
      message: error.message,
      durationMs: Date.now() - startedAt,
    });

    throw error;
  }
}

async function testDatabaseConnection() {
  const result = await query(`
    SELECT
      NOW() AS database_time,
      current_database() AS database_name
  `);

  return result.rows[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDatabaseError(error) {
  return ["40P01", "55P03", "57P03", "08000", "08003", "08006"].includes(error?.code) ||
    /deadlock|lock timeout|connection|terminating connection/i.test(String(error?.message || ""));
}

async function initializeDatabase() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const attempts = Math.max(1, Number(process.env.POSTGRES_INIT_ATTEMPTS || 6));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = await getPool().connect();

    try {
      // Evita que dos instancias de Render ejecuten schema.sql simultáneamente.
      await client.query("SELECT pg_advisory_lock($1)", [4172026]);
      await client.query(schema);
      const result = await client.query(`
        SELECT NOW() AS database_time, current_database() AS database_name
      `);
      return result.rows[0];
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt === attempts) throw error;
      const delay = Math.min(15000, 1000 * Math.pow(2, attempt - 1));
      console.warn(`⚠️ PostgreSQL init intento ${attempt}/${attempts}: ${error.message}. Reintentando...`);
      await sleep(delay);
    } finally {
      try { await client.query("SELECT pg_advisory_unlock($1)", [4172026]); } catch (_) {}
      client.release();
    }
  }

  return testDatabaseConnection();
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  query,
  testDatabaseConnection,
  initializeDatabase,
  closeDatabase,
};
