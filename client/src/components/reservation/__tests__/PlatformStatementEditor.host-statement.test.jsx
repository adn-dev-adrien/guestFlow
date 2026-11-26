// specs/platforms/platform-host-statement-and-commission-vat.md rules 2, 10-12 — the editor renders what the server reads of the typed statement: its
// lines, the option lines it adjusted, a refusal on its field (which blocks « Valider »), a commission-rate warning on the commission field.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import PlatformStatementEditor from '../PlatformStatementEditor';

const BOX = { mode: 'platform_reversed', label: 'Taxe de séjour versée avec le virement', helper: 'Celle de GuestFlow reste la taxe déclarée.' };
const baseProps = (preview) => ({
  form: { platform: 'Airbnb', platformGrossAmount: 805, platformOptionsAmount: 80, platformTouristTaxAmount: 24 },
  pricingQuote: { platformStatement: { box: BOX } },
  withDepositCommission: false,
  locked: false,
  onApply: vi.fn(),
  onCancel: vi.fn(),
  computeCommission: vi.fn(),
  preview,
});

test('rule 10 — the server\'s lines are printed, with the option adjustment it made', async () => {
  const preview = vi.fn().mockResolvedValue({
    lines: [
      { tone: 'info', label: 'Ménage passé en payant (80,00 €) pour suivre le relevé.' },
      { tone: 'done', label: 'Montant hôte 805,00 € + taxe 24,00 € − commission 124,78 € = 704,22 € — identique au virement ✓' },
    ],
    warnings: {}, refusals: {},
  });
  render(<PlatformStatementEditor {...baseProps(preview)} />);
  expect(await screen.findByText(/Ménage passé en payant/)).toBeInTheDocument();
  expect(screen.getByText(/identique au virement/)).toBeInTheDocument();
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ platformGrossAmount: 805, platformOptionsAmount: 80, platformTouristTaxAmount: 24 }));
});

test('rule 12 — the refusal of the options sits on its field and blocks « Valider »', async () => {
  const message = 'Le relevé compte 0,00 € d’options, la fiche 80,00 € : retirer une option.';
  const props = baseProps(vi.fn().mockResolvedValue({ lines: [], warnings: {}, refusals: { platformOptionsAmount: message } }));
  render(<PlatformStatementEditor {...props} />);
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.getByLabelText('Options (relevé)')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled();
});

test('rule 11 — a commission rate that looks off is a warning on the commission field; « Valider » stays enabled', async () => {
  const warning = 'Commission à 17,5 % du montant hôte, Airbnb est à 15,5 % : le montant hôte contient-il les frais payés par le voyageur ?';
  const props = baseProps(vi.fn().mockResolvedValue({ lines: [], warnings: { commissionRate: warning }, refusals: {} }));
  render(<PlatformStatementEditor {...props} />);
  expect(await screen.findByText(warning)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider' })).toBeEnabled();
});

test('rule 16 of the readout — a refusal answered as an error carrying its field lands on that field', async () => {
  const error = Object.assign(new Error('Le relevé compte 30,00 € d’options.'), { field: 'platformOptionsAmount' });
  render(<PlatformStatementEditor {...baseProps(vi.fn().mockRejectedValue(error))} />);
  await waitFor(() => expect(screen.getByLabelText('Options (relevé)')).toHaveAttribute('aria-invalid', 'true'));
});

test('item 11 — a refusal with no field is printed as a line, never swallowed', async () => {
  render(<PlatformStatementEditor {...baseProps(vi.fn().mockRejectedValue(new Error('Ce relevé modifierait aussi la taxe de séjour.')))} />);
  expect(await screen.findByText('Ce relevé modifierait aussi la taxe de séjour.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled();
});
