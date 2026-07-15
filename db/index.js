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
        process.env.POSTGRES_CONNECTION_TIMEOUT_MS || 10000
      ),
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

async function initializeDatabase() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  await query(schema);

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
