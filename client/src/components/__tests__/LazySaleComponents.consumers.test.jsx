// specs/plugins-phase-1-sdk.md rule 54 (reading 2026-11-18, loop t20 UI20-1) — every dialog that renders a sale block of the SDK starts the
// blocks' code when it opens (`useSaleComponentsReady(open)`) and shows its content only once that code is there, so no block lands under
// content already drawn. The consumers are enumerated from the code: a new one fails here until it is added to the table.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../api';
import ResourceArrivalDialog from '../../plugins/hourly-resources/ResourceArrivalDialog';
import { visitPayload, fakeQuote } from '../../plugins/hourly-resources/__tests__/arrivalVisitFixtures';
import { sasPayload, renderDialog } from '../../plugins/sas/__tests__/sasFixtures';
import { departureRecapFor } from '../../plugins/sas/__tests__/sasPreviewFake';

// The hook stands in for the code's arrival: it answers false until the test releases it, then re-renders its consumer, as the real one does.
const { gate } = vi.hoisted(() => ({ gate: { ready: false, calls: [], listeners: new Set(), release() { this.ready = true; this.listeners.forEach((l) => l()); } } }));
vi.mock('../LazySaleComponents', async (importOriginal) => {
  const { useEffect, useReducer } = await import('react');
  return {
    ...(await importOriginal()),
    useSaleComponentsReady: (active) => {
      const [, rerender] = useReducer((n) => n + 1, 0);
      useEffect(() => { gate.listeners.add(rerender); return () => gate.listeners.delete(rerender); }, []);
      gate.calls.push(active);
      return gate.ready;
    },
  };
});
vi.mock('../../hooks/usePostalCodeCities', () => ({ default: () => [] }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn(() => Promise.resolve({ configured: false, resolved: false, department: null, alerts: [] })),
  },
}));

const SALE_BLOCKS = ['StaySalesSection', 'SuggestedArticlesStep', 'SalePaymentLink', 'StandaloneSaleDialog'];
const SRC = path.resolve(__dirname, '..', '..');

function sourcesOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourcesOf(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}

// A consumer imports one of the blocks from the SDK barrel (`../sdk`, `guestflow/sdk`): the lazy wrappers reach plugins only that way.
const consumers = sourcesOf(SRC)
  .filter((file) => !file.includes(`${path.sep}plugins${path.sep}sdk${path.sep}`))
  .filter((file) => [...fs.readFileSync(file, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']*)'/g)]
    .some(([, names, from]) => /(^|\/)sdk(\/ui)?$/.test(from) && SALE_BLOCKS.some((n) => new RegExp(`\\b${n}\\b`).test(names))))
  .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
  .sort();

const CONSUMERS = {
  'plugins/hourly-resources/ResourceArrivalDialog.jsx': {
    arrange: () => {
      api.getResourceVisit.mockResolvedValue(visitPayload());
      api.quoteResourceVisit.mockImplementation(fakeQuote());
    },
    mount: (open) => render(<ResourceArrivalDialog open={open} bookingId={5} onClose={() => {}} onDone={() => {}} />),
    content: () => screen.queryByText('Sa séance'),
    loaded: () => expect(api.getResourceVisit).toHaveBeenCalled(),
  },
  'plugins/sas/ReservationSasDialog.jsx': {
    arrange: () => {
      api.getReservationSas.mockResolvedValue(sasPayload());
      api.previewDepartureSas.mockImplementation((id, draft) => Promise.resolve(departureRecapFor(sasPayload(), draft)));
    },
    mount: (open) => renderDialog({ open, mode: 'departure' }),
    // The wizard's first page: the dialog body drawn, no loading state left in it.
    content: () => {
      const body = document.querySelector('.MuiDialogContent-root');
      return body && !body.querySelector('[aria-busy="true"]') && body.textContent.trim() ? body : null;
    },
    loaded: () => expect(api.getReservationSas).toHaveBeenCalled(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  gate.ready = false;
  gate.calls = [];
  gate.listeners.clear();
});

test('the consumers enumerated from the code are exactly the table', () => {
  expect(consumers).toEqual(Object.keys(CONSUMERS).sort());
});

describe.each(Object.keys(CONSUMERS))('%s', (file) => {
  const consumer = CONSUMERS[file];

  test('opened: asks for the sale blocks at once, keeps its content back until they are there, then shows it', async () => {
    consumer.arrange();
    consumer.mount(true);
    expect(gate.calls[0]).toBe(true);
    await waitFor(consumer.loaded);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(consumer.content()).toBeNull();
    act(() => gate.release());
    await waitFor(() => expect(consumer.content()).not.toBeNull());
  });

  test('closed: starts nothing', () => {
    consumer.arrange();
    consumer.mount(false);
    expect(gate.calls.every((active) => active === false)).toBe(true);
  });
});
