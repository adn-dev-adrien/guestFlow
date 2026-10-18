import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DialogProvider, { useAppDialogs } from '../DialogProvider';

// specs/clients.md rule 14 — la confirmation « Client existant » de la fiche offre une troisième
// issue, « Créer quand même » : `confirm` la rend par la valeur 'secondary'.

function Probe({ onResult, secondaryLabel }) {
  const { confirm } = useAppDialogs();
  return (
    <button
      type="button"
      onClick={async () => onResult(await confirm({
        title: 'Client existant',
        message: 'Ce téléphone est déjà celui de Camille Revue.',
        confirmLabel: 'Utiliser ce client',
        cancelLabel: 'Modifier la saisie',
        secondaryLabel,
      }))}
    >
      ouvrir
    </button>
  );
}

async function open(secondaryLabel) {
  const results = [];
  render(<DialogProvider><Probe onResult={(r) => results.push(r)} secondaryLabel={secondaryLabel} /></DialogProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'ouvrir' }));
  return results;
}

test('« Créer quand même » répond « secondary », distinct de la confirmation', async () => {
  const results = await open('Créer quand même');
  await userEvent.click(screen.getByRole('button', { name: 'Créer quand même' }));
  expect(results).toEqual(['secondary']);
});

test('« Utiliser ce client » reste la confirmation', async () => {
  const results = await open('Créer quand même');
  await userEvent.click(screen.getByRole('button', { name: 'Utiliser ce client' }));
  expect(results).toEqual([true]);
});

test('« Modifier la saisie » reste le refus', async () => {
  const results = await open('Créer quand même');
  await userEvent.click(screen.getByRole('button', { name: 'Modifier la saisie' }));
  expect(results).toEqual([false]);
});

test('sans `secondaryLabel`, pas de troisième bouton', async () => {
  await open(undefined);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).not.toContain('Créer quand même');
});
