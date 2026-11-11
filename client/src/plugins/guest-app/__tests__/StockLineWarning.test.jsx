// specs/guest-app.md rule 37quater — « Stock : épuisé » under a line of the fiche, a warning that never blocks.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import guestAppApi from '../guestAppApi';
import StockLineWarning, { forgetStock } from '../StockLineWarning';

vi.mock('../guestAppApi', () => ({ default: { getStock: vi.fn() } }));

const STOCK = {
  items: [
    { kind: 'option', id: 3, out: true, label: 'Stock : épuisé' },
    { kind: 'option', id: 4, out: false, label: 'Stock : 6' },
    { kind: 'resource', id: 2, out: true, label: 'Stock : épuisé' },
  ],
};
const renderLine = (props) => render(<ThemeProvider theme={theme}><StockLineWarning {...props} /></ThemeProvider>);

beforeEach(() => { vi.clearAllMocks(); forgetStock(); guestAppApi.getStock.mockResolvedValue(STOCK); });

test('an exhausted option or resource reads « Stock : épuisé »', async () => {
  renderLine({ option: { id: 3 } });
  expect(await screen.findByText('Stock : épuisé')).toBeInTheDocument();
  renderLine({ resource: { id: 2 } });
  await waitFor(() => expect(screen.getAllByText('Stock : épuisé')).toHaveLength(2));
});

test('an article in stock, or not followed, shows nothing; one read serves every line', async () => {
  const { container } = renderLine({ option: { id: 4 } });
  renderLine({ option: { id: 99 } });
  await waitFor(() => expect(guestAppApi.getStock).toHaveBeenCalledTimes(1));
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText(/Stock/)).not.toBeInTheDocument();
});
