import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReservationHistoryPanel from '../ReservationHistoryPanel';

// specs/reservation-history-granular-diff.md §6 — le panneau n'est qu'un afficheur : le serveur
// envoie des lignes prêtes à imprimer, on vérifie le regroupement et les états vides / chargement.

const ENTRY = {
  id: 12,
  eventType: 'update',
  createdAt: '2026-08-07 07:52:12',
  changes: [
    { field: 'startDate', group: null, label: 'Date arrivée', kind: 'changed', fromText: '09/07/2026', toText: '12/07/2026' },
    { field: 'optionsSignature', group: 'Options', label: 'Lit parapluie', kind: 'added', fromText: null, toText: '×2 : 50 € (compl.)' },
    { field: 'optionsSignature', group: 'Options', label: 'Ménage', kind: 'removed', fromText: '7 €', toText: null },
  ],
  derived: [
    { field: 'finalPrice', group: null, label: 'Prix final', kind: 'changed', fromText: '497 €', toText: '547 €' },
  ],
};

test('affiche une ligne par changement, avec le groupe « Options » une seule fois', () => {
  render(<ReservationHistoryPanel entries={[ENTRY]} open />);

  expect(screen.getByText('Modification')).toBeInTheDocument();
  expect(screen.getByText('Date arrivée')).toBeInTheDocument();
  expect(screen.getAllByText('Options')).toHaveLength(1);
  expect(screen.getByText('Lit parapluie')).toBeInTheDocument();
  expect(screen.getByText('Ménage')).toBeInTheDocument();
  expect(screen.getByText('+')).toBeInTheDocument();
  expect(screen.getByText('−')).toBeInTheDocument();
});

test('les recalculs sont dans un bloc à part', () => {
  render(<ReservationHistoryPanel entries={[ENTRY]} open />);

  expect(screen.getByText('Recalculs')).toBeInTheDocument();
  expect(screen.getByText('Prix final')).toBeInTheDocument();
});

test('une entrée sans changement affiche le libellé par défaut de son type', () => {
  render(<ReservationHistoryPanel open entries={[
    { id: 1, eventType: 'create', createdAt: '2026-08-07 07:00:00', changes: [], derived: [] },
    { id: 2, eventType: 'update', createdAt: '2026-08-07 07:10:00', changes: [], derived: [] },
  ]} />);

  expect(screen.getByText('Réservation créée')).toBeInTheDocument();
  expect(screen.getByText('Mise à jour sans changement détecté')).toBeInTheDocument();
  expect(screen.queryByText('Recalculs')).not.toBeInTheDocument();
});

test('états fermé / chargement / vide', async () => {
  const onToggle = vi.fn();
  const { rerender } = render(<ReservationHistoryPanel entries={[ENTRY]} onToggle={onToggle} />);
  expect(screen.queryByText('Date arrivée')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Voir historique' }));
  expect(onToggle).toHaveBeenCalled();

  rerender(<ReservationHistoryPanel entries={[]} loading open onToggle={onToggle} />);
  expect(screen.getByRole('button', { name: 'Masquer historique' })).toBeInTheDocument();
  expect(screen.queryByText('Aucun historique disponible.')).not.toBeInTheDocument();

  rerender(<ReservationHistoryPanel entries={[]} open onToggle={onToggle} />);
  expect(screen.getByText('Aucun historique disponible.')).toBeInTheDocument();
});
