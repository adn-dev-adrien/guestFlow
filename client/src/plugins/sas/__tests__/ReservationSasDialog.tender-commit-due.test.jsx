// specs/payments/mixed-method-payments.md rule 59 (reading of 2026-11-19, loop t25 verifier) — a commit sends the lines' report only while it answers
// the due on screen (`tendersForDue`). Between the recap's new due and the report the lines send for it (one render, an effect later), the
// older report — its amounts and its « Geste commercial » chosen for the older due — is pending: « Encaisser » is never enabled on it, not
// even for a frame, and the commit itself refuses it. Every TenderLines consumer, read from the code, goes through that guard.
import fs from 'fs';
import path from 'path';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../../../api';
import { tendersForDue } from '../../../components/TenderLines';
import {
  arrivalRecap, collectButton, departureLinenRecap, offerButtons, pause, typeShortWithGesture,
} from './sasTenderLinesFixtures';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

test('tendersForDue: the report only for the due it answers, and only while it describes the lines on screen', () => {
  let onScreen = true;
  const report = { dueCents: 1250, canSubmit: true, tenders: [], shortfall: { kind: 'waived' }, live: () => onScreen };
  expect(tendersForDue(report, 1250)).toBe(report);
  expect(tendersForDue(report, 600)).toBeNull();
  expect(tendersForDue(null, 600)).toBeNull();
  expect(tendersForDue({ canSubmit: true, live: () => true }, 600)).toBeNull();
  onScreen = false;
  expect(tendersForDue(report, 1250)).toBeNull();
});

// Every file that mounts TenderLines (directly, or through BookingPaymentFields) reads its report through the due guard.
const SRC = path.resolve(__dirname, '..', '..', '..');
function sourcesOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourcesOf(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}
const CONSUMERS = sourcesOf(SRC)
  .filter((file) => /<(TenderLines|BookingPaymentFields)\b/.test(fs.readFileSync(file, 'utf8')))
  .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
  .sort();
test.each(CONSUMERS)('%s commits the lines only through the due guard', (file) => {
  const source = fs.readFileSync(path.join(SRC, file), 'utf8');
  if (/<BookingPaymentFields\b/.test(source)) expect(source).toMatch(/paymentForDue\(/);
  else if (file.endsWith('BookingPaymentFields.jsx')) expect(source).toMatch(/dueCents: answered, live/);
  // Loop t26 (rule 58) — or through the money-dialog contract, whose `useMoneyCommit` reads the report with `tendersForDue`.
  else expect(source).toMatch(/tendersForDue\(|useMoneyCommit\(/);
  // …and its commit handler asks again, at click time, whether the report still describes the lines on screen.
  if (!file.endsWith('BookingPaymentFields.jsx')) expect(source).toMatch(/\.live\(\)/);
});
test('the consumers read from the code are the known ones', () => {
  expect(CONSUMERS).toEqual([
    'components/StandaloneSaleDialog.jsx',
    'components/reservation/FinanceSection.jsx',
    'components/reservation/MidStayNoteDialog.jsx',
    'components/reservation/PaymentMarkForm.jsx',
    'plugins/hourly-resources/BookingPaymentFields.jsx',
    'plugins/hourly-resources/ResourceArrivalDialog.jsx',
    'plugins/hourly-resources/ResourceBookingDialog.jsx',
    'plugins/sas/ReservationSasDialog.jsx',
  ]);
});

// The SAS, both ends: lines typed short, « Geste commercial » chosen (« Encaisser » on); « Offrir » moves the due while the lines stay
// mounted. A MutationObserver records every change of the button's `disabled` attribute while the new answer lands: it is never removed
// (the button never turns enabled on the older report), nothing is sent, and while the report is pending its label names the new due —
// never « — », never an older report's amount — then what the lines collect for it.
const ENDS = {
  arrival: { open: arrivalRecap, offer: () => offerButtons()[1], commit: () => api.commitArrivalSas },
  departure: { open: departureLinenRecap, offer: () => offerButtons()[1], commit: () => api.commitDepartureSas },
};
test.each(Object.keys(ENDS))('%s — after the due moves, « Encaisser » is never enabled on the older report', async (end) => {
  const state = {};
  await ENDS[end].open(state);
  await typeShortWithGesture();
  const button = collectButton();
  expect(button).toBeEnabled();
  // Every « disabled » attribute change of the button, with its previous value: a removal (old value present) is a moment it was enabled.
  const enabledAt = [];
  // Loop t25 — and every label it shows: none names an amount the lines have not reported for the new due.
  const labels = [];
  const observer = new MutationObserver((records) => records.forEach((r) => {
    if (r.target === button && r.attributeName === 'disabled' && r.oldValue !== null) enabledAt.push(r.oldValue);
    // A text node's previous value, or a removed node's text: every label the button held, even for one commit.
    if (r.type === 'characterData') labels.push(r.oldValue);
    if (r.type === 'childList') r.removedNodes.forEach((n) => labels.push(n.textContent));
  }));
  observer.observe(button, {
    attributes: true, attributeFilter: ['disabled'], attributeOldValue: true, childList: true, subtree: true, characterData: true, characterDataOldValue: true,
  });
  await act(async () => { fireEvent.click(ENDS[end].offer()); });
  await waitFor(() => expect(button).toBeDisabled());
  await act(async () => { await pause(400); });
  observer.disconnect();
  expect(button.isConnected).toBe(true);
  expect(enabledAt).toEqual([]);
  expect(button).toBeDisabled();
  // The labels after the due moved: never « — » (the due is known), never an amount but the new due and what the lines then collect.
  const final = button.textContent;
  const meter = document.body.textContent.match(/(\d[\d\s]*,\d\d)\s*€\s*non couverts/);
  const cents = (text) => Math.round(Number(text.replace(/[^\d,]/g, '').replace(',', '.')) * 100);
  const newDue = cents(final) + cents(meter[1]);
  const after = labels.slice(1).filter((l) => /^Encaisser/.test(l) && l !== labels[0]);
  expect(after.filter((l) => /—/.test(l))).toEqual([]);
  after.forEach((l) => expect([newDue, cents(final)]).toContain(cents(l)));
  // Right after the change, before the lines report: the new due, on a disabled button.
  expect(after.map(cents)).toContain(newDue);
  expect(ENDS[end].commit()).not.toHaveBeenCalled();
});
