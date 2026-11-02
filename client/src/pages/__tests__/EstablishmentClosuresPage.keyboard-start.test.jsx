// specs/establishment-closures.md rule 21 (2026-11-02) — a start date typed on the keyboard keeps the focus in
// « Début de fermeture »: the reopening calendar opens only on a pick in the start calendar. The reopening
// date is pre-filled to start + 1 either way.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import dayjs from 'dayjs';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEstablishmentClosures: vi.fn(),
    getProperties: vi.fn(),
    getClosureConflicts: vi.fn(),
    updateEstablishmentClosure: vi.fn(),
    createEstablishmentClosure: vi.fn(),
  },
}));

import api from '../../api';
import EstablishmentClosuresPage from '../EstablishmentClosuresPage';
import { NONE, media } from './establishmentClosuresFixtures';

let orig;
beforeEach(() => {
  vi.clearAllMocks();
  orig = window.matchMedia;
  window.matchMedia = media(false);
  api.getEstablishmentClosures.mockResolvedValue([]);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Gîte' }]);
  api.getClosureConflicts.mockResolvedValue(NONE);
});
afterEach(() => { window.matchMedia = orig; });

async function openNewClosure() {
  render(<MemoryRouter><DialogProvider><EstablishmentClosuresPage /></DialogProvider></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: /Ajouter/ }));
  return screen.findByRole('dialog');
}

// An open calendar hides the dialog from the accessibility tree: the fields are read with `hidden`.
const field = (dialog, name) => within(dialog).getByRole('group', { name, hidden: true });
const sections = (group) => ({
  day: within(group).getByRole('spinbutton', { name: 'Jour', hidden: true }),
  month: within(group).getByRole('spinbutton', { name: 'Mois', hidden: true }),
  year: within(group).getByRole('spinbutton', { name: 'Année', hidden: true }),
});

test('rule 21: a start date entered on the keyboard keeps the focus and opens no reopening calendar', async () => {
  const dialog = await openNewClosure();
  const { day, month, year } = sections(field(dialog, 'Début de fermeture'));
  act(() => day.focus());
  fireEvent.keyDown(day, { key: 'ArrowUp' });
  act(() => month.focus());
  fireEvent.keyDown(month, { key: 'ArrowUp' });
  act(() => year.focus());
  fireEvent.keyDown(year, { key: 'ArrowUp' });
  // ArrowUp on an empty section writes its first value: day 01, month 01, the current year.
  const typed = dayjs().startOf('year');
  await waitFor(() => expect(year).toHaveTextContent(String(typed.year())));
  await act(async () => {});
  expect(document.activeElement).toBe(year);
  expect(screen.queryByRole('grid', { hidden: true })).toBeNull();
  const next = typed.add(1, 'day');
  await waitFor(() => expect(sections(field(dialog, 'Réouverture')).day).toHaveTextContent(next.format('DD')));
  const end = sections(field(dialog, 'Réouverture'));
  expect(end.day).toHaveTextContent(next.format('DD'));
  expect(end.month).toHaveTextContent(next.format('MM'));
  expect(end.year).toHaveTextContent(String(next.year()));
});

test('rule 21: a day picked in the start calendar still opens the reopening calendar, pre-filled', async () => {
  const dialog = await openNewClosure();
  const startControl = field(dialog, 'Début de fermeture').closest('.MuiFormControl-root');
  await userEvent.click(within(startControl).getByRole('button', { hidden: true }));
  // `matchMedia` answers false: the mobile picker, whose pick is accepted with « OK ».
  const grid = await screen.findByRole('grid');
  await userEvent.click(within(grid).getByRole('gridcell', { name: '10' }));
  await userEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(sections(field(dialog, 'Réouverture')).day).toHaveTextContent('11'));
  expect(await screen.findByRole('grid')).toBeInTheDocument();
  expect(api.getClosureConflicts).toHaveBeenCalled();
});
