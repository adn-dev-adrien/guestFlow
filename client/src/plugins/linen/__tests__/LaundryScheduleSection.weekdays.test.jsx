// specs/linen-laundry-days.md §3.4 rules 19-20 and 22 — the « Blanchisserie » card: day toggles, the
// turnaround stepper, the refusals shown before Save, the server's cycle and its message.
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../api', () => ({ default: { previewLaundrySchedule: vi.fn() } }));

import api from '../../../api';
import LaundryScheduleSection from '../LaundryScheduleSection';

const CYCLE = {
  cycle: [{ dropWeekday: 2, pickUpWeekday: 4, waitDays: 2 }, { dropWeekday: 4, pickUpWeekday: 2, waitDays: 5 }],
  longestWaitDays: 5,
  firstTripOn: '2026-10-29',
};

function Harness({ initial, error = null, caption = null, onValue }) {
  const [value, setValue] = useState(initial);
  onValue?.(value);
  return <LaundryScheduleSection value={value} onChange={setValue} error={error} caption={caption} initialCycle={null} />;
}

const tuesdayThursday = { weekdays: [2, 4], turnaroundText: '2' };
const tuesday = { weekdays: [2], turnaroundText: '1' };

beforeEach(() => {
  vi.useFakeTimers();
  api.previewLaundrySchedule.mockReset();
  api.previewLaundrySchedule.mockResolvedValue(CYCLE);
});
afterEach(() => vi.useRealTimers());

const flushPreview = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300); }); };

test('specs/linen-laundry-days.md §3.4 rule 19: seven day toggles, Monday first, the schedule days pressed', () => {
  render(<Harness initial={tuesdayThursday} />);
  const group = screen.getByRole('group', { name: 'Jours' });
  const buttons = Array.from(group.querySelectorAll('button'));
  expect(buttons.map((b) => b.textContent)).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
  expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'true', 'false', 'false', 'false']);
  expect(screen.getByRole('button', { name: 'Mercredi' })).toBeInTheDocument();
});

test('specs/linen-laundry-days.md §3.4 rule 19: ticking and unticking days edits the draft', () => {
  let latest;
  render(<Harness initial={tuesday} onValue={(v) => { latest = v; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Jeudi' }));
  expect(latest.weekdays).toEqual([2, 4]);
  fireEvent.click(screen.getByRole('button', { name: 'Lundi' }));
  expect(latest.weekdays).toEqual([1, 2, 4]);
  fireEvent.click(screen.getByRole('button', { name: 'Mardi' }));
  expect(latest.weekdays).toEqual([1, 4]);
});

test('specs/linen-laundry-days.md §3.4 rule 20: unticking the last day keeps it ticked and says « Au moins un jour. »', () => {
  let latest;
  render(<Harness initial={tuesday} onValue={(v) => { latest = v; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mardi' }));
  expect(latest.weekdays).toEqual([2]);
  expect(screen.getByRole('button', { name: 'Mardi' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Au moins un jour.')).toBeInTheDocument();
  // The next accepted toggle clears the message.
  fireEvent.click(screen.getByRole('button', { name: 'Jeudi' }));
  expect(screen.queryByText('Au moins un jour.')).not.toBeInTheDocument();
});

test('specs/linen-laundry-days.md §3.4 rule 20: the stepper moves by one day, « − » stops at 1 and « + » at 14', () => {
  let latest;
  render(<Harness initial={{ weekdays: [2], turnaroundText: '2' }} onValue={(v) => { latest = v; }} />);
  const minus = screen.getByRole('button', { name: 'Un jour de moins' });
  const plus = screen.getByRole('button', { name: 'Un jour de plus' });
  fireEvent.click(plus);
  expect(latest.turnaroundText).toBe('3');
  fireEvent.click(minus);
  fireEvent.click(minus);
  expect(latest.turnaroundText).toBe('1');
  expect(minus).toBeDisabled();
  expect(screen.getByText('jour')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Délai en jours'), { target: { value: '14' } });
  expect(plus).toBeDisabled();
  expect(minus).not.toBeDisabled();
  expect(screen.getByText('jours')).toBeInTheDocument();
});

test('specs/linen-laundry-days.md §3.4 rule 20: the arrow keys step the typed value', () => {
  let latest;
  render(<Harness initial={{ weekdays: [2], turnaroundText: '4' }} onValue={(v) => { latest = v; }} />);
  const input = screen.getByLabelText('Délai en jours');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(latest.turnaroundText).toBe('5');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(latest.turnaroundText).toBe('3');
});

test('specs/linen-laundry-days.md §3.4 rule 20: a typed value outside 1..14 or not an integer is flagged « Entre 1 et 14 jours. »', () => {
  render(<Harness initial={tuesday} />);
  const input = screen.getByLabelText('Délai en jours');
  for (const typed of ['0', '15', '2.5', 'abc', '', '-3']) {
    fireEvent.change(input, { target: { value: typed } });
    expect(screen.getByText('Entre 1 et 14 jours.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  }
  fireEvent.change(input, { target: { value: '7' } });
  expect(screen.queryByText('Entre 1 et 14 jours.')).not.toBeInTheDocument();
  expect(input).toHaveAttribute('aria-invalid', 'false');
});

test('specs/linen-laundry-days.md §3.4 rule 20: from an invalid typed value, « + » and « − » restart from the bounds', () => {
  let latest;
  render(<Harness initial={{ weekdays: [2], turnaroundText: 'abc' }} onValue={(v) => { latest = v; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));
  expect(latest.turnaroundText).toBe('2');
});

test('specs/linen-laundry-days.md §3.4 rule 20: the server\'s message replaces the client\'s under the field it names', () => {
  const { rerender } = render(<LaundryScheduleSection value={{ weekdays: [2], turnaroundText: 'abc' }} onChange={() => {}} error={null} />);
  expect(screen.getByText('Entre 1 et 14 jours.')).toBeInTheDocument();
  rerender(<LaundryScheduleSection value={{ weekdays: [2], turnaroundText: 'abc' }} onChange={() => {}} error={{ field: 'turnaroundDays', message: 'Délai refusé par le serveur.' }} />);
  expect(screen.getByText('Délai refusé par le serveur.')).toBeInTheDocument();
  expect(screen.queryByText('Entre 1 et 14 jours.')).not.toBeInTheDocument();
  rerender(<LaundryScheduleSection value={{ weekdays: [2], turnaroundText: '2' }} onChange={() => {}} error={{ field: 'weekdays', message: 'Jour invalide.' }} />);
  expect(screen.getByText('Jour invalide.')).toBeInTheDocument();
});

test('specs/linen-laundry-days.md §3.4 rule 19: the cycle is the server\'s, one line per laundry day, refreshed after 250 ms', async () => {
  render(<Harness initial={tuesdayThursday} />);
  expect(api.previewLaundrySchedule).not.toHaveBeenCalled();
  await flushPreview();
  expect(api.previewLaundrySchedule).toHaveBeenCalledWith({ weekdays: [2, 4], turnaroundDays: 2 });
  const cycle = screen.getByTestId('laundry-cycle');
  expect(cycle).toHaveTextContent('Mar. → jeu.');
  expect(cycle).toHaveTextContent('2 j');
  expect(cycle).toHaveTextContent('Jeu. → mar.');
  expect(cycle).toHaveTextContent('5 j');
});

test('specs/linen-laundry-days.md §3.4 rule 19: edits within the debounce window cost one preview; an invalid draft asks for none', async () => {
  render(<Harness initial={tuesdayThursday} />);
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));
  await flushPreview();
  expect(api.previewLaundrySchedule).toHaveBeenCalledTimes(1);
  expect(api.previewLaundrySchedule).toHaveBeenLastCalledWith({ weekdays: [2, 4], turnaroundDays: 4 });
  fireEvent.change(screen.getByLabelText('Délai en jours'), { target: { value: 'abc' } });
  await flushPreview();
  expect(api.previewLaundrySchedule).toHaveBeenCalledTimes(1);
});

test('specs/linen-laundry-days.md §3.4 rule 19: a failed preview leaves the last good cycle', async () => {
  render(<Harness initial={tuesdayThursday} />);
  await flushPreview();
  expect(screen.getByTestId('laundry-cycle')).toHaveTextContent('Mar. → jeu.');
  api.previewLaundrySchedule.mockRejectedValueOnce(new Error('réseau'));
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));
  await flushPreview();
  expect(screen.getByTestId('laundry-cycle')).toHaveTextContent('Mar. → jeu.');
});

test('specs/linen-laundry-days.md §3.4 rule 22: the caption built by the page shows under the fields', () => {
  render(<Harness initial={tuesdayThursday} caption="À partir de demain, mer. 29 oct." />);
  expect(screen.getByText('À partir de demain, mer. 29 oct.')).toBeInTheDocument();
});

test('specs/linen-laundry-days.md §3.4 rule 19: the initial cycle shows before the first preview answers', () => {
  render(<LaundryScheduleSection value={tuesdayThursday} onChange={() => {}} initialCycle={CYCLE} />);
  expect(screen.getByTestId('laundry-cycle')).toHaveTextContent('Jeu. → mar.');
});

test('specs/linen-laundry-days.md §3.4 rule 19: the cycle is not left dimmed once the value is invalid and no preview is pending', async () => {
  render(<Harness initial={tuesdayThursday} />);
  await flushPreview();
  fireEvent.click(screen.getByRole('button', { name: 'Un jour de plus' }));   // a preview is now in flight: dimmed
  expect(screen.getByTestId('laundry-cycle')).toHaveStyle({ opacity: '0.45' });
  fireEvent.change(screen.getByLabelText('Délai en jours'), { target: { value: 'abc' } });   // invalid: no preview will answer
  await flushPreview();
  expect(screen.getByTestId('laundry-cycle')).toHaveStyle({ opacity: '1' });
});
