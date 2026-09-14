// Shared fixtures for the GateAccessPage suites (specs/gate-access-portier.md §3.4). The shapes are the
// server's view (server/src/utils/portierAccessView.js): every sentence is already written.
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';
import GateAccessPage from '../GateAccessPage';

export const STAY = {
  id: '6f1c2a9e-3b7d-4c55-9a10-2e8f4b6d7c01',
  kind: 'stay',
  label: 'Camille (Gîte · 202609042)',
  state: 'active',
  stateLabel: 'actif',
  tag: { key: 'guestflow', label: 'guestFlow' },
  subtitle: 'Gîte · 202609042',
  reservationId: 42,
  code: '4K7M-9QT2',
  validity: 'Du 12/09 à 16:00 au 14/09 à 11:00',
  hours: 'à toute heure',
  phones: 2,
  phonesLabel: '2 téléphones',
  lastUse: 'il y a 3 h',
  note: '',
  edit: {
    label: 'Camille (Gîte · 202609042)', validFrom: '', validUntil: '', earlyFrom: '', extendedUntil: '',
    stayFrom: '2026-09-12T16:00', stayUntil: '2026-09-14T11:00',
    stayLabel: 'Séjour : du 12/09 à 16:00 au 14/09 à 11:00 (départ + 1 h).', timeWindows: [],
  },
  actions: { edit: true, invite: true, regenerate: true, suspend: true, resume: false, remove: true, recreate: false },
  confirm: {
    invite: "Le code et le QR de « Camille (Gîte · 202609042) » changent. Les 2 téléphones déjà installés continuent. L'ancien QR ne servira plus.",
    regenerate: "Les 2 téléphones de « Camille (Gîte · 202609042) » s'arrêtent et devront être réinstallés avec le nouveau code. C'est ainsi qu'on coupe un téléphone perdu.",
    remove: "« Camille (Gîte · 202609042) » disparaît de la liste. Les modifications de la réservation 202609042 seront ignorées ; seul « Recréer l'accès » sur la fiche le ramène.",
  },
};

export const MANUAL = {
  id: 'b3d5e7f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
  kind: 'manual',
  label: 'Paul (voisin)',
  state: 'suspended',
  stateLabel: 'suspendu',
  tag: { key: 'mine', label: 'créé par moi' },
  subtitle: 'créé le 02/05',
  reservationId: null,
  code: 'P2NC-7VJ4',
  validity: 'Toujours valable',
  hours: '08:00 → 20:00',
  phones: 1,
  phonesLabel: '1 téléphone',
  lastUse: 'il y a 111 jours',
  note: '',
  edit: {
    label: 'Paul (voisin)', validFrom: '', validUntil: '', earlyFrom: '', extendedUntil: '', stayFrom: '', stayUntil: '',
    stayLabel: '', timeWindows: [{ from: '08:00', until: '20:00' }],
  },
  actions: { edit: true, invite: true, regenerate: true, suspend: false, resume: true, remove: true, recreate: false },
  confirm: {
    invite: "Le code et le QR de « Paul (voisin) » changent. Le téléphone déjà installé continue. L'ancien QR ne servira plus.",
    regenerate: "Le téléphone de « Paul (voisin) » s'arrête et devra être réinstallé avec le nouveau code. C'est ainsi qu'on coupe un téléphone perdu.",
    remove: '« Paul (voisin) » disparaît de la liste. Son journal reste.',
  },
};

export const LIST = {
  house: { up: true, text: 'Maison connectée depuis 06:12 · portail fermé' },
  groups: [
    { key: 'active', title: 'Actifs', accesses: [STAY] },
    { key: 'suspended', title: 'Suspendus', accesses: [MANUAL] },
  ],
  pushFailing: null,
};

export function renderGateAccessPage(path = '/portail') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DialogProvider>
        <GateAccessPage />
      </DialogProvider>
    </MemoryRouter>,
  );
}
