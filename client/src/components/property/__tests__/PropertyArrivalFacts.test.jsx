// specs/guest-email-texts-made-simple.md rules 1–2, 12, 25, 34 — the « Arrivée » block of a property:
// the facts, the code and the Wi-Fi password masked until « Modifier », the link to « Textes des
// emails ». Controlled by the page (rule 34): no save button of its own.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import PropertyArrivalFacts from '../PropertyArrivalFacts';

const DRAFT = { address: '12 chemin des Prés', mapUrl: '', accessFr: 'Porte bleue.', accessEn: '', wifiName: 'Gite', accessCode: undefined, wifiPassword: undefined };
const SAVED = { hasAccessCode: true, hasWifiPassword: false };

const renderBlock = (props = {}) => {
  const onChange = vi.fn();
  render(<MemoryRouter><PropertyArrivalFacts propertyId={1} draft={DRAFT} saved={SAVED} onChange={onChange} {...props} /></MemoryRouter>);
  return onChange;
};

test('rules 1–2: the facts are shown; a masked secret is typed only after « Modifier »', () => {
  const onChange = renderBlock();
  expect(screen.getByDisplayValue('12 chemin des Prés')).toBeInTheDocument();
  expect(screen.getAllByText('••••••••••')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Réseau Wi-Fi'), { target: { value: 'Gite-Invites' } });
  expect(onChange).toHaveBeenCalledWith('wifiName', 'Gite-Invites');
  fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
  expect(onChange).toHaveBeenCalledWith('accessCode', '');
});

test('rule 34: the block has no save button of its own; a refused field shows its message', () => {
  renderBlock({ errors: { address: 'Adresse trop longue' } });
  expect(screen.queryByRole('button', { name: /Enregistrer/ })).toBeNull();
  expect(screen.getByText('Adresse trop longue')).toBeInTheDocument();
});

test('rule 12: the property links to its texts on « Textes des emails »', () => {
  renderBlock();
  expect(screen.getByRole('link', { name: 'Textes des emails' })).toHaveAttribute('href', '/settings/emails/textes?propertyId=1#j2');
});

test('rule 25: a property without Wi-Fi is not asked for one', () => {
  renderBlock({ hasWifi: false });
  expect(screen.queryByLabelText('Réseau Wi-Fi')).toBeNull();
  expect(screen.queryByText('Mot de passe Wi-Fi')).toBeNull();
});
