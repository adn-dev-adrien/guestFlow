/**
 * specs/report-grammar.md §3 rule 1 — the report grammar only ADDS optional props: an existing
 * consumer that passes none of them renders the very same markup as before lot 0. Each hash below was
 * recorded from the components as they stood on the integration branch (5437951d), before any change.
 */
import React from 'react';
import { createHash } from 'node:crypto';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import theme from '../../theme';
import SelectableTile from '../SelectableTile';
import YearOverYearBadge from '../YearOverYearBadge';
import PageTabs from '../PageTabs';
import TabDot from '../TabDot';

const hashOf = (ui) => {
  const { container, unmount } = render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
  const html = container.innerHTML;
  unmount();
  return createHash('sha256').update(html).digest('hex').slice(0, 16);
};

const CASES = {
  'SelectableTile closed': <SelectableTile label="Encaissé" value="18 227 €" caption="81 % du chiffre d'affaires" dotColor="primary.main" selected={false} onClick={() => {}} controls="detail" />,
  'SelectableTile open, alert value': <SelectableTile label="Reste dû" value="1 200 €" valueColor="error.main" selected onClick={() => {}} />,
  'YearOverYearBadge partial': <YearOverYearBadge change={12.34} months={1} totalMonths={12} />,
  'YearOverYearBadge drop': <YearOverYearBadge change={-8} />,
  'YearOverYearBadge none': <YearOverYearBadge change={null} />,
  'PageTabs bar with badge': (
    <PageTabs value="b" onChange={() => {}} ariaLabel="Onglets" items={[{ value: 'a', label: 'Général' }, { value: 'b', label: 'Tarifs', badge: <TabDot color="error" label="Refusé" /> }]} />
  ),
  'PageTabs card': <PageTabs value="a" variant="card" onChange={() => {}} items={[{ value: 'a', label: 'Un' }, { value: 'b', label: 'Deux' }]} />,
};

const RECORDED = {
  'SelectableTile closed': '5b86f31e73a220ee',
  'SelectableTile open, alert value': 'c679aaea9b82b43b',
  'YearOverYearBadge partial': '395fb4b7709153f4',
  'YearOverYearBadge drop': '1df0bfcc5d28d0f5',
  'YearOverYearBadge none': 'e3b0c44298fc1c14',
  'PageTabs bar with badge': 'f3fe613b45118051',
  'PageTabs card': 'cbe366521b782c11',
};

test('rule 1 — without the new props, every extended component renders byte-identically', () => {
  const now = Object.fromEntries(Object.entries(CASES).map(([k, ui]) => [k, hashOf(ui)]));
  expect(now).toEqual(RECORDED);
});
