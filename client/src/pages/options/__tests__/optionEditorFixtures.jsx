// Shared by the OptionEditorPanel suites (specs/options-resources-ux.md). `vi.mock` stays in each file.
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
import OptionEditorPanel from '../OptionEditorPanel';

export const PROPERTIES = [{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }];

/** A stored option as `GET /api/options/:id` returns it. */
export const storedOption = (over = {}) => ({
  id: 7, title: 'Ménage', description: 'Fin de séjour', priceType: 'per_stay', price: 30, category: '',
  propertyIds: [1, 2], propertyPrices: {}, propertyDefaults: {}, optionProgressiveTiers: [],
  autoOptionType: null, autoEnabled: 0, displayToClient: 1, ...over,
});

export function renderEditor({ optionId = 7, props = {} } = {}) {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  const view = render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <DialogProvider>
          <OptionEditorPanel
            open
            optionId={optionId}
            initialCategory=""
            properties={PROPERTIES}
            categories={['Boissons', 'Restauration']}
            {...handlers}
            {...props}
          />
        </DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { ...handlers, ...view };
}
