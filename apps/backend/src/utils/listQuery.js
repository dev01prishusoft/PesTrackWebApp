/**
 * Helpers for server-side list endpoints: pagination, sorting, searching.
 * Sort columns are validated against a whitelist to prevent SQL injection.
 */

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(10000, Math.max(1, parseInt(query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Returns a safe `ORDER BY col dir` fragment.
 * @param {object} query   req.query
 * @param {string[]} allowed  whitelist of sortable column expressions
 * @param {string} fallback   default column
 */
function parseSort(query, allowed, fallback) {
  const col = allowed.includes(query.sort) ? query.sort : fallback;
  const dir = String(query.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { orderBy: `${col} ${dir}`, sortCol: col, sortDir: dir };
}

function buildResponse({ rows, total, page, limit }) {
  return {
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

module.exports = { parsePagination, parseSort, buildResponse };
