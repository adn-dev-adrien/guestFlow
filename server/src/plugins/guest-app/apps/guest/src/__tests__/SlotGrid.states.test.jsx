// specs/guest-app.md rules 28-31, §6.4 SlotGrid — only bookable slots are drawn, the evening rate says so, several
// slots can be picked.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SlotGrid from '../components/SlotGrid';
import { LangContext } from '../i18n';

const DAYS = [
  { date: '2099-07-07', label: 'mar. 7 juil.', slots: [{ start: '17:00', end: '18:00', state: 'free', priceLabel: '30 €' }, { start: '20:00', end: '21:00', state: 'evening', priceLabel: '40 €' }] },
  { date: '2099-07-08', label: 'mer. 8 juil.', slots: [{ start: '10:00', end: '11:00', state: 'free', priceLabel: 'Inclus' }] },
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
    expect(screen.getByText('40 € · evening rate')).toBeInTheDocument();
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
