const { query } = require('./apps/backend/src/config/database');
async function run() {
  try {
    const { rows } = await query("SELECT action, count(*) FROM audit_logs GROUP BY action;");
    console.log("Actions:", rows);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
