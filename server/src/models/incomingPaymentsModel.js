// « Versements à venir » (specs/mollie-rolling-reserve-and-incoming-payments.md rules 21-27) — the DB reads of the sums
// still to arrive on the bank: the unpaid instalments of direct payment plans, the platform payouts that are due, and
// whatever the live plugins expect (`ctx.incomingPayments`). The grouping, the states and the words are
// `utils/incomingPayments.js`; this model only gathers.

const { round2 } = require('../utils/paymentStatus');
const { buildIncoming } = require('../utils/incomingPayments');
const pluginIncoming = require('../utils/pluginIncomingPayments');
const { platformPenalty } = require('../utils/reservationSettlement');
const { normalizePayoutDueDays, DEFAULT_PAYOUT_DUE_DAYS } = require('../utils/platformPayout');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { platformDisplayName } = require('../utils/attributionChannel');

const RECENT_DAYS = 30;
const frShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const RECEIVED_BY_BANK = ['transfer', 'cheque'];

function buildModel(database) {
  const hasTable = (name) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

  const payoutDueDaysOf = (() => {
    const cache = new Map();
    return (platform) => {
      const key = String(platform || '').toLowerCase();
      if (!cache.has(key)) {
        try { cache.set(key, require('./platformsModel').create(database).getPayoutDueDays(platform)); } catch { cache.set(key, DEFAULT_PAYOUT_DUE_DAYS); }
      }
      return cache.get(key);
    };
  })();

  const columnsOf = (table) => new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  // A database without the stay columns these reads need (a bare schema) has nothing to expect.
  const hasColumns = (table, names) => { const have = columnsOf(table); return names.every((n) => have.has(n)); };
  const STAY_COLUMNS = ['kind', 'cancelledAt', 'platform', 'endDate', 'balanceAmount', 'balancePaid', 'balancePaidDate', 'platformPayoutAmount', 'platformCommissionAmount', 'installmentsTarget', 'installmentsPaidAmount'];

  // Rule 23 — an unpaid instalment of a direct plan, on its due date; a paid one, on the day it was received.
  function installmentItems({ recent, since }) {
    if (!hasTable('reservation_installments') || !hasColumns('reservations', STAY_COLUMNS)) return [];
    const rows = database.prepare(`
      SELECT i.id, i.reservationId, i.number, i.amountCents, i.dueDate, i.paid, i.paidDate, i.paidMethod,
             (SELECT COUNT(*) FROM reservation_installments a WHERE a.reservationId = i.reservationId) AS count
        FROM reservation_installments i JOIN reservations r ON r.id = i.reservationId
       WHERE COALESCE(r.kind, 'reservation') = 'reservation' AND r.cancelledAt IS NULL
         AND ${recent
    ? `i.paid = 1 AND i.paidDate >= ? AND i.paidMethod IN (${RECEIVED_BY_BANK.map(() => '?').join(',')})`
    : 'i.paid = 0 AND NOT (r.installmentsTarget > 0 AND r.installmentsPaidAmount >= r.installmentsTarget)'}
       ORDER BY i.reservationId, i.number`).all(...(recent ? [since, ...RECEIVED_BY_BANK] : []));
    return rows.map((i) => ({
      key: `installment:${i.id}`, kind: 'installment', kindLabel: 'Échéance', icon: 'calendar',
      natureLabel: `Échéance ${i.number} sur ${i.count}`, natureDetail: 'Paiement en plusieurs fois',
      reservationId: i.reservationId, amountCents: Number(i.amountCents), expectedDate: i.dueDate,
      receivedDate: i.paid ? i.paidDate : null,
    }));
  }

  // Rule 23 — a platform's payout once the guest has left: its derived due date (payout delay after the departure).
  function payoutItems({ recent, since, today }) {
    if (!hasColumns('reservations', STAY_COLUMNS)) return [];
    const rows = database.prepare(`
      SELECT r.* FROM reservations r
       WHERE COALESCE(r.kind, 'reservation') = 'reservation' AND r.cancelledAt IS NULL
         AND LOWER(COALESCE(r.platform, 'direct')) <> 'direct' AND r.endDate <= ?
         AND ${recent ? 'r.balancePaid = 1 AND r.balancePaidDate >= ?' : 'COALESCE(r.balancePaid, 0) = 0'}
       ORDER BY r.endDate, r.id`).all(...(recent ? [today, since] : [today]));
    return rows.flatMap((r) => {
      const balance = round2(r.balanceAmount);
      const recorded = Number(r.platformPayoutAmount) > 0;
      const payout = recorded ? round2(r.platformPayoutAmount) : round2(Math.max(0, balance - Number(r.platformCommissionAmount || 0) - platformPenalty(r)));
      const due = addDaysToIsoDate(String(r.endDate).slice(0, 10), normalizePayoutDueDays(payoutDueDaysOf(r.platform)));
      if (!(payout > 0) || !due) return [];
      const received = Boolean(r.balancePaid);
      return [{
        key: `payout:${r.id}`, kind: 'platformPayout', kindLabel: 'Versement plateforme', icon: 'house',
        natureLabel: `Versement plateforme · ${platformDisplayName(r.platform)}`,
        natureDetail: recorded ? `Séjour du ${frShort(String(r.startDate).slice(0, 10))} au ${frShort(String(r.endDate).slice(0, 10))}` : 'Montant estimé : versement non saisi sur la fiche',
        reservationId: r.id, amountCents: Math.round(payout * 100), expectedDate: due,
        receivedDate: received ? String(r.balancePaidDate || due).slice(0, 10) : null,
      }];
    });
  }

  function staysOf(items) {
    const ids = [...new Set(items.filter((i) => !i.sale).map((i) => Number(i.reservationId)))];
    if (ids.length === 0) return new Map();
    const rows = database.prepare(`
      SELECT r.id, r.clientId, r.startDate, r.endDate, c.firstName, c.lastName, p.name AS propertyName
        FROM reservations r LEFT JOIN clients c ON c.id = r.clientId LEFT JOIN properties p ON p.id = r.propertyId
       WHERE r.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    return new Map(rows.map((r) => {
      const start = String(r.startDate).slice(0, 10);
      const end = String(r.endDate).slice(0, 10);
      return [r.id, {
        reservationId: r.id, clientId: r.clientId, clientName: [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || `Réservation ${r.id}`,
        label: `${r.propertyName ? `${r.propertyName} · ` : ''}${frShort(start)} → ${frShort(end)}/${end.slice(0, 4)}`, startDate: start, endDate: end,
      }];
    }));
  }

  return {
    /** The whole page: the core's kinds and the live plugins', grouped by client. `recent` lists the last 30 days' receipts. */
    get({ today, recent = false }) {
      const since = addDaysToIsoDate(today, -RECENT_DAYS);
      const items = [
        ...installmentItems({ recent, since }),
        ...payoutItems({ recent, since, today }),
        ...pluginIncoming.list({ recent }),
      ];
      return buildIncoming({ items, stays: staysOf(items), today, recent });
    },
  };
}

module.exports = { buildModel };
