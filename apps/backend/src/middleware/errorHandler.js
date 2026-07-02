// Centralized error handler. Keep responses generic; log details server-side.
function errorHandler(err, req, res, next) {
  console.error(err);
  // Structured field validation errors (from utils/validate).
  if (err.fields) {
    return res.status(err.status || 400).json({
      error: err.message || 'Validation failed',
      fields: err.fields,
    });
  }
  // Postgres unique violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A record with that value already exists' });
  }
  // Postgres foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? err.message || 'Internal server error' : err.message,
    stack: err.stack,
  });
}

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

module.exports = { errorHandler, notFound };
