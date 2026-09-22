/**
 * TermsAcceptanceLine — the CGV acceptance on a fiche (specs/terms-acceptance-record.md rules 21-22).
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('../../../api', () => ({ __esModule: true, default: { getTermsVersion: vi.fn() } }));

import api from '../../../api';
import TermsAcceptanceLine from '../TermsAcceptanceLine';

const recorded = {
  termsAcceptanceState: 'recorded',
  termsAcceptance: {
    version: 3,
    acceptedAt: '2026-09-21T12:32:07.120Z',
    acceptedAtLabel: '21/09/2026 à 14:32:07',
    versionPublishedAtLabel: '12/09/2026',
    shortHash: 'abcdef123456',
    ip: '86.242.17.203',
    userAgent: 'Mozilla/5.0 (iPhone)',
    pluginVersion: '1.8.0',
  },
};

beforeEach(() => api.getTermsVersion.mockReset());

test('recorded → the line, and the proof in « Détails »', () => {
  render(<TermsAcceptanceLine block={recorded} />);
  expect(screen.getByText('CGV v3 acceptées le 21/09/2026 à 14:32:07')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Détails' }));
  expect(screen.getByText('86.242.17.203')).toBeInTheDocument();
  expect(screen.getByText('2026-09-21T12:32:07.120Z')).toBeInTheDocument();
  expect(screen.getByText('v3 publiée le 12/09/2026 · abcdef123456')).toBeInTheDocument();
});

test('« Voir le texte accepté » loads the frozen version', async () => {
  api.getTermsVersion.mockResolvedValue({ html: { fr: '<p>FR</p>', en: '<p>EN</p>' } });
  render(<TermsAcceptanceLine block={recorded} />);
  fireEvent.click(screen.getByRole('button', { name: 'Détails' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voir le texte accepté' })); });
  expect(api.getTermsVersion).toHaveBeenCalledWith(3);
  expect(await screen.findByTitle('Français')).toBeInTheDocument();
});

test('missing → the warning line', () => {
  render(<TermsAcceptanceLine block={{ termsAcceptanceState: 'missing', termsAcceptance: null }} />);
  expect(screen.getByText('CGV : aucune acceptation enregistrée')).toBeInTheDocument();
});

test('not applicable (devis made in GuestFlow) or no block → nothing', () => {
  const { container, rerender } = render(<TermsAcceptanceLine block={{ termsAcceptanceState: 'not_applicable', termsAcceptance: null }} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<TermsAcceptanceLine block={null} />);
  expect(container).toBeEmptyDOMElement();
});
