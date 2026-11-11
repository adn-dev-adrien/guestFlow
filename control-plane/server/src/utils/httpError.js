/** An error a route turns into `{ error, message }` with its status; the message is French, for the screen. */

function httpError(status, error, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.body = { error, message, ...extra };
  return err;
}

module.exports = { httpError };
