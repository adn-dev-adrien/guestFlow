/**
 * The franchise-threshold follow-up of the Suivi financier (specs/vat-optional-mode.md rules 35-44).
 *
 * Read-only: it composes the payments ledger of « Encaissé » (financeDashboardModel.paymentsLedger),
 * the stay's own tourist-tax share (financeModel `htAmount`) and the expected dates of the unpaid
 * buckets, and answers one ready-to-render payload. Nothing is stored besides the threshold the
 * operator types (settingsModel).
 */

const db = require('../database');
const financeModel = require('./financeModel');
const dashboardModel = require('./financeDashboardModel');
const platformsModel = require('./platformsModel');
const vatRegimeModel = require('./vatRegimeModel');
const rules = require('../utils/vatFranchise');
const { DEFAULT_PAYOUT_DUE_DAYS, normalizePayoutDueDays } = require('../utils/platformPayout');
const { todayIso } = require('../utils/localDate');

const SETTINGS_PATH = '/settings/tva-exercice';
const ratioOf = (value, whole) => (whole > 0 ? Math.round((value / whole) * 10000) / 10000 : null);

function createModel(database) {
  const finance = financeModel.buildModel(database);
  const ledger = dashboardModel.buildModel(database).paymentsLedger;

  // A platform's payout delay; a schema without the platforms table answers the default one.
  const payoutDaysOf = (platform) => {
    try { return normalizePayoutDueDays(platformsModel.create(database).getPayoutDueDays(platform)); }
    catch { return DEFAULT_PAYOUT_DUE_DAYS; }
  };

  const storedThreshold = () => {
    try { return database.prepare('SELECT vatFranchiseThreshold AS amount, vatFranchiseThresholdSetAt AS setAt FROM app_settings WHERE id = 1').get() || {}; }
    catch { return {}; }
  };

  const hasTable = (name) => {
    try { return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) != null; }
    catch { return false; }
  };

  const unpaidInstallments = () => {
    const byStay = new Map();
    if (!hasTable('reservation_installments')) return byStay;
    for (const row of database.prepare('SELECT reservationId, dueDate, amountCents FROM reservation_installments WHERE paid = 0').all()) {
      const list = byStay.get(row.reservationId) || [];
      list.push(row);
      byStay.set(row.reservationId, list);
    }
    return byStay;
  };

  const receivedCompensations = () => (hasTable('cancellation_compensations')
    ? database.prepare("SELECT reservationId, receivedAmount AS amount, SUBSTR(receivedDate, 1, 10) AS date FROM cancellation_compensations WHERE status = 'received'").all()
    : []);

  const pendingCompensations = () => (hasTable('cancellation_compensations')
    ? database.prepare("SELECT expectedAmount AS amount, SUBSTR(expectedDate, 1, 10) AS date FROM cancellation_compensations WHERE status = 'pending'").all()
    : []);

  /** Rule 37 — a payment's turnover: its HT share at the rate of the period its stay was sold under. */
  const shareOf = (stays) => {
    const byId = new Map(stays.map((s) => [s.id, s]));
    const rates = new Map();
    return (reservationId, amount) => {
      const stay = byId.get(reservationId);
      if (!stay) return amount;
      if (!rates.has(reservationId)) rates.set(reservationId, vatRegimeModel.forRow(database, stay).rate);
      return financeModel.helpers.htAmount(stay, amount, rates.get(reservationId));
    };
  };

  function getFollowUp({ today = todayIso() } = {}) {
    if (!rules.franchiseApplies(vatRegimeModel.inForceBlock(database))) return { applies: false };

    const year = Number(today.slice(0, 4));
    const stays = finance.getLedgerStays();
    const share = shareOf(stays);
    const rows = ledger(stays, { withCommission: true });
    const compensations = receivedCompensations();
    const collectedIn = (y) => rules.turnoverOf({ rows, compensations, from: `${y}-01-01`, to: `${y}-12-31`, share });

    const collected = collectedIn(year);
    const installments = unpaidInstallments();
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const expected = stays
      .filter((s) => s.kind === 'reservation')
      .reduce((sum, stay) => sum + rules.expectedOf({
        stay,
        installments: installments.get(stay.id),
        isPlatform: dashboardModel.isPlatformStay(stay),
        payoutDays: payoutDaysOf(stay.platform),
        yearStart,
        yearEnd,
        share,
      }), 0) + rules.expectedCompensationsOf({ compensations: pendingCompensations(), from: yearStart, to: yearEnd });
    const projected = Math.round((collected + expected) * 100) / 100;

    const stored = storedThreshold();
    const threshold = stored.amount == null ? null : Number(stored.amount);
    const level = rules.levelOf({ collected, projected, threshold });

    const previous = year - 1;
    const hasPrevious = stays.some((s) => String(s.startDate).startsWith(String(previous)))
      || rows.some((r) => String(r.date).startsWith(String(previous)));

    return {
      applies: true,
      year,
      asOf: today,
      threshold,
      thresholdSetAt: threshold == null ? null : (stored.setAt || null),
      collected,
      projected,
      ratio: threshold == null ? null : ratioOf(collected, threshold),
      projectedRatio: threshold == null ? null : ratioOf(projected, threshold),
      level,
      ...rules.wordsOf({ level, collected, projected, threshold, settingsPath: SETTINGS_PATH }),
      previousYear: hasPrevious ? { year: previous, collected: collectedIn(previous) } : null,
      settingsPath: SETTINGS_PATH,
    };
  }

  return { getFollowUp };
}

const defaultModel = createModel(db);
defaultModel.buildModel = createModel;

module.exports = defaultModel;
