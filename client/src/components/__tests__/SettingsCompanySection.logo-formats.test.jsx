// specs/settings/settings.md rule 8 (audit R24-I1, 2026-11-05) — the logo picker offers PNG and JPEG only, the formats the server
// accepts, and says so under the field.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));

import SettingsCompanySection from '../SettingsCompanySection';

test('rule 8: the logo pickers (day and night) take PNG and JPEG, and say so', () => {
  const { container } = render(<SettingsCompanySection values={{}} onChange={() => {}} />);
  for (const input of container.querySelectorAll('input[type="file"]')) expect(input.getAttribute('accept')).toBe('image/png,image/jpeg');
  expect(screen.getAllByText(/PNG ou JPEG, 2 Mo maximum\./)).toHaveLength(2);
});
