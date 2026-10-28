// specs/vat-optional-mode.md §6.2 — the switch dialog: the inputs of a switch, the server's preview
// (re-asked after each edit), the refusals it words, the acknowledgement of a correction, the stale
// preview (409), the direction back to VAT, and the full-screen layout on a phone.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import VatRegimeSwitchDialog from '../VatRegimeSwitchDialog';
import { setViewport, resetViewport } from './viewportFixture';

const MENTIONS = [
  { key: 'art_293_b', label: 'TVA non applicable, art. 293 B du CGI' },
  { key: 'art_261_d_4', label: 'Exonération de TVA, art. 261 D 4° du CGI' },
];
const SUBJECT = { id: 1, regime: 'subject', rate: 10 };
const NOT_SUBJECT = { id: 2, regime: 'not_subject', rate: 0 };
const READY = {
  fingerprint: 'fp-1',
  lines: ['9 réservations passent sans TVA, dont 1 déjà encaissée.', 'Prix inchangés.', 'Devis et résumés : mention « TVA non applicable, art. 293 B du CGI ».'],
  exportMonths: [], accountingExportActive: false,
};
const refusal = (errors) => Object.assign(new Error('refused'), { status: 422, errors });

function draw({ inForce = SUBJECT, preview = vi.fn().mockResolvedValue(READY), onSubmit = vi.fn().mockResolvedValue({ reassigned: 9 }), onDone = vi.fn() } = {}) {
  render(
    <ThemeProvider theme={theme}>
      <VatRegimeSwitchDialog open onClose={() => {}} inForce={inForce} mentions={MENTIONS} preview={preview} onSubmit={onSubmit} onDone={onDone} />
    </ThemeProvider>,
  );
  return { preview, onSubmit, onDone };
}
const button = (name) => screen.getByRole('button', { name });
const today = () => new Date().toLocaleDateString('sv-SE');

afterEach(resetViewport);

test('from VAT: « Passer sans TVA », the current and the target regime, the mention, « prises à partir du » today', async () => {
  const { preview } = draw();
  expect(screen.getByRole('dialog', { name: 'Passer sans TVA' })).toBeInTheDocument();
  expect(screen.getByText('Assujetti · 10 %', { selector: '.MuiChip-label' })).toBeInTheDocument();
  expect(screen.getByText('Sans TVA', { selector: '.MuiChip-label' })).toBeInTheDocument();
  expect(screen.getByLabelText('Mention légale')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Réservations prises à partir du/ })).toBeChecked();
  expect(screen.getByLabelText('Réservations prises à partir du : date')).toHaveValue(today());
  await waitFor(() => expect(preview).toHaveBeenCalledWith({ regime: 'not_subject', legalMention: 'art_293_b', basis: 'booking', effectiveFrom: today() }));
});

test('the submit button waits for the preview, then opens, and the lines are the server\'s', async () => {
  draw();
  expect(button('Passer sans TVA')).toBeDisabled();
  expect(screen.getByText('Aperçu disponible une fois les champs corrigés.')).toBeInTheDocument();
  expect(await screen.findByText('9 réservations passent sans TVA, dont 1 déjà encaissée.')).toBeInTheDocument();
  expect(screen.getByText('Prix inchangés.')).toBeInTheDocument();
  expect(button('Passer sans TVA')).toBeEnabled();
});

test('choosing « Séjours qui commencent à partir du » asks the preview for that scope and its own date', async () => {
  const { preview } = draw();
  await userEvent.click(screen.getByRole('radio', { name: /Séjours qui commencent à partir du/ }));
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ basis: 'arrival', effectiveFrom: today() })));
});

test('a date the server refuses is shown under the field, the button closes, the preview waits', async () => {
  const preview = vi.fn().mockRejectedValue(refusal({ effectiveFrom: 'Date antérieure au dernier changement (01/01/2027)' }));
  draw({ preview });
  expect(await screen.findByText('Date antérieure au dernier changement (01/01/2027)')).toBeInTheDocument();
  expect(button('Passer sans TVA')).toBeDisabled();
  expect(screen.getByText('Aperçu disponible une fois les champs corrigés.')).toBeInTheDocument();
});

test('a correction asks for the acknowledgement before the button opens, in warning colour', async () => {
  draw();
  await userEvent.click(screen.getByRole('radio', { name: /Toutes les réservations — correction/ }));
  const go = await screen.findByRole('button', { name: 'Corriger toutes les réservations' });
  await screen.findByText('Prix inchangés.');
  expect(go).toBeDisabled();
  expect(go.className).toMatch(/Warning/);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Les documents déjà envoyés ne changent pas.' }));
  expect(go).toBeEnabled();
});

test('a correction that rewrites months already sent says so in the acknowledgement', async () => {
  const preview = vi.fn().mockResolvedValue({ ...READY, exportMonths: ['2026-05', '2026-10'], accountingExportActive: true });
  draw({ preview });
  await userEvent.click(screen.getByRole('radio', { name: /Toutes les réservations — correction/ }));
  expect(await screen.findByRole('checkbox', { name: 'Les écritures déjà transmises au comptable changent.' })).toBeInTheDocument();
});

test('the switch sends the inputs, the preview\'s fingerprint and the acknowledgement, then reports it done', async () => {
  const { onSubmit, onDone } = draw();
  await userEvent.click(screen.getByRole('radio', { name: /Toutes les réservations — correction/ }));
  await screen.findByText('Prix inchangés.');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(button('Corriger toutes les réservations'));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
    regime: 'not_subject', legalMention: 'art_293_b', basis: 'all', fingerprint: 'fp-1', acknowledged: true,
  }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith({ reassigned: 9 }));
});

test('a stale preview (409) shows the notice and asks for a new preview', async () => {
  const preview = vi.fn().mockResolvedValueOnce(READY).mockResolvedValue({ ...READY, fingerprint: 'fp-2' });
  const onSubmit = vi.fn().mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }));
  const { onDone } = draw({ preview, onSubmit });
  await screen.findByText('Prix inchangés.');
  await userEvent.click(button('Passer sans TVA'));
  expect(await screen.findByText('Les réservations ont changé. Aperçu mis à jour.')).toBeInTheDocument();
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  expect(onDone).not.toHaveBeenCalled();
});

test('back to VAT: « Passer à la TVA », a rate with its 422 under the field, no mention', async () => {
  const preview = vi.fn().mockRejectedValue(refusal({ rate: 'Taux entre 0 et 100' }));
  draw({ inForce: NOT_SUBJECT, preview });
  expect(screen.getByRole('dialog', { name: 'Passer à la TVA' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Mention légale')).not.toBeInTheDocument();
  const rate = screen.getByLabelText('Taux de TVA (%)');
  expect(rate).toHaveValue('10');
  await userEvent.clear(rate);
  await userEvent.type(rate, '140');
  expect(await screen.findByText('Taux entre 0 et 100')).toBeInTheDocument();
  expect(button('Passer à la TVA')).toBeDisabled();
});

test('an edit re-asks the preview once, after 300 ms of silence', async () => {
  const { preview } = draw({ inForce: NOT_SUBJECT });
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  await userEvent.type(screen.getByLabelText('Taux de TVA (%)'), '55');
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ regime: 'subject', rate: '1055' }));
});

test('on a phone the dialog is full screen and the scope cards stack', () => {
  setViewport(390);
  draw();
  expect(screen.getByRole('dialog').closest('.MuiDialog-paper')).toHaveClass('MuiDialog-paperFullScreen');
  expect(screen.getAllByRole('radio')).toHaveLength(3);
});
