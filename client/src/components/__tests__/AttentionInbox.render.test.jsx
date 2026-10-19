// specs/shell-and-home-day-first.md rules 3, 5, 10–12 — the « À traiter » box and the pinned cards draw
// the server's subjects in the server's order; a row unfolds its subject's content in place.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: { user: { roles: ['admin'], enabledPlugins: [] } } }));
// Two plugin contributions to the dashboard slots: one key the server declares (SDK ≥ 1.3.0), one it
// does not (a package built for an older SDK).
vi.mock('../../plugins/sdk/useSlot', () => ({
  useSlot: (name) => (name === 'dashboard.alerts'
    ? [
      { key: 'site-requests', pluginId: 'website-booking', Component: () => <div>NEW_SDK_ALERT</div> },
      { key: 'old-alert', pluginId: 'old-plugin', Component: () => <div>OLD_SDK_ALERT</div> },
    ]
    : []),
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => mockAuth }));
// The core subjects' contents have their own suites; here each one only says it was mounted.
vi.mock('../attentionSubjects', async () => {
  const { default: AttentionCard } = await vi.importActual('../AttentionCard');
  const probe = (name) => function Probe({ attention }) {
    return <AttentionCard attention={attention}><div>{`CONTENT ${name}`}</div></AttentionCard>;
  };
  return {
    CORE_ATTENTION_SUBJECTS: {
      'payment-deadlines': probe('payments'),
      'ical-cancellation': probe('ical'),
      'email-pending': probe('emails'),
    },
  };
});

import AttentionInbox, { AttentionPinned, LegacyPluginAlerts } from '../AttentionInbox';

const S = (key, severity, count, title) => ({ key, severity, count, title, detail: `détail ${key}` });
const ITEMS = [S('ical-cancellation', 'todo', 1, 'Annulations iCal à valider'), S('email-pending', 'info', 2, 'Emails à vérifier'), S('unknown-subject', 'info', 1, 'Sujet inconnu')];

const wrap = (node) => render(<MemoryRouter><ThemeProvider theme={theme}>{node}</ThemeProvider></MemoryRouter>);

test('rules 5, 10: one row per subject in the server order, with the total beside « À traiter »', () => {
  wrap(<AttentionInbox items={ITEMS} total={4} />);
  const box = screen.getByTestId('attention-inbox');
  expect(within(box).getByRole('heading', { name: 'À traiter' })).toBeInTheDocument();
  expect(screen.getByTestId('attention-total')).toHaveTextContent('4');
  const rows = within(box).getAllByRole('button');
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringContaining('Annulations iCal à valider'),
    expect.stringContaining('Emails à vérifier'),
    expect.stringContaining('Sujet inconnu'),
  ]);
  expect(rows[1]).toHaveTextContent('2');
});

test('rules 10, 11: a row is folded until activated — its content loads then, in place — and folds again', async () => {
  const user = userEvent.setup();
  wrap(<AttentionInbox items={ITEMS} total={4} />);
  const row = screen.getByTestId('attention-row-ical-cancellation');
  expect(row).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('CONTENT ical')).not.toBeInTheDocument();
  await user.click(row);
  expect(row).toHaveAttribute('aria-expanded', 'true');
  const region = screen.getByRole('region', { name: 'Annulations iCal à valider' });
  expect(within(region).getByText('CONTENT ical')).toBeInTheDocument();
  // Embedded: the row already names the subject, the content does not repeat it.
  expect(within(region).queryByRole('heading')).not.toBeInTheDocument();
  expect(within(region).getByText('détail ical-cancellation')).toBeInTheDocument();
  await user.click(row);
  expect(row).toHaveAttribute('aria-expanded', 'false');
});

test('rule 10: several rows may be open; a key without a component still shows the server detail', async () => {
  const user = userEvent.setup();
  wrap(<AttentionInbox items={ITEMS} total={4} />);
  await user.click(screen.getByTestId('attention-row-email-pending'));
  await user.click(screen.getByTestId('attention-row-unknown-subject'));
  expect(screen.getByText('CONTENT emails')).toBeInTheDocument();
  expect(screen.getByText('détail unknown-subject')).toBeInTheDocument();
});

test('rule 10: nothing to do reads « Rien à traiter. »', () => {
  wrap(<AttentionInbox items={[]} total={0} />);
  expect(screen.getByText('Rien à traiter.')).toBeInTheDocument();
  expect(screen.getByTestId('attention-total')).toHaveTextContent('0');
});

test('rule 3: pinned subjects are drawn unfolded, as cards, with their content', () => {
  wrap(<AttentionPinned subjects={[S('payment-deadlines', 'urgent', 2, 'Échéances de paiement')]} />);
  const card = screen.getByTestId('attention-card-payment-deadlines');
  expect(within(card).getByRole('heading', { name: 'Échéances de paiement' })).toBeInTheDocument();
  expect(within(card).getByText('CONTENT payments')).toBeInTheDocument();
});

test('rule 3: no pinned subject, nothing drawn', () => {
  const { container } = wrap(<AttentionPinned subjects={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test('rule 20: a source the server could not read is said under the rows', () => {
  wrap(<AttentionInbox items={ITEMS.slice(0, 1)} total={1} unavailableLabel="1 sujet indisponible" />);
  expect(screen.getByTestId('attention-unavailable')).toHaveTextContent('1 sujet indisponible');
  wrap(<AttentionInbox items={[]} total={0} unavailableLabel="2 sujets indisponibles" />);
  expect(screen.queryByText('Rien à traiter.')).not.toBeInTheDocument();
});

test('rule 22: a plugin contribution whose key the server did not declare (SDK < 1.3.0) renders as before', () => {
  wrap(<LegacyPluginAlerts declared={['site-requests', 'payment-deadlines']} />);
  expect(screen.getByText('OLD_SDK_ALERT')).toBeInTheDocument();
  expect(screen.queryByText('NEW_SDK_ALERT')).not.toBeInTheDocument();
});

test('rule 22: every contribution declared → nothing extra', () => {
  const { container } = wrap(<LegacyPluginAlerts declared={['site-requests', 'old-alert']} />);
  expect(container).toBeEmptyDOMElement();
});
