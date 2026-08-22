/**
 * HeaderPill — the top-bar indicator (specs/self-update-and-releases.md §6.5).
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';

import HeaderPill from '../HeaderPill';

test('a labelled, counted pill the operator can click', async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(
    <HeaderPill
      icon={<SystemUpdateAltIcon />}
      count={2}
      label="Mises à jour"
      title="2 mises à jour disponibles"
      onClick={onClick}
    />,
  );

  const pill = screen.getByRole('button', { name: '2 mises à jour disponibles' });
  expect(pill).toHaveTextContent('2');
  expect(pill).toHaveTextContent('Mises à jour');

  await user.click(pill);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('an icon-only pill still names itself for screen readers', () => {
  render(
    <HeaderPill
      icon={<SystemUpdateAltIcon />}
      title="GuestFlow 2.4.0 est disponible"
      ariaLabel="GuestFlow 2.4.0 est disponible — voir les nouveautés"
      onClick={() => {}}
    />,
  );

  const pill = screen.getByRole('button', { name: /voir les nouveautés/ });
  // No count passed → no stray "0" or "undefined" beside the icon.
  expect(pill).toHaveTextContent('');
});

test('the neutral tone renders like any other — muted, not absent', () => {
  render(<HeaderPill icon={<SystemUpdateAltIcon />} tone="neutral" title="Lecture seule" onClick={() => {}} />);
  expect(screen.getByRole('button', { name: 'Lecture seule' })).toBeInTheDocument();
});
