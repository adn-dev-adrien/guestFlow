// specs/accounting-synthesis.md §3 rule 47 (V2-2, V5-2) — a window that collected nothing: the cumulative chart gives
// way to the server's « empty », said in one sentence, no axis.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import AccountingSynthesisTab from '../AccountingSynthesisTab';
import { synthesisPayload } from './synthesisFixtures';

test('rule 47 — an empty series is a sentence, not a flat line on « 0 € / 0 € »', async () => {
  const data = synthesisPayload();
  data.collections.series = { ...data.collections.series, empty: true, previousAvailable: false };
  render(<ThemeProvider theme={theme}><MemoryRouter><AccountingSynthesisTab data={data} canOpenReservation onOpenEntriesMonth={() => {}} /></MemoryRouter></ThemeProvider>);
  const panel = screen.getByText('Encaissements cumulés').closest('section') || document.body;
  expect(await screen.findAllByText('Aucun encaissement sur la période.', {}, { timeout: 10000 })).not.toHaveLength(0);
  expect(panel.querySelector('[role="figure"], [role="img"]')).toBeNull();
});
