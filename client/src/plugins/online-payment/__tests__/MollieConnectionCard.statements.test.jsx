// specs/mollie-settlement-receipts.md rules 2-3, 13 — the « Relevés dans Qonto » section of the Mollie card: drawn only when the
// server says the feature exists, a switch that proposes the first day of the month, a date that refuses the future,
// the counters and the reconnect hint.
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DialogProvider from '../../../components/DialogProvider';
import MollieConnectionCard from '../MollieConnectionCard';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getPluginSettings: vi.fn(), savePluginSettings: vi.fn(), testMollieConnection: vi.fn(),
    getMollieStatementsStatus: vi.fn(), getToday: vi.fn(),
  },
}));
import api from '../../../api';

const TODAY = '2026-11-17'; // date-literal-ok: the server's day is injected through api.getToday, nothing reads the real clock
const BASE = { mollieAccessTokenSet: true, mollieProfileId: 'pfl_abc', mollieLastRead: '', mollieLastError: '', mollieBalance: '' };
const status = (over = {}) => ({ available: true, since: '', counts: { attached: 0, pending: 0, toReview: 0 }, reauth: false, ...over });
const renderCard = () => render(<DialogProvider><MollieConnectionCard /></DialogProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getToday.mockResolvedValue({ today: TODAY });
  api.savePluginSettings.mockResolvedValue({});
});

test('rule 2: without Qonto or without a token the server says unavailable and the section is not drawn', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '' });
  api.getMollieStatementsStatus.mockResolvedValue(status({ available: false }));
  renderCard();
  await screen.findByText('Compte Mollie');
  expect(screen.queryByText('Relevés dans Qonto')).not.toBeInTheDocument();
});

test('rule 3: switched off by default; turning it on proposes the first day of the current month and saves it', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '' });
  api.getMollieStatementsStatus.mockResolvedValue(status());
  renderCard();
  const toggle = await screen.findByRole('switch', { name: 'Joindre le relevé de chaque versement Mollie dans Qonto' });
  expect(toggle).not.toBeChecked();
  expect(screen.queryByLabelText('À partir du')).not.toBeInTheDocument();
  await waitFor(() => expect(toggle).not.toBeDisabled());
  await userEvent.click(toggle);
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', { mollieStatementsSince: '2026-11-01' })); // date-literal-ok: first day of the injected month
});

test('rule 3: turning it off saves an empty date', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '2026-11-01' }); // date-literal-ok: stored value shown as given
  api.getMollieStatementsStatus.mockResolvedValue(status({ since: '2026-11-01' })); // date-literal-ok: stored value shown as given
  renderCard();
  const toggle = await screen.findByRole('switch', { name: /Joindre le relevé/ });
  expect(toggle).toBeChecked();
  await waitFor(() => expect(toggle).not.toBeDisabled());
  await userEvent.click(toggle);
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', { mollieStatementsSince: '' }));
});

test('rule 3: a date in the future is refused on the field and nothing is saved; a past date is saved', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '2026-11-01' }); // date-literal-ok: stored value shown as given
  api.getMollieStatementsStatus.mockResolvedValue(status({ since: '2026-11-01' })); // date-literal-ok: stored value shown as given
  renderCard();
  const field = await screen.findByLabelText('À partir du');
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  fireEvent.change(field, { target: { value: '2026-12-25' } }); // date-literal-ok: a day after the injected today
  expect(await screen.findByText('La date ne peut pas être dans le futur.')).toBeInTheDocument();
  expect(api.savePluginSettings).not.toHaveBeenCalled();
  fireEvent.blur(field);
  expect(api.savePluginSettings).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '2026-10-01' } }); // date-literal-ok: a day before the injected today
  fireEvent.blur(field);
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', { mollieStatementsSince: '2026-10-01' })); // date-literal-ok: same day
});

test('rule 13: typing a date saves nothing; the blur saves once, and Enter commits as well', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '2026-11-01' }); // date-literal-ok: stored value shown as given
  api.getMollieStatementsStatus.mockResolvedValue(status({ since: '2026-11-01' })); // date-literal-ok: stored value shown as given
  renderCard();
  const field = await screen.findByLabelText('À partir du');
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  fireEvent.change(field, { target: { value: '0002-10-01' } }); // date-literal-ok: what Chromium emits after the first typed year digit
  fireEvent.change(field, { target: { value: '0020-10-01' } }); // date-literal-ok: second typed year digit
  fireEvent.change(field, { target: { value: '2026-10-01' } }); // date-literal-ok: the year as finally typed
  expect(api.savePluginSettings).not.toHaveBeenCalled();
  fireEvent.blur(field);
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledTimes(1));
  expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', { mollieStatementsSince: '2026-10-01' }); // date-literal-ok: the year as finally typed
  fireEvent.change(field, { target: { value: '2026-09-01' } }); // date-literal-ok: another day before the injected today
  fireEvent.keyDown(field, { key: 'Enter' });
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledTimes(2));
});

test('rule 3: saving the date refreshes the section only — a Mollie profile id being typed is kept', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '2026-11-01' }); // date-literal-ok: stored value shown as given
  api.getMollieStatementsStatus.mockResolvedValue(status({ since: '2026-11-01' })); // date-literal-ok: stored value shown as given
  renderCard();
  const field = await screen.findByLabelText('À partir du');
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  const profile = screen.getByDisplayValue('pfl_abc');
  await userEvent.clear(profile);
  await userEvent.type(profile, 'pfl_draft');
  fireEvent.change(field, { target: { value: '2026-10-01' } }); // date-literal-ok: a day before the injected today
  fireEvent.blur(field);
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalled());
  await waitFor(() => expect(api.getMollieStatementsStatus).toHaveBeenCalledTimes(2));
  expect(api.getPluginSettings).toHaveBeenCalledTimes(1);
  expect(screen.getByDisplayValue('pfl_draft')).toBeInTheDocument();
});

test('rule 3: the counters say how many are joined, waiting and to review; the reconnect hint shows when Qonto refuses', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '2026-10-01' }); // date-literal-ok: stored value shown as given
  api.getMollieStatementsStatus.mockResolvedValue(status({ since: '2026-10-01', counts: { attached: 3, pending: 1, toReview: 2 }, reauth: true })); // date-literal-ok: stored value shown as given
  renderCard();
  expect(await screen.findByText('3 joint')).toBeInTheDocument();
  expect(screen.getByText('1 en attente')).toBeInTheDocument();
  expect(screen.getByText('2 à revoir')).toBeInTheDocument();
  expect(screen.getByText('Qonto refuse les pièces jointes : reconnecter Qonto pour joindre les relevés.')).toBeInTheDocument();
});

test('rule 3: no credit since the date says so instead of showing zeros', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '2026-10-01' }); // date-literal-ok: stored value shown as given
  api.getMollieStatementsStatus.mockResolvedValue(status({ since: '2026-10-01' })); // date-literal-ok: stored value shown as given
  renderCard();
  expect(await screen.findByText('Aucun versement depuis cette date')).toBeInTheDocument();
  expect(screen.queryByText('Qonto refuse les pièces jointes : reconnecter Qonto pour joindre les relevés.')).not.toBeInTheDocument();
});

test('rule 13: a calendar pick (change without a key, then the field\'s own blur) saves exactly once', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '2026-11-01' }); // date-literal-ok: stored value shown as given
  api.getMollieStatementsStatus.mockResolvedValue(status({ since: '2026-11-01' })); // date-literal-ok: stored value shown as given
  renderCard();
  const field = await screen.findByLabelText('À partir du');
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  field.focus();
  fireEvent.change(field, { target: { value: '2026-10-05' } }); // date-literal-ok: a day before the injected today, picked in the calendar
  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledTimes(1));
  expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', { mollieStatementsSince: '2026-10-05' }); // date-literal-ok: same day
});

test('rule 13: Enter then the blur before the answer saves once', async () => {
  api.getPluginSettings.mockResolvedValue({ ...BASE, mollieStatementsSince: '2026-11-01' }); // date-literal-ok: stored value shown as given
  api.getMollieStatementsStatus.mockResolvedValue(status({ since: '2026-11-01' })); // date-literal-ok: stored value shown as given
  let answer;
  api.savePluginSettings.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  renderCard();
  const field = await screen.findByLabelText('À partir du');
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  fireEvent.change(field, { target: { value: '2026-10-05' } }); // date-literal-ok: a day before the injected today
  fireEvent.keyDown(field, { key: 'Enter' });
  fireEvent.blur(field);
  answer({});
  await waitFor(() => expect(api.getMollieStatementsStatus).toHaveBeenCalledTimes(2));
  expect(api.savePluginSettings).toHaveBeenCalledTimes(1);
});
