// specs/guest-email-texts-made-simple.md rule 45 — the template's own words open « Modèle complet »,
// as a button reachable from the keyboard like every tagged sentence.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailPreviewPane from '../EmailPreviewPane';

const SEGMENTS = [
  { text: 'Bonjour Camille,\n\n', key: null },
  { text: 'Café offert.', key: 'text:house' },
];

test('the template words are a focusable button opened by click, Entrée or Espace', () => {
  const onTemplateClick = vi.fn();
  render(<EmailPreviewPane subject="À bientôt" body="" segments={SEGMENTS} onSegmentClick={vi.fn()} onTemplateClick={onTemplateClick} />);
  const words = screen.getByRole('button', { name: 'Modèle complet : Bonjour Camille,' });
  expect(words).toHaveAttribute('tabindex', '0');
  fireEvent.click(words);
  fireEvent.keyDown(words, { key: 'Enter' });
  fireEvent.keyDown(words, { key: ' ' });
  expect(onTemplateClick).toHaveBeenCalledTimes(3);
});

test('without onTemplateClick the template words stay plain text', () => {
  render(<EmailPreviewPane subject="À bientôt" body="" segments={SEGMENTS} onSegmentClick={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /^Modèle complet/ })).toBeNull();
  expect(screen.getByTestId('email-preview')).toHaveTextContent('Bonjour Camille,');
});
