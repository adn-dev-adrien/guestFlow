// Shared fixtures of the studio's suites (one file per subject, CLAUDE.md §9).
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@guestflow/theme';
import { DirtyGuardProvider } from '../hooks/useDirtyGuard';

export const LA_GRANJA = { propertyId: 1, name: 'La Granja', enabled: true, hasLodgingCode: true, stateLabel: null };
export const L_ESTIVA = { propertyId: 2, name: 'L’Estiva', enabled: true, hasLodgingCode: true, stateLabel: null };

export function renderStudio(ui, { route = '/' } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[route]}>
        <DirtyGuardProvider>{ui}</DirtyGuardProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

export const MODULES = [
  { key: 'gate', on: true, order: 0 }, { key: 'wifi', on: true, order: 1 }, { key: 'shop', on: true, order: 2 },
  { key: 'bath', on: true, order: 3 }, { key: 'soliomap', on: true, order: 4 }, { key: 'booklet', on: true, order: 5 },
  { key: 'orders', on: true, order: 6 }, { key: 'contacts', on: false, order: 7 },
];

export const SETTINGS = {
  appName: 'Domaine Solio', guestHost: 'sejour.domainesolio.com', soliomapUrl: 'https://map.domainesolio.com', soliomapEmbed: false, maxOrderTotal: 500, fulfilment: 'delivery', pickupPlace: '', soliomap: { syncedAt: null, syncedLabel: 'Synchronisé il y a 2 min', ok: true, count: 4 },
};

export function lodgingConfig(over = {}) {
  return {
    propertyId: 1, enabled: true, hasLodgingCode: true, name: 'La Granja', heroMediaId: null, modules: MODULES, wifi: { available: true, network: 'LaGranja-Invites', password: 'chataignes', note: '' }, contacts: [], ...over,
  };
}
