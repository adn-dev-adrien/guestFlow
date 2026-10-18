// specs/control-plane-plans-and-access.md rule 37 — on a phone the console's menu keeps two entries in
// the bar and puts the others under « Plus », named after the open page when it is one of them.
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import ConsoleNav from '../components/ConsoleNav';
import { renderAt, setWidth } from './consoleFixtures';

const nav = (pathname) => renderAt(<ConsoleNav pathname={pathname} />, { path: '*', route: pathname });

it('rule 37 — on a phone: Clients, Versions, then « Plus » with the rest', async () => {
  setWidth(390);
  nav('/');
  expect(screen.getByRole('link', { name: 'Clients' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Versions' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Registre' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Plus' }));
  const items = (await screen.findAllByRole('menuitem')).map((m) => m.textContent);
  expect(items).toEqual(['Catalogue', 'Emails', 'Registre', 'Réglages', 'Profil']);
});

it('rule 37 — an open page under « Plus » gives the button its name', () => {
  setWidth(390);
  nav('/registre');
  expect(screen.getByRole('button', { name: 'Registre' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Plus' })).not.toBeInTheDocument();
});

it('rule 37 — on a computer every entry is in the bar', () => {
  setWidth(1280);
  nav('/');
  ['Clients', 'Versions', 'Catalogue', 'Emails', 'Registre', 'Réglages', 'Profil'].forEach((name) => {
    expect(screen.getByRole('link', { name })).toBeInTheDocument();
  });
  expect(screen.queryByRole('button', { name: 'Plus' })).not.toBeInTheDocument();
});
