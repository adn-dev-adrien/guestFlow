// specs/public-online-payment.md rule 7 — POST /booking-requests/:id/pay has its own budget: a guest
// who sends a request then retries the payment is never refused by the booking-request anti-spam
// limiter, and the payment retries stay capped by their own limiter.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

process.env.BOOKING_REQUEST_RATELIMIT_MAX = '2';
process.env.BOOKING_REQUEST_RATELIMIT_WINDOW_MS = '60000';
process.env.PAYMENT_START_RATELIMIT_MAX = '4';
process.env.PAYMENT_START_RATELIMIT_WINDOW_MS = '60000';

function stubModule(relativeFromHere, exports) {
  const file = require.resolve(path.join(__dirname, relativeFromHere));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let server;
let baseUrl;

before(async () => {
  for (const f of ['../../../middleware/rateLimiters', '../routes/bookingRequests']) {
    delete require.cache[require.resolve(path.join(__dirname, f))];
  }
  stubModule('../controllers/publicBookingRequestController', {
    create: (req, res) => res.status(201).json({ data: { id: 1 } }),
  });
  stubModule('../../../controllers/public/publicPaymentController', {
    requireProvider: (req, res, next) => next(),
    pay: (req, res) => res.json({ data: { paymentUrl: 'https://pay.example.com/x' } }),
    status: (req, res) => res.json({ data: { status: 'pending' } }),
  });
  const express = require('express');
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/booking-requests', require('../routes/bookingRequests'));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const post = (p, ip) => fetch(`${baseUrl}${p}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: '{}',
}).then((r) => r.status);

test('sending the request then retrying the payment is not refused by the booking-request limiter', async () => {
  const ip = '10.20.0.1';
  assert.equal(await post('/booking-requests', ip), 201);
  assert.equal(await post('/booking-requests', ip), 201);
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await post('/booking-requests/1/pay', ip), 200, `payment attempt ${i + 1}`);
  }
  assert.equal(await post('/booking-requests', ip), 429, 'the request budget itself is unchanged');
});

test('payment retries keep their own cap', async () => {
  const ip = '10.20.0.2';
  const statuses = [];
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    statuses.push(await post('/booking-requests/1/pay', ip));
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 429]);
  assert.equal(await post('/booking-requests', ip), 201, 'payment retries do not spend the request budget');
});
