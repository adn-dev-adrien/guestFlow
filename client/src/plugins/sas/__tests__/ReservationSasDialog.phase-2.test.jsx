// specs/plugins-phase-2-hosts.md rules 9-11 — the SAS is a host: the core opens it through the
// `sas.dialog` slot, plugins add read-only pages to both SASes (`sas.arrival.steps`,
// `sas.departure.steps`, placed by `after`), and the linen and towel steps follow the payload the
// server sends while `linen` is live instead of asking `usePlugin(LINEN)`.
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';

import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
import api from '../../../api';
import Slot from '../../sdk/Slot';
import placePluginSteps from '../placePluginSteps';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

const enabled = new Set();
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => enabled.has(id) }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

// The real SAS module next to a probe plugin that contributes one step to each SAS.
vi.mock('../../index', async () => {
  const { default: sas } = await import('../index');
  const Step = ({ data }) => <p>{data}</p>;
  const probe = {
    id: 'probe',
    contributes: {
      'sas.arrival.steps': [{
        key: 'probeArrival', title: 'Sonde', after: 'intro', load: async () => 'Page sonde arrivée', isShown: Boolean, Component: Step,
      }],
      'sas.departure.steps': [{
        key: 'probeDeparture', title: 'Sonde', load: async () => 'Page sonde départ', isShown: Boolean, Component: Step,
      }],
    },
  };
  return { default: [sas, probe] };
});

beforeEach(() => {
  vi.clearAllMocks();
  enabled.clear();
});

const noCaution = { reservation: { cautionAmount: 0 }, cleaning: { included: true, price: 0 } };

test('specs/plugins-phase-2-hosts.md rule 10 — a step lands after the page its `after` names, otherwise just before the recap', () => {
  const base = ['intro', 'missingAsk', 'keys', 'extinguisher', 'recap'];
  expect(placePluginSteps(base, [{ key: 'w' }, { key: 'k', after: 'keys' }, { key: 'k2', after: 'k' }]))
    .toEqual(['intro', 'missingAsk', 'keys', 'k', 'k2', 'extinguisher', 'w', 'recap']);
  expect(placePluginSteps(base, [{ key: 'gone', after: 'cautionReturn' }]))
    .toEqual(['intro', 'missingAsk', 'keys', 'extinguisher', 'gone', 'recap']);
  expect(placePluginSteps(base, [])).toEqual(base);
});

test('specs/plugins-phase-2-hosts.md rule 10 — an arrival step with `after: intro` is the page right after the intro', async () => {
  enabled.add('probe');
  api.getReservationSas.mockResolvedValue(sasPayload(noCaution));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  await act(async () => {});
  clickBtn('Commencer');
  expect(await screen.findByText('Page sonde arrivée')).toBeTruthy();
});

test('specs/plugins-phase-2-hosts.md rule 10 — sas.departure.steps adds a page to the departure SAS, before the recap', async () => {
  enabled.add('probe');
  api.getReservationSas.mockResolvedValue(sasPayload({ ...noCaution, reservation: { cautionAmount: 0, departureSasDoneAt: null } }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  await act(async () => {});
  clickBtn('Commencer');
  clickBtn('Non');
  clickBtn('Oui');
  expect(await screen.findByText('L\'extincteur est-il en bon état ?')).toBeTruthy();
  clickBtn('Oui');
  expect(await screen.findByText('Page sonde départ')).toBeTruthy();
});

test('specs/plugins-phase-2-hosts.md rule 11 — the bed-linen step shows when the payload carries the alert, without asking usePlugin(LINEN)', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    ...noCaution,
    reservation: { cautionAmount: 0, bedLinenAlert: { type: 'capacity', capacity: 2, required: 4 } },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  expect(await screen.findByText(/Le linge de lit prévu ne couvre pas/)).toBeTruthy();
});

test('specs/plugins-phase-2-hosts.md rule 11 — a payload without linen data has no linen or towel step (gap 5)', async () => {
  enabled.add('linen');
  const payload = sasPayload(noCaution);
  delete payload.linenItems;
  delete payload.bathLinen;
  api.getReservationSas.mockResolvedValue(payload);
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  expect(await screen.findByText('Récapitulatif')).toBeTruthy();
  expect(screen.queryByText(/Linge de toilette/)).toBeNull();
});

function renderSlot() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <Slot name="sas.dialog" open reservationId={1} mode="arrival" onClose={() => {}} onDone={() => {}} />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

test('specs/plugins-phase-2-hosts.md rule 9 — the sas.dialog slot renders the SAS while the plugin is active, and nothing otherwise', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload(noCaution));
  const { container, unmount } = renderSlot();
  await act(async () => {});
  expect(container.innerHTML).toBe('');
  expect(api.getReservationSas).not.toHaveBeenCalled();
  unmount();

  enabled.add('sas');
  renderSlot();
  await waitFor(() => expect(api.getReservationSas).toHaveBeenCalledWith(1, 'arrival'));
  expect(await screen.findByText('Commencer')).toBeTruthy();
});
