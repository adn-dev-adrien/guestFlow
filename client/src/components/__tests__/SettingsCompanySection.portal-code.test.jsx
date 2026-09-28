// specs/plugins-phase-1-sdk.md rule 17 — the keypad code is a SAS fact: its field in Établissement
// follows the `sas` plugin, not Sowel's.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const enabled = new Set();
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: (id) => enabled.has(id) }));

import SettingsCompanySection from '../SettingsCompanySection';

const renderSection = () => render(<SettingsCompanySection values={{ portalCode: '4719' }} onChange={() => {}} />);

beforeEach(() => enabled.clear());

test('rule 17: the portal code field shows with the SAS plugin, without Sowel', () => {
  enabled.add('sas');
  renderSection();
  expect(screen.getByLabelText('Code portail')).toBeTruthy();
});

test('rule 17: without the SAS plugin there is no portal code, Sowel or not', () => {
  enabled.add('gate-access');
  renderSection();
  expect(screen.queryByLabelText('Code portail')).toBeNull();
});
