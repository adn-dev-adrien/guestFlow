import React from 'react';
import { render, screen } from '@testing-library/react';

import OptionDayCard from '../OptionDayCard';

// specs/card-option-served-persons.md §3.4 rule 18 — the cook reads the card: it must announce the
// covers actually sold, not the size of the party.

const ITEM = {
  reservationId: 1, optionId: 16, title: 'Le repas des trappeurs', clientName: 'Famille Dupont',
  propertyName: 'Gîte', date: '2026-06-02', time: '19:30', done: false,
  adults: 2, children: 2, teens: 0, babies: 0,
};

test('a reduced number of covers is announced on the card', () => {
  render(<OptionDayCard data={{ items: [{ ...ITEM, servedPersons: 2 }] }} />);

  expect(screen.getByText('2 couverts')).toBeInTheDocument();
  // The party stays visible as context — who is in the logement is another question.
  expect(screen.getByText('Adultes: 2')).toBeInTheDocument();
  expect(screen.getByText('Enfants: 2')).toBeInTheDocument();
});

test('a single cover is singular', () => {
  render(<OptionDayCard data={{ items: [{ ...ITEM, servedPersons: 1 }] }} />);
  expect(screen.getByText('1 couvert')).toBeInTheDocument();
});

test('a prestation served to the whole party shows no cover chip', () => {
  render(<OptionDayCard data={{ items: [{ ...ITEM, servedPersons: null }] }} />);
  expect(screen.queryByText(/couvert/)).not.toBeInTheDocument();
});
