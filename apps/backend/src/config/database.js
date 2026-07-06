const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL || '';

// Enable SSL for managed Postgres (e.g. Render), which requires it even when
// connecting from a local dev machine. Triggered by any of:
//   - NODE_ENV=production
//   - PGSSL=true (explicit override)
//   - the connection string asks for it (sslmode=require) or targets a
//     known managed host (render.com)
// Local Postgres (no SSL) is the default otherwise.
const useSsl =
  process.env.NODE_ENV === 'production' ||
  process.env.PGSSL === 'true' ||
  /sslmode=require/i.test(dbUrl) ||
  /render\.com/i.test(dbUrl);

const pool = new Pool({
  connectionString: dbUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  // Run a set of statements inside a single transaction.
  async withTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
