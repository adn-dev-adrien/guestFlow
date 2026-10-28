// specs/vat-optional-mode.md §6.1 — the « TVA » card of Paramètres › TVA & exercice: the badge of the
// regime in force, the rate under VAT or the legal mention without, the dated history with its tags, and
// « Annuler ce changement » only where the server says a period is deletable.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import SettingsVatSection from '../SettingsVatSection';

const MENTIONS = [
  { key: 'art_293_b', label: 'TVA non applicable, art. 293 B du CGI', short: 'Franchise en base — art. 293 B' },
  { key: 'art_261_d_4', label: 'Exonération de TVA, art. 261 D 4° du CGI', short: 'Location meublée exonérée — art. 261 D 4°' },
];
const INITIAL = { id: 1, regime: 'subject', rate: 10, basis: 'all', label: 'Depuis toujours', createdByName: '', createdAt: '2026-01-02 10:00:00', createdAtDay: '2026-01-02', initial: true, reservations: 58, deletable: false, scheduled: false, correction: false };
const SCHEDULED = { id: 2, regime: 'not_subject', rate: 0, basis: 'booking', label: 'Depuis le 01/01/2027 · réservations prises à partir de cette date', createdByName: 'Adrien Jouve', createdAt: '2026-10-28 09:00:00', createdAtDay: '2026-10-28', reservations: 0, deletable: true, scheduled: true, correction: false };
const CORRECTION = { id: 3, regime: 'subject', rate: 10, basis: 'all', label: 'Toutes les réservations (correction)', createdByName: 'Adrien Jouve', createdAt: '2026-10-29 09:00:00', reservations: 58, deletable: false, scheduled: false, correction: true };

const draw = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <SettingsVatSection
      values={{ regime: 'subject', rate: 10, legalMention: null }}
      onChange={() => {}}
      regime={{ inForce: INITIAL, periods: [INITIAL], mentions: MENTIONS }}
      onSwitch={() => {}}
      onUndo={() => {}}
      {...props}
    />
  </ThemeProvider>,
);

test('under VAT: the badge says « Assujetti · 10 % » and the rate is asked, no mention', () => {
  draw();
  expect(screen.getByText('Assujetti · 10 %', { selector: '.MuiChip-label' })).toBeInTheDocument();
  expect(screen.getByLabelText('Taux de TVA (%)')).toHaveValue(10);
  expect(screen.queryByLabelText('Mention légale')).not.toBeInTheDocument();
});

test('under VAT: editing the rate reports it to the page, which saves it with its own Save', async () => {
  const onChange = vi.fn();
  draw({ onChange });
  await userEvent.type(screen.getByLabelText('Taux de TVA (%)'), '5');
  expect(onChange).toHaveBeenCalledWith('rate', 105);
});

test('without VAT: the badge says « Sans TVA » and the legal mention is chosen, no rate', () => {
  const current = { ...SCHEDULED, scheduled: false, deletable: false };
  draw({ values: { regime: 'not_subject', rate: 0, legalMention: 'art_293_b' }, regime: { inForce: current, periods: [current, INITIAL], mentions: MENTIONS } });
  expect(screen.getByText('Sans TVA', { selector: '.MuiChip-label' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Taux de TVA (%)')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Mention légale')).toBeInTheDocument();
  expect(screen.getByText(/Imprimée sur les devis : « TVA non applicable, art. 293 B du CGI »/)).toBeInTheDocument();
});

test('without VAT: picking the other mention reports it', async () => {
  const onChange = vi.fn();
  const current = { ...SCHEDULED, scheduled: false, deletable: false };
  draw({ onChange, values: { regime: 'not_subject', rate: 0, legalMention: 'art_293_b' }, regime: { inForce: current, periods: [current, INITIAL], mentions: MENTIONS } });
  await userEvent.click(screen.getByLabelText('Mention légale'));
  await userEvent.click(await screen.findByRole('option', { name: /261 D 4°/ }));
  expect(onChange).toHaveBeenCalledWith('legalMention', 'art_261_d_4');
});

test('the history lists the periods newest first with the server\'s sentences and tags', () => {
  draw({ regime: { inForce: INITIAL, periods: [CORRECTION, SCHEDULED, INITIAL], mentions: MENTIONS } });
  const items = within(screen.getByRole('list', { name: 'Historique' })).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(within(items[0]).getByText('Correction')).toBeInTheDocument();
  expect(within(items[1]).getByText('Prévu')).toBeInTheDocument();
  expect(within(items[1]).getByText(/Depuis le 01\/01\/2027 · réservations prises à partir de cette date/)).toBeInTheDocument();
  expect(within(items[2]).getByText('En vigueur')).toBeInTheDocument();
  expect(within(items[2]).getByText(/58 réservations/)).toBeInTheDocument();
});

test('« Annuler ce changement » appears on a deletable period only, and asks to undo it', async () => {
  const onUndo = vi.fn();
  draw({ onUndo, regime: { inForce: INITIAL, periods: [SCHEDULED, INITIAL], mentions: MENTIONS } });
  const buttons = screen.getAllByRole('button', { name: 'Annuler ce changement' });
  expect(buttons).toHaveLength(1);
  await userEvent.click(buttons[0]);
  expect(onUndo).toHaveBeenCalledWith(SCHEDULED);
});

test('« Changer de régime… » opens the switch; nothing of it shows while the state loads', async () => {
  const onSwitch = vi.fn();
  const { unmount } = draw({ onSwitch });
  await userEvent.click(screen.getByRole('button', { name: 'Changer de régime…' }));
  expect(onSwitch).toHaveBeenCalled();
  unmount();
  draw({ regime: null });
  expect(screen.queryByRole('button', { name: 'Changer de régime…' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Taux de TVA (%)')).toBeInTheDocument();
});

test('the history prints the Paris day of a period, and none for the initial one', () => {
  draw({ regime: { inForce: INITIAL, periods: [SCHEDULED, INITIAL], mentions: MENTIONS } });
  const items = within(screen.getByRole('list', { name: 'Historique' })).getAllByRole('listitem');
  expect(within(items[0]).getByText(/Adrien Jouve · 28\/10\/2026 · 0 réservation/)).toBeInTheDocument();
  expect(within(items[1]).getByText('58 réservations')).toBeInTheDocument();
});

test('the legal mention is told once under the field, the select showing the short name', () => {
  const current = { ...SCHEDULED, scheduled: false, deletable: false };
  draw({ values: { regime: 'not_subject', rate: 0, legalMention: 'art_293_b' }, regime: { inForce: current, periods: [current, INITIAL], mentions: MENTIONS } });
  expect(screen.getAllByText(/art\. 293 B/)).toHaveLength(2);
  expect(screen.getAllByText(/TVA non applicable, art\. 293 B du CGI/)).toHaveLength(1);
});
