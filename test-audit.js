const { query } = require('./apps/backend/src/config/database');
async function test() {
  const { rows } = await query("SELECT action, table_name, record_id FROM audit_logs WHERE action = 'DELETE' ORDER BY created_at DESC LIMIT 5");
  console.log(rows);
  process.exit(0);
}
test();
