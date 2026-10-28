// specs/per-property-option-prices.md rule 12 — the phone card of an option whose price differs by
// logement stays valid HTML: the price block and its caption lines never put a block inside a <p>
// (React logs a DOM-nesting warning otherwise).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import OptionRow from '../OptionRow';

const item = {
  id: 1,
  title: 'Ménage',
  description: 'Fin de séjour',
  category: '',
  price: { value: '30 € – 80 €', unit: '/ séjour', note: 'selon logement' },
  traits: [{ key: 'offered', label: 'Offert', tone: 'success' }],
  archivable: true,
  archiveBlockedReason: '',
};

test('a row with per-logement prices renders without any DOM-nesting warning', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ThemeProvider theme={theme}>
      <OptionRow item={item} onOpen={() => {}} onArchive={() => {}} />
    </ThemeProvider>,
  );
  expect(screen.getByText('30 € – 80 €')).toBeInTheDocument();
  expect(screen.getByText('/ séjour · selon logement')).toBeInTheDocument();
  const nesting = errors.mock.calls.filter((c) => String(c[0]).includes('validateDOMNesting') || String(c.join(' ')).includes('cannot be a descendant'));
  errors.mockRestore();
  expect(nesting).toEqual([]);
});

test('no paragraph holds another block in the row', () => {
  const { container } = render(
    <ThemeProvider theme={theme}>
      <OptionRow item={item} onOpen={() => {}} onArchive={() => {}} />
    </ThemeProvider>,
  );
  expect(container.querySelectorAll('p div, p p, p ul')).toHaveLength(0);
});
