// DataPageScaffold — the `body` slot (specs/clients-upcoming-past-directory.md §4.2): custom content in
// place of the table, with the bar, the top content and the loading / error states kept.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DataPageScaffold from '../DataPageScaffold';

function renderScaffold(props) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DataPageScaffold title="Clients" topContent={<span>filtres</span>} {...props} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('renders the body instead of a table, under the bar and the top content', () => {
  renderScaffold({ body: <div>liste groupée</div> });
  expect(screen.getByText('liste groupée')).toBeInTheDocument();
  expect(screen.getByText('filtres')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('a failure replaces the body with the retryable error', () => {
  renderScaffold({ body: <div>liste groupée</div>, error: 'boom', onRetry: () => {} });
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  expect(screen.queryByText('liste groupée')).not.toBeInTheDocument();
});
