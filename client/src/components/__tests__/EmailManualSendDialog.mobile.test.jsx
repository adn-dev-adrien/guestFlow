// specs/ds-components.md rule 22 — review #8, m-6: the reservation « Envoyer un email » preview opened
// at 374 × 780 on a phone instead of full screen, like every other dialog.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEmailTemplates: vi.fn().mockResolvedValue([]), previewEmail: vi.fn(), sendEmail: vi.fn() },
}));

import EmailManualSendDialog from '../EmailManualSendDialog';

const compactScreen = () => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query), media: query,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
};
afterEach(() => { delete window.matchMedia; });

test('rule 22 — the email preview is full screen on a phone', async () => {
  compactScreen();
  render(<EmailManualSendDialog open reservationId={5} onClose={() => {}} />);
  const paper = (await screen.findByRole('dialog'));
  expect(paper.className).toMatch(/MuiDialog-paperFullScreen/);
});

test('rule 22 — and a centred dialog from sm up', async () => {
  render(<EmailManualSendDialog open reservationId={5} onClose={() => {}} />);
  expect((await screen.findByRole('dialog')).className).not.toMatch(/MuiDialog-paperFullScreen/);
});
