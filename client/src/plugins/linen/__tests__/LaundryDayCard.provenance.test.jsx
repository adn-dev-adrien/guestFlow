// specs/linen-laundry-days.md §3.2 rule 11 and §6.2 — where the pick-up comes from, and what still waits.
import React from 'react';
import { render, screen } from '@testing-library/react';

import LaundryDayCard from '../LaundryDayCard';

const BLOCK = (over = {}) => ({
  singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0, ...over,
});

const card = (over = {}) => ({
  kind: 'regular',
  dropOff: { ...BLOCK({ doubleBeds: 3 }), incomplete: [] },
  pickUp: { ...BLOCK({ doubleBeds: 2 }), fromTrips: [] },
  stillAtLaundry: null,
  ...over,
});

test('specs/linen-laundry-days.md rule 11: one drop date is named after « À récupérer »', () => {
  render(<LaundryDayCard data={card({ pickUp: { ...BLOCK({ doubleBeds: 2 }), fromTrips: ['2026-10-20'] } })} date="2026-10-23" />);
  expect(screen.getByText(/À récupérer/)).toHaveTextContent('À récupérer · déposé mar. 20');
});

test('specs/linen-laundry-days.md rule 11: two drop dates are joined by « et »', () => {
  render(<LaundryDayCard data={card({ pickUp: { ...BLOCK({ doubleBeds: 2 }), fromTrips: ['2026-10-13', '2026-10-15'] } })} date="2026-10-23" />);
  expect(screen.getByText(/À récupérer/)).toHaveTextContent('À récupérer · déposé mar. 13 et jeu. 15');
});

test('specs/linen-laundry-days.md rule 11: three drop dates read as a list', () => {
  render(<LaundryDayCard data={card({ pickUp: { ...BLOCK({ doubleBeds: 2 }), fromTrips: ['2026-10-12', '2026-10-14', '2026-10-16'] } })} date="2026-10-23" />);
  expect(screen.getByText(/À récupérer/)).toHaveTextContent('déposé lun. 12, mer. 14 et ven. 16');
});

test('specs/linen-laundry-days.md rule 11: nothing collected, nothing said about where it comes from', () => {
  render(<LaundryDayCard data={card({ pickUp: { ...BLOCK(), fromTrips: [] } })} date="2026-10-23" />);
  expect(screen.getByText('À récupérer')).toBeInTheDocument();
  expect(screen.queryByText(/déposé/)).not.toBeInTheDocument();
});

test('specs/linen-laundry-days.md rule 11: a card without fromTrips (older payload) still renders', () => {
  render(<LaundryDayCard data={{ dropOff: BLOCK({ doubleBeds: 1 }), pickUp: BLOCK({ doubleBeds: 1 }) }} date="2026-10-23" />);
  expect(screen.getByText('À récupérer')).toBeInTheDocument();
});

test('specs/linen-laundry-days.md rule 11: « Encore à la blanchisserie » lists what stays and when it is ready', () => {
  const stillAtLaundry = { counts: BLOCK({ doubleBeds: 4, largeTowels: 6 }), readyOn: '2026-10-23' };
  render(<LaundryDayCard data={card({ stillAtLaundry })} date="2026-10-21" />);
  const line = screen.getByText(/Encore à la blanchisserie/).parentElement;
  expect(line).toHaveTextContent('Encore à la blanchisserie : 4 doubles · 6 grandes · prêt ven. 23');
});

test('specs/linen-laundry-days.md rule 11: no « Encore » line when nothing stays', () => {
  render(<LaundryDayCard data={card()} date="2026-10-21" />);
  expect(screen.queryByText(/Encore à la blanchisserie/)).not.toBeInTheDocument();
});

test('specs/linen-laundry-days.md rule 11: a partial extra trip keeps its own caption instead of a second line', () => {
  const data = card({
    kind: 'extra',
    extraTrip: { pickUpAll: false, pickUp: BLOCK({ singleBeds: 1 }) },
    leftAtLaundry: BLOCK({ doubleBeds: 4 }),
    stillAtLaundry: { counts: BLOCK({ doubleBeds: 4 }), readyOn: '2026-10-23' },
  });
  render(<LaundryDayCard data={data} date="2026-10-22" />);
  expect(screen.getByText('Récupération partielle — reste à la blanchisserie : 4 doubles')).toBeInTheDocument();
  expect(screen.queryByText(/Encore à la blanchisserie/)).not.toBeInTheDocument();
});

test('specs/linen-laundry-days.md rule 11: an extra trip that takes everything shows what is still in the machine', () => {
  const data = card({
    kind: 'extra',
    extraTrip: { pickUpAll: true, pickUp: {} },
    leftAtLaundry: BLOCK({ doubleBeds: 1 }),
    stillAtLaundry: { counts: BLOCK({ doubleBeds: 1 }), readyOn: '2026-10-23' },
  });
  render(<LaundryDayCard data={data} date="2026-10-22" />);
  expect(screen.getByText(/Encore à la blanchisserie/).parentElement).toHaveTextContent('1 double · prêt ven. 23');
});

test('specs/linen-laundry-days.md rule 11: a skipped card says nothing about batches', () => {
  render(<LaundryDayCard data={card({ stillAtLaundry: { counts: BLOCK({ doubleBeds: 1 }), readyOn: '2026-10-23' } })} isSkipped date="2026-10-21" />);
  expect(screen.getByText(/Voyage non réalisé/)).toBeInTheDocument();
  expect(screen.queryByText(/Encore à la blanchisserie/)).not.toBeInTheDocument();
});
