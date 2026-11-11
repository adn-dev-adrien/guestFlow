// specs/settings.md rule 8 (audit R24-I1, 2026-11-05) — the logo picker offers PNG and JPEG only, the formats the server
// accepts, and says so under the field.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));

import SettingsCompanySection from '../SettingsCompanySection';

test('rule 8: the logo picker takes PNG and JPEG, and says so', () => {
  const { container } = render(<SettingsCompanySection values={{}} onChange={() => {}} />);
  expect(container.querySelector('input[type="file"]').getAttribute('accept')).toBe('image/png,image/jpeg');
  expect(screen.getByText(/PNG ou JPEG, 2 Mo maximum\./)).toBeInTheDocument();
});
