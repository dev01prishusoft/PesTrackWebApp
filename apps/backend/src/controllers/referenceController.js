const { query } = require('../config/database');

async function getReferences(req, res, next) {
  try {
    const categoriesResult = await query('SELECT id, label, color, sort_order FROM categories ORDER BY sort_order ASC');
    const statusesResult = await query('SELECT id, label, color, emoji, sort_order FROM statuses ORDER BY sort_order ASC');
    const escalationsResult = await query('SELECT id, label, sort_order FROM escalation_options ORDER BY sort_order ASC');

    res.json({
      categories: categoriesResult.rows,
      statuses: statusesResult.rows,
      escalations: escalationsResult.rows,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getReferences,
};
