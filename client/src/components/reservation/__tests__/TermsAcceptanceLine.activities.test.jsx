/**
 * ActivityTermsAcceptanceLines — the acceptances of the other activities' terms on a fiche (specs/gift-voucher-campaigns.md rule 37): one line
 * each with the activity and the channel, the proof in « Détails », and the archived text read for THAT activity.
 */
import React from 'react';
import { vi } from 'vitest';
import {
  render, screen, act, fireEvent,
} from '@testing-library/react';

vi.mock('../../../api', () => ({ __esModule: true, default: { getTermsVersion: vi.fn() } }));

import api from '../../../api';
import { ActivityTermsAcceptanceLines } from '../TermsAcceptanceLine';

const block = {
  termsAcceptanceState: 'not_applicable',
  termsAcceptance: null,
  activityAcceptances: [{
    activity: 'resource',
    label: 'Bain nordique et activités',
    channelLabel: 'appli séjour',
    version: 2,
    acceptedAt: '2026-11-18T09:00:00.000Z',
    acceptedAtLabel: '18/11/2026 à 10:00:00',
    versionPublishedAtLabel: '15/11/2026',
    shortHash: '0123456789ab',
    ip: '203.0.113.9',
    userAgent: 'Mozilla/5.0',
    pluginVersion: '',
  }],
};

beforeEach(() => api.getTermsVersion.mockReset());

test('one line per activity, with its label and the channel', () => {
  render(<ActivityTermsAcceptanceLines block={block} />);
  expect(screen.getByText('CGV Bain nordique et activités v2 acceptées le 18/11/2026 à 10:00:00 (appli séjour)')).toBeInTheDocument();
});

test('nothing when the reservation accepted no other terms', () => {
  const { container } = render(<ActivityTermsAcceptanceLines block={{ termsAcceptanceState: 'not_applicable', activityAcceptances: [] }} />);
  expect(container).toBeEmptyDOMElement();
});

test('« Voir le texte accepté » reads the version of that activity', async () => {
  api.getTermsVersion.mockResolvedValue({ html: { fr: '<p>FR</p>', en: '<p>EN</p>' } });
  render(<ActivityTermsAcceptanceLines block={block} />);
  fireEvent.click(screen.getByRole('button', { name: 'Détails' }));
  expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voir le texte accepté' })); });
  expect(api.getTermsVersion).toHaveBeenCalledWith(2, 'resource');
});
