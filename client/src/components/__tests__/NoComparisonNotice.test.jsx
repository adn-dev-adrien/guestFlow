/**
 * specs/report-grammar.md §3 rule 5 — one notice says why there is no comparison; no text, no notice.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import NoComparisonNotice from '../NoComparisonNotice';
import { NO_COMPARISON_TEXT } from '../../pages/reportGrammarFixtures';

test('rule 5 — the server text is shown as a note', () => {
  render(<NoComparisonNotice text={NO_COMPARISON_TEXT} />);
  expect(screen.getByRole('note')).toHaveTextContent(NO_COMPARISON_TEXT);
});

test('rule 5 — without text nothing renders', () => {
  const { container } = render(<NoComparisonNotice text={null} />);
  expect(container).toBeEmptyDOMElement();
});
