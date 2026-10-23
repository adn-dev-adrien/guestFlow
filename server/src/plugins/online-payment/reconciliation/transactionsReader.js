/**
 * Reads the account's credits from Qonto into the plugin's table (specs/qonto-bank-reconciliation.md
 * rules 3–7). Every Qonto call goes through `withQonto`, so the outcome is recorded like the rest of
 * the Qonto health; a failure leaves what is stored untouched and is kept for the page to word.
 */

const MS_DAY = 24 * 60 * 60 * 1000;
const MAX_PAGES = 60;

const isoDay = (d) => d.toISOString().slice(0, 10);

/** Rule 5 — the first read goes back 13 months before the start date. */
function firstReadFrom(startDate) {
  const [y, m, d] = startDate.split('-').map(Number);
  // « 13 months before » clamps to the end of a shorter month instead of rolling into the next one.
  const target = new Date(Date.UTC(y, m - 1 - 13, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return `${isoDay(target)}T00:00:00.000Z`;
}

/**
 * @param {object} deps
 * @param {Function} deps.withQonto   `(fn) → Promise` — runs `fn(client, accessToken)` on a valid token
 * @param {object} deps.model         bankTransactionsModel
 * @param {{ get(key): string, set(key, value): void }} deps.settings  the plugin's reconciliation settings
 * @param {() => Date} [deps.now]
 * @param {string} startDate          `YYYY-MM-DD`, the reconciliation start date
 * @returns {Promise<{ ok: boolean, read: number, bankAccountId: string|null, error?: string }>}
 */
async function readTransactions({ withQonto, model, settings, now = () => new Date(), startDate }) {
  const startedAt = now();
  try {
    const result = await withQonto(async (client, accessToken) => {
      let bankAccountId = settings.get('reconciliationBankAccountId');
      if (!bankAccountId) {
        const accounts = await client.listBankAccounts({ accessToken });
        const main = accounts.find((a) => a.main) || accounts[0];
        if (!main) throw new Error('Aucun compte bancaire trouvé chez Qonto.');
        bankAccountId = main.id;
        settings.set('reconciliationBankAccountId', bankAccountId);
      }
      const lastReadAt = settings.get('reconciliationLastReadAt');
      const incremental = Boolean(lastReadAt) && model.count() > 0;
      const params = incremental
        ? { updatedFrom: new Date(Date.parse(lastReadAt) - MS_DAY).toISOString() }
        : { settledFrom: firstReadFrom(startDate) };
      let page = 1;
      let read = 0;
      while (page && page <= MAX_PAGES) {
        // eslint-disable-next-line no-await-in-loop
        const batch = await client.listTransactions({ accessToken, bankAccountId, ...params, page });
        const credits = batch.transactions.filter((t) => t.side === 'credit' && t.status === 'completed');
        read += model.upsertMany(credits, { bankAccountId, source: 'qonto', now: startedAt });
        page = batch.nextPage;
      }
      // Stopping at the cap would leave older credits unread while `lastReadAt` moves on: fail loudly instead.
      if (page) throw new Error('Trop de transactions à lire : réduire la date de mise en service.');
      return { read, bankAccountId };
    });
    settings.set('reconciliationLastReadAt', startedAt.toISOString());
    settings.set('reconciliationLastError', '');
    return { ok: true, ...result };
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 300);
    settings.set('reconciliationLastError', JSON.stringify({ at: startedAt.toISOString(), message }));
    return { ok: false, read: 0, bankAccountId: null, error: message };
  }
}

module.exports = { readTransactions, firstReadFrom };
