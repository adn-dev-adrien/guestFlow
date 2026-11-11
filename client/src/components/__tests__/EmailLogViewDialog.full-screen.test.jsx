// specs/inte-performance.md rule 24 — the email log preview is full screen on a phone (CLAUDE.md §7).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import EmailLogViewDialog from '../EmailLogViewDialog';

const ROW = { id: 1, templateName: 'J-7', recipientEmail: 'jane@s.com', renderedSubject: 'Sujet', renderedBody: 'Corps', status: 'sent', errorMessage: '' };
const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });

function emulate(phone) {
  window.matchMedia = vi.fn((query) => ({
    matches: phone && /max-width:\s*(599|899)/.test(query), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
}

test('rule 24: on a phone the dialog is full screen', () => {
  emulate(true);
  render(<EmailLogViewDialog open row={ROW} onClose={() => {}} />);
  expect(screen.getByRole('dialog').className).toMatch(/MuiDialog-paperFullScreen/);
});

test('rule 24: on a computer it is a dialog', () => {
  emulate(false);
  render(<EmailLogViewDialog open row={ROW} onClose={() => {}} />);
  expect(screen.getByRole('dialog').className).not.toMatch(/MuiDialog-paperFullScreen/);
});
