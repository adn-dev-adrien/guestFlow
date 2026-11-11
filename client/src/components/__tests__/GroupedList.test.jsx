// GroupedList — generic contract (specs/options-resources-ux.md §4.2): headers with count, fold, forceOpen,
// partial count, highlight, empty.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GroupedList from '../GroupedList';

const GROUPS = [
  { key: 'none', label: 'Sans catégorie', count: 2, items: [{ id: 1, name: 'Ménage' }, { id: 2, name: 'Linge' }] },
  { key: 'cat:Boissons', label: 'Boissons', count: 5, items: [{ id: 3, name: 'Vin' }] },
];
const renderItem = (item, { highlighted }) => <div data-testid={`row-${item.id}`} data-flash={highlighted}>{item.name}</div>;

test('renders one headed section per group with its count and its rows', () => {
  render(<GroupedList groups={GROUPS} renderItem={renderItem} />);
  expect(screen.getByRole('heading', { name: /^Sans catégorie/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^Boissons/ })).toBeInTheDocument();
  expect(screen.getByText('Ménage')).toBeInTheDocument();
  expect(screen.getByText('Vin')).toBeInTheDocument();
});

test('the pill reads « shown / total » when a filter hides part of a group, the total otherwise', () => {
  render(<GroupedList groups={GROUPS} renderItem={renderItem} />);
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText('1 / 5')).toBeInTheDocument();
});

test('a header folds and unfolds its section and says so with aria-expanded', async () => {
  const user = userEvent.setup();
  const collapsed = new Set(['none']);
  const onToggle = vi.fn();
  const { rerender } = render(
    <GroupedList groups={GROUPS} renderItem={renderItem} isCollapsed={(k) => collapsed.has(k)} onToggle={onToggle} />,
  );
  const header = screen.getByRole('button', { name: /Sans catégorie/ });
  expect(header).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Ménage')).not.toBeInTheDocument();
  await user.click(header);
  expect(onToggle).toHaveBeenCalledWith('none');
  collapsed.clear();
  rerender(<GroupedList groups={GROUPS} renderItem={renderItem} isCollapsed={(k) => collapsed.has(k)} onToggle={onToggle} />);
  expect(screen.getByText('Ménage')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Sans catégorie/ })).toHaveAttribute('aria-expanded', 'true');
});

test('forceOpen shows every row even in a folded section', () => {
  const onToggle = vi.fn();
  render(<GroupedList groups={GROUPS} renderItem={renderItem} isCollapsed={() => true} onToggle={onToggle} forceOpen />);
  expect(screen.getByText('Ménage')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(onToggle).not.toHaveBeenCalled();
});

test('rule 30: aria-controls only points at a section that is rendered', () => {
  const { rerender } = render(<GroupedList groups={GROUPS} renderItem={renderItem} isCollapsed={(k) => k === 'none'} onToggle={() => {}} />);
  expect(screen.getByRole('button', { name: /^Sans catégorie/ })).not.toHaveAttribute('aria-controls');
  const open = screen.getByRole('button', { name: /^Boissons/ });
  expect(document.getElementById(open.getAttribute('aria-controls'))).not.toBeNull();
  rerender(<GroupedList groups={GROUPS} renderItem={renderItem} onToggle={() => {}} />);
  expect(screen.getByRole('button', { name: /^Sans catégorie/ })).toHaveAttribute('aria-controls');
});

test('without onToggle the headers are plain headings, not buttons', () => {
  render(<GroupedList groups={GROUPS} renderItem={renderItem} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^Boissons/ })).toBeInTheDocument();
});

test('the toggle lives inside the heading, so heading navigation still finds the sections', () => {
  render(<GroupedList groups={GROUPS} renderItem={renderItem} onToggle={() => {}} />);
  expect(within(screen.getByRole('heading', { name: /^Boissons/ })).getByRole('button')).toBeInTheDocument();
});

test('highlightId reaches only the matching row', () => {
  render(<GroupedList groups={GROUPS} renderItem={renderItem} highlightId={3} />);
  expect(screen.getByTestId('row-3')).toHaveAttribute('data-flash', 'true');
  expect(screen.getByTestId('row-1')).toHaveAttribute('data-flash', 'false');
});

test('no group renders the empty node', () => {
  render(<GroupedList groups={[]} renderItem={renderItem} empty={<p>Rien ici</p>} />);
  expect(screen.getByText('Rien ici')).toBeInTheDocument();
});

test('a long group label is kept whole in its heading', () => {
  const label = 'Une catégorie au nom vraiment très long '.repeat(3).trim();
  render(<GroupedList groups={[{ key: 'x', label, items: [{ id: 9, name: 'A' }] }]} renderItem={renderItem} />);
  expect(within(screen.getByRole('heading')).getByText(label)).toBeInTheDocument();
});
