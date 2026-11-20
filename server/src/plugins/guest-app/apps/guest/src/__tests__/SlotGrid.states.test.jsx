// specs/guest-app.md rules 28-31, §6.4 SlotGrid — only bookable slots are drawn, the evening rate says so, several
// slots can be picked.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SlotGrid from '../components/SlotGrid';
import { LangContext } from '../i18n';

const DAYS = [
  { date: '2099-07-07', label: 'mar. 7 juil.', available: true, slots: [{ start: '17:00', end: '18:00', state: 'free', priceLabel: '30 €' }, { start: '20:00', end: '21:00', state: 'evening', band: 'evening', priceLabel: '40 € · tarif soirée' }] },
  { date: '2099-07-08', label: 'mer. 8 juil.', available: true, slots: [{ start: '10:00', end: '11:00', state: 'free', priceLabel: 'Inclus' }] },
];

describe('SlotGrid', () => {
  it('draws the days the server sends and the slots of the chosen day, times in the guest\'s words', () => {
    render(<SlotGrid days={DAYS} day="2099-07-07" onDay={() => {}} selected={new Set()} onToggle={() => {}} />);
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(screen.getByText('17 h – 18 h')).toBeInTheDocument();
    expect(screen.getByText('40 € · tarif soirée')).toBeInTheDocument();
    expect(screen.queryByText('10 h – 11 h')).toBeNull();
  });

  it('prints 24-hour clock times in English', () => {
    render(<LangContext.Provider value="en"><SlotGrid days={DAYS} day="2099-07-07" onDay={() => {}} selected={new Set()} onToggle={() => {}} /></LangContext.Provider>);
    expect(screen.getByText('20:00 – 21:00')).toBeInTheDocument();
    expect(screen.getByText('40 € · tarif soirée')).toBeInTheDocument();
  });

  it('rules 77, 78: a day with nothing bookable is greyed with its reason and cannot be picked; the bath\'s opening is a thin bar', () => {
    const onDay = vi.fn();
    const days = [
      { ...DAYS[0], openingBands: [{ from: '00:00', to: '08:00', open: false }, { from: '08:00', to: '22:00', open: true }, { from: '22:00', to: '24:00', open: false }] },
      { date: '2099-07-08', label: 'mer. 8 juil.', available: false, reasonLabel: 'Fermé', slots: [] },
    ];
    render(<SlotGrid days={days} day="2099-07-08" onDay={onDay} selected={new Set()} onToggle={() => {}} />);
    const closed = screen.getByRole('button', { name: 'mer. 8 juil. · Fermé' });
    expect(closed).toBeDisabled();
    expect(screen.getByRole('img', { name: '08:00 – 22:00' })).toBeInTheDocument();
    expect(screen.getByText('17 h – 18 h')).toBeInTheDocument();
  });

  it('marks the selected slots and hands a tapped one back with its day', () => {
    const onToggle = vi.fn();
    render(<SlotGrid days={DAYS} day="2099-07-07" onDay={() => {}} selected={new Set(['2099-07-07|20:00|21:00'])} onToggle={onToggle} />);
    expect(screen.getByText('20 h – 21 h').closest('button')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('17 h – 18 h'));
    expect(onToggle).toHaveBeenCalledWith(DAYS[0].slots[0], '2099-07-07');
  });

  it('switches day from the day chips', () => {
    const onDay = vi.fn();
    render(<SlotGrid days={DAYS} day="2099-07-07" onDay={onDay} selected={new Set()} onToggle={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'mer. 8 juil.' }));
    expect(onDay).toHaveBeenCalledWith('2099-07-08');
  });
});
