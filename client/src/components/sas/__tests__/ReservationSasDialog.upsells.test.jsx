// The SAS upsells: ménage and bath linen — specs/sas-bath-linen-upsell.md, sas-upsells-activate-catalogue-option.md
//
// One file per subject (CLAUDE.md §9): two features appending their cases no longer collide on
// the last line of a shared suite. Fixtures used by more than one subject live in ./sasFixtures.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

// Mock the API the dialog consumes.
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 85 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    // Weather alerts (specs/checkin-weather-alerts.md) — fired in the background on arrival open.
    // Default to "no alert" so the wizard flow under test is unchanged.
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

// ---- arrival bath-linen upsell (specs/sas-bath-linen-upsell.md) ----

const BATH_LINEN_OFFER = { available: true, unitPrice: 4, priceType: 'per_person', persons: 3, nights: 2, amount: 12, label: 'Linge de toilette' };

// specs/arrival-departure-sas.md rule 8
test('arrival SAS: bath-linen page — « Ajouter le linge de toilette » adds the line to the arrival complement; règlement is on the recap', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2, children: 1 },
    cleaning: { included: true, price: null },
    bathLinen: BATH_LINEN_OFFER,
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText(/n'a pas pris le linge de toilette/);
  expect(screen.getByText(/3 pers/)).toBeInTheDocument();
  clickBtn('Ajouter le linge de toilette');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Total : 12,00 €/)).toBeInTheDocument();
  // Settlement is chosen once for the whole complement on the recap (no payment question at the step).
  expect(screen.getByRole('button', { name: 'En fin de séjour' })).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  // specs/sas-bath-linen-ghost-line.md §1.1 — the SAS sells onto the fiche only: no end-of-stay
  // billing line, hence no `endOfStayBathLinen` in the payload at all.
  expect(arg).not.toHaveProperty('endOfStayBathLinen');
  // specs/sas-upsells-activate-catalogue-option.md §3.1 — the upsell is sent as INTENT; the server
  // activates the catalogue option and prices it. `complementItems` keeps only the linen elements.
  expect(arg.bathLinenAdded).toBe(true);
  expect(arg.complementItems).toEqual([]);
});

test('arrival SAS: bath-linen page — « Non merci » adds nothing at all', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2, children: 1 },
    cleaning: { included: true, price: null },
    bathLinen: BATH_LINEN_OFFER,
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/n'a pas pris le linge de toilette/);
  clickBtn('Non merci');

  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg).not.toHaveProperty('endOfStayBathLinen');
  expect(arg.bathLinenAdded).toBe(false);
  expect(arg.complementItems).toEqual([]);
});

// specs/arrival-departure-sas.md rule 8
test('arrival SAS: bath-linen page is skipped when the offer is unavailable', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1 },
    cleaning: { included: true, price: null },
    // bathLinen default = { available: false }
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText(/n'a pas pris le linge de toilette/)).toBeNull();
});

test('departure SAS: a bath-linen line deferred at arrival is shown, counted in the total, and re-sent on commit', async () => {
  // specs/sas-bath-linen-upsell.md §3.3 — the arrival SAS wrote a `source:'arrivalBathLinen'` end-of-stay
  // line; the check-out recap must display + count it, and the departure commit must preserve it.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      cautionAmount: 0,
      endOfStayComplementDetail: JSON.stringify([{ label: 'Linge de toilette', amount: 12, qty: 3, unitPrice: 4, source: 'arrivalBathLinen' }]),
    },
    cleaning: { included: false, price: 80 },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK'); // +80 end-of-stay
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Linge de toilette/)).toBeInTheDocument();
  expect(screen.getByText(/Total à percevoir : 92,00 €/)).toBeInTheDocument(); // 80 + 12
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  const carried = arg.endOfStayComplementDetail.find((l) => l.source === 'arrivalBathLinen');
  expect(carried).toBeTruthy();
  expect(carried.amount).toBe(12);
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Ménage de fin de séjour' && l.amount === 80)).toBe(true);
});

// specs/arrival-departure-sas.md rule 14
test('departure SAS: the ménage page is dropped when the cleaning is already sold — nothing is billed', async () => {
  // specs/defer-arrival-complement-to-checkout.md §3.1 — the guest bought the cleaning (or it was
  // added at check-in): the host does it, so the departure SAS must not ask, and must not bill it a
  // second time on top of the arrival complement.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: 80 },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // Straight to the « éléments manquants » question — no ménage page.
  await screen.findByText(/serviettes ou des draps sont-ils manquants/);
  expect(screen.queryByText(/fait correctement/)).toBeNull();
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');

  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Ménage déjà réglé/)).toBeInTheDocument();
  expect(screen.getByText(/Aucun complément de fin de séjour/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Ménage de fin de séjour')).toBe(false);
});

test('departure SAS re-open: a cleaning line billed before the ménage was sold is dropped on re-commit', async () => {
  // specs/defer-arrival-complement-to-checkout.md §3.1 rule 4 — re-running the departure SAS is how
  // an already over-billed stay is corrected (no data migration).
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      cautionAmount: 0,
      departureSasDoneAt: '2026-08-02 10:00:00',
      endOfStayComplementDetail: JSON.stringify([{ label: 'Ménage de fin de séjour', amount: 80 }]),
    },
    cleaning: { included: true, price: 80 },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes ou des draps sont-ils manquants/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.endOfStayComplementDetail).toEqual([]);
});

// Régression 2026-08-29 — a « préservée » line (label no longer mapping to any priced item) that was
// offered is stored at 0 € with its price in `unitPrice`. Re-opening read only `amount`, so the recap
// showed 0 € and un-offering restored 0 € instead of the real price — §3.1 rule 3 says offering is
// lossless and reversible.
test('departure SAS re-open: an offered preserved line comes back with its real price, and can be un-offered', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      cautionAmount: 0,
      departureSasDoneAt: '2026-08-02 10:00:00',
      endOfStayComplementDetail: JSON.stringify([
        { label: 'Drap ancien modèle', qty: 1, unitPrice: 0, amount: 0, offered: 1, originalAmount: 24 },
      ]),
    },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');

  await screen.findByText('Récapitulatif fin de séjour');
  // The gesture reopens « ✓ Offert » — 24 € shown, 0 € counted.
  expect(screen.getByText(/Drap ancien modèle : 24,00 €/)).toBeInTheDocument();
  expect(screen.queryByText(/Total à percevoir/)).toBeNull();

  clickBtn('✓ Offert'); // withdraw the gesture
  expect(screen.getByText(/Total à percevoir : 24,00 €/)).toBeInTheDocument();

  clickBtn('CB / Chèque');
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const line = api.commitDepartureSas.mock.calls[0][1].endOfStayComplementDetail
    .find((l) => l.label === 'Drap ancien modèle');
  expect(line).toMatchObject({ qty: 1, unitPrice: 0, amount: 24 });
  expect(line.offered).toBeUndefined();
});

// ── specs/sas-upsells-activate-catalogue-option.md §3.2 rule 7 ────────────────────────────────────
// The upsells are catalogue options now: while the row is the SAS's OWN (`sasOrigin`), the step stays
// visible and pre-selected so the operator can undo it. An option taken at booking still hides it.

test('arrival SAS re-open: a SAS-added ménage keeps its page, pre-selected, and can be removed', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, arrivalSasDoneAt: '2026-08-03 10:00:00' },
    cleaning: { included: false, price: 80, sasOrigin: true },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // The page is there, and the « ajouté » chip reflects the stored option.
  await screen.findByText(/Le ménage n'a pas été pris/);
  expect(screen.getByText(/Ménage ajouté/)).toBeInTheDocument();
  clickBtn('Non merci');

  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].cleaningAdded).toBe(false);
});

test('arrival SAS: a cleaning taken at booking hides the page and is never touched', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1 },
    cleaning: { included: true, price: 80, sasOrigin: false },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText(/Le ménage n'a pas été pris/)).toBeNull();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].cleaningAdded).toBeUndefined();
});

test('arrival SAS re-open: a SAS-added bath linen reopens pre-selected « ajouté »', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, arrivalSasDoneAt: '2026-08-03 10:00:00' },
    cleaning: { included: true, price: null },
    bathLinen: { ...BATH_LINEN_OFFER, sasOrigin: true },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText(/n'a pas pris le linge de toilette/);
  expect(screen.getByText(/Linge ajouté/)).toBeInTheDocument();
  clickBtn('Ajouter le linge de toilette');
  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].bathLinenAdded).toBe(true);
});
