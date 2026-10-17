/**
 * An error a controller throws for the route to answer as `status` + `{ error, message }`.
 * `send(res, err)` answers it, and lets any other error reach the global error handler.
 */

function httpError(status, error, message, extra = {}) {
  const err = new Error(message || error);
  err.status = status;
  err.body = { error, ...(message ? { message } : {}), ...extra };
  return err;
}

function sendError(res, err, next) {
  if (err && err.body && Number.isInteger(err.status)) return res.status(err.status).json(err.body);
  if (next) return next(err);
  throw err;
}

module.exports = { httpError, sendError };
