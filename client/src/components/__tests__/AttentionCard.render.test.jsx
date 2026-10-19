// specs/shell-and-home-day-first.md rules 13–14 — one component draws every dashboard subject, with the
// server's words, and the palette's `text` tokens read at AA on their soft backgrounds.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import AttentionCard, { AttentionLayoutContext } from '../AttentionCard';
import StatusBadge from '../StatusBadge';

const subject = { key: 'payment-deadlines', severity: 'urgent', count: 3, title: 'Échéances de paiement', detail: '2 en retard · 1 à demander' };
const wrap = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('rule 13: the card shows the server title, count and detail, and names the severity', () => {
  wrap(<AttentionCard attention={subject}><div>LIST</div></AttentionCard>);
  const card = screen.getByTestId('attention-card-payment-deadlines');
  expect(within(card).getByRole('heading', { name: 'Échéances de paiement' })).toBeInTheDocument();
  expect(within(card).getByTestId('attention-count')).toHaveTextContent('3');
  expect(within(card).getByText('2 en retard · 1 à demander')).toBeInTheDocument();
  expect(within(card).getByText('Urgent')).toBeInTheDocument();
  expect(within(card).getByText('LIST')).toBeInTheDocument();
});

test('rule 13: actions are text buttons, the primary one filled; a click reaches its handler', async () => {
  const onOpen = vi.fn();
  wrap(<AttentionCard attention={{ ...subject, severity: 'info' }} actions={[{ label: 'Activer', primary: true, onClick: onOpen }, { label: 'Plus tard' }]} />);
  const primary = screen.getByRole('button', { name: 'Activer' });
  expect(primary.className).toMatch(/MuiButton-contained/);
  expect(screen.getByRole('button', { name: 'Plus tard' }).className).toMatch(/MuiButton-text/);
  await userEvent.click(primary);
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test('rule 13: embedded in the inbox it draws the detail, list and actions — not the title again', () => {
  wrap(
    <AttentionLayoutContext.Provider value="embedded">
      <AttentionCard attention={subject} actions={[{ label: 'Voir' }]}><div>LIST</div></AttentionCard>
    </AttentionLayoutContext.Provider>,
  );
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  expect(screen.getByText('2 en retard · 1 à demander')).toBeInTheDocument();
  expect(screen.getByText('LIST')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Voir' })).toBeInTheDocument();
});

test('rule 13: without a subject the card draws nothing', () => {
  const { container } = wrap(<AttentionCard attention={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('rule 14: every semantic `text` token reads at least 4.5:1 on its soft background', () => {
  ['success', 'warning', 'error', 'info'].forEach((sem) => {
    const { text, soft } = theme.palette[sem];
    expect(text, sem).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(contrast(text, soft), sem).toBeGreaterThanOrEqual(4.5);
  });
  expect(theme.palette.warning.text).toBe('#6F5112');
  expect(theme.palette.success.text).toBe('#2F6A43');
});

test('rule 14: StatusBadge writes its label in the AA text colour', () => {
  wrap(<StatusBadge status="warning" label="En retard" />);
  const chip = screen.getByText('En retard').closest('.MuiChip-root');
  expect(getComputedStyle(chip).color).toBe('rgb(111, 81, 18)');
});
