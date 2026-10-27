// Fixed at the 2026-10-27 spec review (specs/per-property-option-prices.md rule 12) — on a phone the
// Options page logged React DOM-nesting warnings: the price cell, a block when an option has
// per-property prices, was rendered inside a <p>. The card's price line is now a <div>.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { Box, Typography } from '@mui/material';
import DialogProvider from '../DialogProvider';
import PricedItemsPage from '../PricedItemsPage';
import { setViewport, resetViewport } from './viewportFixture';

afterEach(() => { resetViewport(); vi.restoreAllMocks(); });

test('a per-property price block in the phone card is valid HTML', async () => {
  setViewport(390);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <MemoryRouter>
      <DialogProvider>
        <PricedItemsPage
          pageTitle="Options de séjour"
          itemLabel="option"
          emptyForm={{ name: '', price: 0, priceType: 'per_stay', propertyIds: [] }}
          formNameKey="name"
          loadItems={async () => ({
            items: [{ id: 4, name: 'Petit déjeuner', price: 12, priceType: 'per_stay', propertyIds: [1] }],
            properties: [{ id: 1, name: 'Gîte' }],
          })}
          createItem={vi.fn()}
          updateItem={vi.fn()}
          deleteItem={vi.fn()}
          renderPriceCell={() => (
            <Box>
              <Typography variant="body2">12,00 € (base)</Typography>
              <Typography variant="caption" sx={{ display: 'block' }}>Gîte : 9,00 €</Typography>
            </Box>
          )}
        />
      </DialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText('Gîte : 9,00 €');
  const nesting = errors.mock.calls.filter((args) => /descendant|cannot contain a nested/.test(String(args[0])));
  expect(nesting).toEqual([]);
});
