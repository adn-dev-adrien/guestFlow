import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import MidStayNoteRow from '../MidStayNoteRow';

// specs/adjustable-complement-amounts.md §3.4 — la note est l'unité ajustable du bucket « durant le
// séjour » : montant, date de paiement, CB / caisse interne.

const NOTE = {
  id: 1,
  paidDate: '2026-08-06',
  paidCash: 0,
  total: 26,
  lines: [{ label: 'Linge de toilette', amount: 26, key: 'opt:9' }],
};

test('lecture : date, montant, mode et lignes', () => {
  render(<MidStayNoteRow note={NOTE} onCancel={vi.fn()} onAdjust={vi.fn()} />);
  expect(screen.getByText('06/08 — 26,00 € — CB')).toBeInTheDocument();
  expect(screen.getByText('Linge de toilette : 26,00 €')).toBeInTheDocument();
});

test('✎ ouvre l\'édition en place et Enregistrer envoie montant + date + mode', async () => {
  const user = userEvent.setup();
  const onAdjust = vi.fn().mockResolvedValue(undefined);
  render(<MidStayNoteRow note={NOTE} onCancel={vi.fn()} onAdjust={onAdjust} />);

  await user.click(screen.getByRole('button', { name: /Modifier la note/i }));
  const amount = screen.getByLabelText(/Montant/i);
  await user.clear(amount);
  await user.type(amount, '20');
  await user.click(screen.getByRole('button', { name: 'Caisse interne' }));
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(onAdjust).toHaveBeenCalledWith({ total: 20, paidDate: '2026-08-06', cash: true }));
});

test('une erreur serveur s\'affiche sous le champ sans refermer l\'édition', async () => {
  const user = userEvent.setup();
  const onAdjust = vi.fn().mockRejectedValue(new Error('Montant supérieur au reste à percevoir sur ces prestations (26 €).'));
  render(<MidStayNoteRow note={NOTE} onCancel={vi.fn()} onAdjust={onAdjust} />);

  await user.click(screen.getByRole('button', { name: /Modifier la note/i }));
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

  expect(await screen.findByText(/Montant supérieur au reste à percevoir/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
});

test('règle 28 — complément de fin de séjour encaissé : les deux actions sont désactivées', () => {
  render(<MidStayNoteRow note={NOTE} settled onCancel={vi.fn()} onAdjust={vi.fn()} />);
  expect(screen.getByRole('button', { name: /Modifier la note/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Reporter au départ/i })).toBeDisabled();
});

test('« Reporter au départ » remonte l\'action au parent', async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  render(<MidStayNoteRow note={NOTE} onCancel={onCancel} onAdjust={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Reporter au départ/i }));
  expect(onCancel).toHaveBeenCalled();
});

test('Annuler referme l\'édition sans rien envoyer', async () => {
  const user = userEvent.setup();
  const onAdjust = vi.fn();
  render(<MidStayNoteRow note={NOTE} onCancel={vi.fn()} onAdjust={onAdjust} />);
  await user.click(screen.getByRole('button', { name: /Modifier la note/i }));
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onAdjust).not.toHaveBeenCalled();
  expect(screen.getByText('06/08 — 26,00 € — CB')).toBeInTheDocument();
});
