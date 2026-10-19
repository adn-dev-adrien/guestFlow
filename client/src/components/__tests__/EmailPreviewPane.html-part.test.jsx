// specs/guest-email-texts-made-simple.md rule 37 (UI/UX review 2026-10-18, decision 15) — the preview
// shows either part of the guest email: the text as sent, or the HTML part the server derived from it,
// in a sandboxed frame. No HTML from the server → no switch.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailPreviewPane from '../EmailPreviewPane';

const HTML = '<!doctype html><html lang="fr"><body><p>Bonjour Camille,</p></body></html>';

test('rule 37: « Texte | HTML » switches between the two parts, the text first', () => {
  render(<EmailPreviewPane subject="À bientôt" body={'Bonjour Camille,'} html={HTML} />);
  expect(screen.getByRole('button', { name: 'Texte' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('email-preview')).toHaveTextContent('Bonjour Camille,');
  expect(screen.queryByTitle('Email en HTML')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'HTML' }));
  const frame = screen.getByTitle('Email en HTML');
  expect(frame.tagName).toBe('IFRAME');
  expect(frame.getAttribute('srcdoc')).toBe(HTML);
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(screen.getByText('À bientôt')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Texte' }));
  expect(screen.queryByTitle('Email en HTML')).toBeNull();
});

test('rule 37: without an HTML part there is no switch', () => {
  render(<EmailPreviewPane subject="s" body="Bonjour" />);
  expect(screen.queryByRole('group', { name: 'Partie de l’email' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'HTML' })).toBeNull();
});
