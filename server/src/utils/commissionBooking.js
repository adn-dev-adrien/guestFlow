/**
 * How a platform's commission is booked, in one sentence the « Paiement plateforme » block prints
 * (specs/platforms/platform-host-statement-and-commission-vat.md rule 10):
 *   « 78,00 € TTC = 65,00 € HT + 13,00 € de TVA déductible · compte 62260500 »            (France)
 *   « 124,78 € · UE, TVA autoliquidée 24,96 € · compte 62260300 »                         (UE)
 *   « 61,00 € · sans TVA · compte 62260600 »                                              (sans TVA)
 * The regime and the account are the platform row's; the VAT rate and the default account are the accounting export's settings — the sentence
 * exists only while that plugin is live (without it nothing is booked), and is `null` without a commission.
 */
const { roundMoneyStrict: round2 } = require('./pricing/money');
const { netFirst, ttcFromNet } = require('./pricing/vat');
const { formatEuros } = require('./reservationLedger');

const PLUGIN_ID = 'accounting-export';

function settingsOf(db) {
  const stored = new Map();
  try {
    db.prepare('SELECT key, value FROM plugin_settings WHERE plugin_id = ?').all(PLUGIN_ID).forEach((r) => stored.set(r.key, r.value));
  } catch (_) { /* no store: the defaults */ }
  const rate = Number(String(stored.get('vatRateCommission') ?? '20').replace(',', '.'));
  return { rate: Number.isFinite(rate) ? rate : 20, defaultAccount: String(stored.get('defaultCommissionAccountNumber') || '622600') };
}

function commissionBookingSentence({ db, platformRow, commission, live = null }) {
  const total = round2(Number(commission) || 0);
  if (!(total > 0) || !platformRow) return null;
  const isLive = live == null ? require('../plugins/sdk/registry').isLive(PLUGIN_ID) : live;
  if (!isLive) return null;
  const { rate, defaultAccount } = settingsOf(db);
  const account = platformRow.commissionAccountNumber || defaultAccount;
  const regime = platformRow.commissionVatRegime;
  if (regime === 'fr_vat') {
    const ht = round2(netFirst(total, rate).net);
    return `${formatEuros(total)} TTC = ${formatEuros(ht)} HT + ${formatEuros(round2(total - ht))} de TVA déductible · compte ${account}`;
  }
  if (regime === 'eu_reverse_charge') {
    return `${formatEuros(total)} · UE, TVA autoliquidée ${formatEuros(round2(ttcFromNet(total, rate) - total))} · compte ${account}`;
  }
  return `${formatEuros(total)} · sans TVA · compte ${account}`;
}

module.exports = { commissionBookingSentence };
