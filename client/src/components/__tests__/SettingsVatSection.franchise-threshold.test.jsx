// specs/vat-optional-mode.md rule 36, §6.6 — the « Seuil de franchise (€) » field of the TVA card: only
// under « Sans TVA » with the art. 293 B mention, the hint or the day it was typed, the mirror of the
// server's refusals, and a valid amount turned into a number on leaving the field.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import SettingsVatSection from '../SettingsVatSection';

const MENTIONS = [
  { key: 'art_293_b', label: 'TVA non applicable, art. 293 B du CGI', short: 'Franchise en base — art. 293 B' },
  { key: 'art_261_d_4', label: 'Exonération de TVA, art. 261 D 4° du CGI', short: 'Location meublée exonérée — art. 261 D 4°' },
];
const CURRENT = { id: 2, regime: 'not_subject', rate: 0, legalMention: 'art_293_b', label: 'Depuis le 01/01/2026', reservations: 0, deletable: false };
const FRANCHISE = { regime: 'not_subject', rate: 0, legalMention: 'art_293_b', franchiseThreshold: '', franchise: { applies: true, threshold: null, setAt: null } };

const draw = (values = FRANCHISE, props = {}) => render(
  <ThemeProvider theme={theme}>
    <SettingsVatSection
      values={values}
      onChange={() => {}}
      regime={{ inForce: CURRENT, periods: [CURRENT], mentions: MENTIONS }}
      onSwitch={() => {}}
      onUndo={() => {}}
      {...props}
    />
  </ThemeProvider>,
);

test('the field exists only under the franchise mention', () => {
  const { unmount } = draw();
  expect(screen.getByLabelText('Seuil de franchise')).toBeInTheDocument();
  unmount();
  draw({ ...FRANCHISE, legalMention: 'art_261_d_4' });
  expect(screen.queryByLabelText('Seuil de franchise')).not.toBeInTheDocument();
});

test('the field is absent under VAT', () => {
  draw({ regime: 'subject', rate: 10, legalMention: null, franchiseThreshold: '', franchise: { applies: false, threshold: null, setAt: null } });
  expect(screen.queryByLabelText('Seuil de franchise')).not.toBeInTheDocument();
});

test('empty: no figure suggested, the hint says to check the legal amount; set: the day it was typed', () => {
  const { unmount } = draw();
  const field = screen.getByLabelText('Seuil de franchise');
  expect(field).toHaveValue('');
  expect(field).not.toHaveAttribute('placeholder');
  expect(screen.getByText('Montant fixé par la loi pour l’activité. À vérifier avant saisie.')).toBeInTheDocument();
  unmount();
  draw({ ...FRANCHISE, franchiseThreshold: 30000, franchise: { applies: true, threshold: 30000, setAt: '2026-03-12' } });
  expect(screen.getByLabelText('Seuil de franchise').value.replace(/\s/g, '')).toBe('30000');
  expect(screen.getByText('Saisi le 12/03/2026')).toBeInTheDocument();
});

test.each([
  ['0', 'Montant supérieur à 0 €. Vide pour ne pas en fixer.'],
  ['-5', 'Montant supérieur à 0 €. Vide pour ne pas en fixer.'],
  ['abc', 'Un montant en euros (ex. 12 500).'],
  ['12,345', 'Deux décimales au plus.'],
  ['10 000 001', '10 000 000 € au plus.'],
])('« %s » is refused under the field with the server\'s message', (typed, message) => {
  draw({ ...FRANCHISE, franchiseThreshold: typed });
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getByLabelText('Seuil de franchise')).toHaveAttribute('aria-invalid', 'true');
});

test('typing is reported as typed; leaving a valid amount reports it as a number', async () => {
  const onChange = vi.fn();
  draw({ ...FRANCHISE, franchiseThreshold: '30 000,5' }, { onChange });
  await userEvent.type(screen.getByLabelText('Seuil de franchise'), '0');
  expect(onChange).toHaveBeenLastCalledWith('franchiseThreshold', '30 000,50');
  await userEvent.tab();
  expect(onChange).toHaveBeenLastCalledWith('franchiseThreshold', 30000.5);
});

test('leaving an invalid amount reports nothing more', async () => {
  const onChange = vi.fn();
  draw({ ...FRANCHISE, franchiseThreshold: '12,345' }, { onChange });
  screen.getByLabelText('Seuil de franchise').focus();
  await userEvent.tab();
  expect(onChange).not.toHaveBeenCalled();
});
