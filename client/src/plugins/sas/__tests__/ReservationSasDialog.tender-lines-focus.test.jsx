// specs/mixed-method-payments.md rule 59 (reading of 2026-11-19, loop t25 UI25-2) — the SAS « Plusieurs moyens » block puts the focus in its
// first amount only when the operator opens it. When it comes back on its own — the next answer after a failed recompute, the departure's
// due back from 0 — the focus stays on the control the operator just used (« ✓ Offert » / « Offrir »), never moved into « Montant Espèces ».
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import {
  arrivalRecap, departureRecap, firstAmount, offerButtons, pause, tenderReady, type10,
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

const press = (control) => { control.focus(); fireEvent.click(control); };
const offeredButtons = () => screen.getAllByRole('button', { name: /Offert$/ });
// After the lines are back, the focus is still on the toggle pressed — the same control, whatever its label now says.
const focusStaysOnToggle = async () => {
  await tenderReady();
  await pause(150);
  const active = document.activeElement;
  expect(active).not.toBe(firstAmount());
  expect(active.tagName).toBe('BUTTON');
  expect(active.textContent).toMatch(/Offrir|Offert/);
};

const ROWS = {
  'arrival — after a failed « Offrir », pressing « ✓ Offert » again (good answer) brings the lines back': async () => {
    const state = {};
    await arrivalRecap(state);
    await type10();
    state.fail = true;
    press(offerButtons()[1]);
    await screen.findByText(/Total indisponible/);
    await waitFor(() => expect(firstAmount()).toBeNull());
    state.fail = false;
    press(offeredButtons()[0]);
    await focusStaysOnToggle();
  },
  'departure — after a failed « Offrir », un-offering the line (good answer) brings the lines back': async () => {
    const state = {};
    await departureRecap(state);
    await type10();
    state.fail = true;
    press(offerButtons()[0]);
    await screen.findByText(/Total indisponible/);
    await waitFor(() => expect(firstAmount()).toBeNull());
    state.fail = false;
    press(offeredButtons()[0]);
    await focusStaysOnToggle();
  },
  'departure — the only line offered (due 0), then un-offered (due back): the lines come back': async () => {
    const state = {};
    await departureRecap(state);
    await type10();
    press(offerButtons()[0]);
    await waitFor(() => expect(firstAmount()).toBeNull());
    press(offeredButtons()[0]);
    await focusStaysOnToggle();
  },
};

beforeEach(() => { vi.clearAllMocks(); });

test.each(Object.keys(ROWS))('%s: the focus stays on the toggle', async (name) => {
  await ROWS[name]();
});

test.each(['arrival', 'departure'])('%s — the operator opening « Plusieurs moyens » puts the focus in the first amount', async (end) => {
  const state = {};
  await (end === 'arrival' ? arrivalRecap(state) : departureRecap(state));
  await tenderReady();
  await waitFor(() => expect(document.activeElement).toBe(firstAmount()));
});
