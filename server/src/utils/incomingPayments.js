/**
 * « Versements à venir » (specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 21-27): every sum still to arrive
 * on the bank account — or, with `recent`, arrived in the last 30 days — grouped by client, with the words of its state.
 *
 * Pure: normalised items × the stays they belong to → the payload of the page, the tile and the detail table. Every
 * date, state, label and total is decided here; the client draws them (rule 26).
 *
 * Item: `{ key, kind, kindLabel, icon, natureLabel, natureDetail, reservationId, sale, amountCents, expectedDate,
 *          receivedDate, late, refs }` — `late` is the provider's word when it has one (a Mollie tranche past its window),
 *          else the expected date decides. `sale` (`{ key, clientName, label }`, `reservationId` null) is a sale made
 *          outside any stay: it has no fiche, it groups under its client (a stay's client of the same name, else a
 *          group of its own), or under its label when it names none.
 * Stay:  `{ reservationId, clientId, clientName, label, startDate, endDate }`.
 */

const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MS_DAY = 86400000;
const KIND_ORDER = ['mollieReserve', 'mollieTransit', 'installment', 'platformPayout'];

const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_DAY);
const frShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const withWeekday = (iso) => `${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${frShort(iso)}`;

/** « Aujourd'hui », « Dans 3 jours », « Dans 2 mois », « En retard de 12 j », « Reçu le 30/10 ». */
function stateOf(item, today) {
  if (item.receivedDate) return { state: 'received', stateLabel: `Reçu le ${frShort(item.receivedDate)}`, tone: 'success' };
  const days = dayNumber(item.expectedDate) - dayNumber(today);
  if (item.late === true || (item.late == null && days < 0)) {
    const behind = Math.max(1, -days);
    return { state: 'late', stateLabel: `En retard de ${behind} j`, tone: 'error' };
  }
  if (days < 0) return { state: 'upcoming', stateLabel: `Attendu depuis ${-days} j`, tone: 'neutral' };
  if (days === 0) return { state: 'upcoming', stateLabel: 'Aujourd\'hui', tone: 'neutral' };
  if (days === 1) return { state: 'upcoming', stateLabel: 'Demain', tone: 'neutral' };
  if (days <= 31) return { state: 'upcoming', stateLabel: `Dans ${days} jours`, tone: 'neutral' };
  return { state: 'upcoming', stateLabel: `Dans ${Math.round(days / 30)} mois`, tone: 'neutral' };
}

const { fromCentsRounded: euros2 } = require('./pricing/money');

/**
 * @param {{ items: object[], stays: Map<number, object>, today: string, recent?: boolean }} p
 * @returns {{ totals: object, kinds: object[], clients: object[] }}
 */
function buildIncoming({ items, stays, today, recent = false }) {
  const lines = items.filter((i) => i.amountCents > 0 && i.expectedDate && (i.sale || stays.has(Number(i.reservationId)))).map((i) => {
    const found = stateOf(i, today);
    const shown = i.receivedDate || i.expectedDate;
    return {
      key: i.key, kind: i.kind, label: i.kindLabel, icon: i.icon, natureLabel: i.natureLabel, natureDetail: i.natureDetail || '',
      amountCents: Math.round(i.amountCents), expectedDate: i.expectedDate, receivedDate: i.receivedDate || null,
      dateLabel: withWeekday(shown), ...found,
      refs: { qonto: null, mollieSettlement: null, molliePayment: null, ...(i.refs || {}) },
      reservationId: i.sale ? null : Number(i.reservationId), sale: i.sale || null,
    };
  }).filter((l) => (recent ? l.state === 'received' : l.state !== 'received'));

  const order = (a, b) => (recent
    ? String(b.receivedDate).localeCompare(String(a.receivedDate))
    : (b.state === 'late') - (a.state === 'late') || a.expectedDate.localeCompare(b.expectedDate) || a.key.localeCompare(b.key));

  const byClient = new Map();
  const nameOf = (name) => String(name || '').trim().toLowerCase();
  const clientKeyByName = new Map();
  const place = (line, clientKey, base, stayKey, stay) => {
    const client = byClient.get(clientKey) || { ...base, key: clientKey, stays: new Map() };
    const here = client.stays.get(stayKey) || { ...stay, items: [] };
    const { reservationId, sale, ...item } = line;
    here.items.push(item);
    client.stays.set(stayKey, here);
    byClient.set(clientKey, client);
  };
  lines.filter((l) => !l.sale).forEach((line) => {
    const stay = stays.get(line.reservationId);
    const clientKey = stay.clientId != null ? `c${stay.clientId}` : `r${stay.reservationId}`;
    if (!clientKeyByName.has(nameOf(stay.clientName))) clientKeyByName.set(nameOf(stay.clientName), clientKey);
    place(line, clientKey, { clientId: stay.clientId == null ? null : Number(stay.clientId), name: stay.clientName }, line.reservationId,
      { reservationId: line.reservationId, saleKey: null, label: stay.label, startDate: stay.startDate, endDate: stay.endDate });
  });
  lines.filter((l) => l.sale).forEach((line) => {
    const { sale } = line;
    const name = sale.clientName || sale.label;
    const key = nameOf(name);
    const clientKey = (sale.clientName && clientKeyByName.get(key)) || `${sale.clientName ? 'n' : 'l'}:${key}`;
    place(line, clientKey, { clientId: null, name }, `sale:${sale.key}`,
      { reservationId: null, saleKey: String(sale.key), label: sale.label, startDate: null, endDate: null });
  });

  const clients = [...byClient.values()].map((client) => {
    const stayList = [...client.stays.values()].map((s) => ({ ...s, items: s.items.sort(order) }))
      .sort((a, b) => order(a.items[0], b.items[0]));
    const all = stayList.flatMap((s) => s.items);
    const dates = all.map((i) => i.expectedDate).sort();
    return {
      key: client.key, clientId: client.clientId, name: client.name, totalCents: all.reduce((t, i) => t + i.amountCents, 0),
      nextDate: recent ? null : dates[0], nextDateLabel: recent || !dates[0] ? null : withWeekday(dates[0]),
      late: all.some((i) => i.state === 'late'), stays: stayList,
    };
  }).sort((a, b) => (recent ? 0 : (b.late - a.late) || String(a.nextDate).localeCompare(String(b.nextDate))) || a.name.localeCompare(b.name));
  if (recent) clients.sort((a, b) => String(b.stays[0].items[0].receivedDate).localeCompare(String(a.stays[0].items[0].receivedDate)));

  const labelOf = new Map(lines.map((l) => [l.kind, l.label]));
  const kinds = KIND_ORDER.concat([...labelOf.keys()].filter((k) => !KIND_ORDER.includes(k)))
    .filter((key) => labelOf.has(key))
    .map((key) => ({ key, label: labelOf.get(key), count: lines.filter((l) => l.kind === key).length }));
  const totalCents = lines.reduce((t, l) => t + l.amountCents, 0);
  const nextDate = recent ? null : lines.map((l) => l.expectedDate).sort()[0] || null;
  return {
    totals: { amount: euros2(totalCents), amountCents: totalCents, clients: clients.length, nextDate, nextDateLabel: nextDate ? withWeekday(nextDate) : null },
    kinds, clients,
  };
}

module.exports = { buildIncoming, stateOf, KIND_ORDER };
