import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// specs/deposit-blocks-the-dates.md rule 10 — the client no longer names the payment type. It used to
// post `{ type: 'deposit' }`, which on a last-minute devis (no acompte) asked for a 0 € link the API
// refuses. The server now resolves it from the record and says which type it sent.

describe('api.sendPaymentRequestEmail', () => {
  let fetchMock;
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sent: true, type: 'full', amountCents: 43600, recipientEmail: 'jean@x.fr' }),
    }));
    global.fetch = fetchMock;
  });

  afterEach(() => { global.fetch = originalFetch; });

  test('posts no payment type — the decision belongs to the server', async () => {
    const api = (await import('../api')).default;
    await api.sendPaymentRequestEmail(42);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/payments/reservations/42/payment-emails');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({});
  });

  test('relays the type the server answers, so the UI can name what it sent', async () => {
    const api = (await import('../api')).default;
    const r = await api.sendPaymentRequestEmail(42);
    expect(r.type).toBe('full');
    expect(r.amountCents).toBe(43600);
  });
});
