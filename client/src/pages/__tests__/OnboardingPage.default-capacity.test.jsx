// specs/plugins-phase-p-productisation.md §3.D rule 21 (2026-10-23) — the capacity of step 2 follows
// the server's proposal for the beds, a late answer never overwrites a newer one, a failed request
// leaves the field editable, and a capacity typed by hand stops following.
import { vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getOnboarding: vi.fn(), saveOnboardingCompany: vi.fn(), saveOnboardingProperty: vi.fn(),
    getOnboardingDefaultCapacity: vi.fn(), completeOnboarding: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refresh: vi.fn().mockResolvedValue() }) }));

import api from '../../api';
import { FRESH_ONBOARDING, openPropertyStep, typeInto } from './onboardingCapacityFixtures';

const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

beforeEach(() => {
  vi.clearAllMocks();
  api.getOnboarding.mockResolvedValue(FRESH_ONBOARDING);
  api.saveOnboardingCompany.mockResolvedValue({ loginChanged: false });
  // A marker no client-side formula would produce, so the field can only show the server's value.
  api.getOnboardingDefaultCapacity.mockImplementation(async (d, s) => ({ maxGuests: 10 * Number(d) + Number(s) }));
});

test('the capacity shows what the server proposes for the beds, asked once typing settles', async () => {
  await openPropertyStep();
  typeInto('Lits doubles', '2');
  typeInto('Lits simples', '3');
  await waitFor(() => expect(screen.getByLabelText('Capacité')).toHaveValue(23));
  expect(api.getOnboardingDefaultCapacity).toHaveBeenCalledTimes(1);
  expect(api.getOnboardingDefaultCapacity).toHaveBeenCalledWith('2', '3');
});

test('an older answer arriving after a newer one is dropped', async () => {
  let releaseFirst;
  api.getOnboardingDefaultCapacity
    .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve({ maxGuests: 99 }); }))
    .mockImplementationOnce(async () => ({ maxGuests: 31 }));
  await openPropertyStep();
  typeInto('Lits doubles', '3');
  await waitFor(() => expect(api.getOnboardingDefaultCapacity).toHaveBeenCalledTimes(1));
  typeInto('Lits simples', '1');
  await waitFor(() => expect(screen.getByLabelText('Capacité')).toHaveValue(31));
  releaseFirst();
  await pause(20);
  expect(screen.getByLabelText('Capacité')).toHaveValue(31);
});

test('a failed request leaves the field as it is and editable', async () => {
  api.getOnboardingDefaultCapacity.mockRejectedValue(new Error('offline'));
  await openPropertyStep();
  typeInto('Lits doubles', '2');
  await waitFor(() => expect(api.getOnboardingDefaultCapacity).toHaveBeenCalled());
  expect(screen.getByLabelText('Capacité')).toHaveValue(2);
  typeInto('Capacité', '4');
  expect(screen.getByLabelText('Capacité')).toHaveValue(4);
});

test('a capacity typed by hand stops following the beds', async () => {
  await openPropertyStep();
  typeInto('Capacité', '3');
  typeInto('Lits doubles', '4');
  await pause(350);
  expect(api.getOnboardingDefaultCapacity).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Capacité')).toHaveValue(3);
});
