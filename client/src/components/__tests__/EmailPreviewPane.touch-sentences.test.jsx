// specs/ui-review-2026-10-19-operations.md rule 37 — on touch only the one-line subject sentence grows to
// 44 px; a hit area around a multi-line body sentence would cover the end of the sentence before it and
// send the tap to the wrong editor. jsdom has no pointer media: this reads the emitted rules, and the
// browser measurement (0 misdirected sentences at 390, 900 and 1024) is in the spec.
import React from 'react';
import { render, screen } from '@testing-library/react';
import EmailPreviewPane from '../EmailPreviewPane';

const rulesOf = (el) => {
  const own = [...el.classList].find((c) => c.startsWith('css-'));
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  return css.split('}').filter((chunk) => chunk.includes(`.${own}`)).join('}');
};

test('rule 37 — the subject sentence is 44 px on touch, a body sentence has no hit area', () => {
  render(
    <EmailPreviewPane
      subject="Votre séjour" subjectKey="s" body="Bonjour. Une phrase qui tient sur plusieurs lignes."
      segments={[{ text: 'Bonjour. ', key: 'a' }, { text: 'Une phrase qui tient sur plusieurs lignes.', key: 'b' }]}
      onSegmentClick={() => {}}
    />,
  );
  const subject = screen.getByRole('button', { name: 'Modifier : objet' });
  const body = screen.getByRole('button', { name: /Modifier : Une phrase/ });
  expect(rulesOf(subject)).toMatch(/pointer: coarse[^}]*min-height:\s*44px/);
  expect(rulesOf(body)).not.toMatch(/::after|min-height/);
});
