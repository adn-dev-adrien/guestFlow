// GroupedList — a group with an empty label renders its card with no header
// (specs/clients-upcoming-past-directory.md rule 13: the name sort is a flat A → Z list).
import React from 'react';
import { render, screen } from '@testing-library/react';
import GroupedList from '../GroupedList';

test('an unlabelled group shows its rows and no heading', () => {
  render(
    <GroupedList
      groups={[{ key: 'all', label: '', count: 2, items: [{ id: 1, name: 'Alard' }, { id: 2, name: 'Zed' }] }]}
      renderItem={(item) => <div>{item.name}</div>}
    />,
  );
  expect(screen.getByText('Alard')).toBeInTheDocument();
  expect(screen.getByText('Zed')).toBeInTheDocument();
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});
