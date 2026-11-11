// specs/booking-extranet-intake.md rules 2 and 12 — the « Saisie Booking » card: install link, secret
// regeneration with its warning, the establishment map, the counted sources, the last intakes.
import React, { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPluginSettings: vi.fn(), savePluginSettings: vi.fn(), getProperties: vi.fn(), getBookingIntakeLog: vi.fn(), regenerateBookingIntakeSecret: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../sdk', () => ({ api, displayDate: (iso) => iso.split('-').reverse().join('/'), useAppDialogs: () => ({ confirm }) }));

import SettingsSection from '../SettingsSection';

const SETTINGS = { hotelIds: '{"1":"14407976"}', keySet: true };

beforeEach(() => {
  api.getPluginSettings.mockResolvedValue(SETTINGS);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'La Granja' }, { id: 2, name: 'L’Estiva' }]);
  api.getBookingIntakeLog.mockResolvedValue([
    { id: 2, resId: '6300000001', status: 'applied', createdAt: '2026-10-15 13:52:00', error: null },
    { id: 1, resId: '6300000002', status: 'refused', createdAt: '2026-10-15 13:40:00', error: 'Aucune fiche du 06/11 au 08/11' },
  ]);
});
afterEach(() => vi.clearAllMocks());

test('specs/booking-extranet-intake.md rule 2: « Installer le script » opens the script of this instance, nothing about credentials is asked', async () => {
  render(<SettingsSection />);
  const install = await screen.findByRole('link', { name: 'Installer le script' });
  expect(install).toHaveAttribute('href', '/api/booking-intake/userscript.user.js');
  expect(screen.queryByLabelText(/mot de passe|identifiant/i)).not.toBeInTheDocument();
});

test('specs/booking-extranet-intake.md rule 2: regenerating the secret warns that installed scripts stop working, and only acts on confirmation', async () => {
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  api.regenerateBookingIntakeSecret.mockResolvedValue({ ok: true });
  render(<SettingsSection />);
  const button = await screen.findByRole('button', { name: 'Régénérer le secret' });
  await userEvent.click(button);
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/cesseront de fonctionner/) }));
  expect(api.regenerateBookingIntakeSecret).not.toHaveBeenCalled();
  await userEvent.click(button);
  await waitFor(() => expect(api.regenerateBookingIntakeSecret).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('Secret régénéré. Réinstaller le script.')).toBeInTheDocument();
});

test('specs/booking-extranet-intake.md rule 12: the establishment id of each property is edited, digits only, and saved through the ref', async () => {
  api.savePluginSettings.mockImplementation(async (_id, values) => ({ ...SETTINGS, ...values }));
  const onDirtyChange = vi.fn();
  const ref = createRef();
  render(<SettingsSection ref={ref} onDirtyChange={onDirtyChange} />);
  const estiva = await screen.findByLabelText('L’Estiva');
  expect(screen.getByLabelText('La Granja')).toHaveValue('14407976');
  await userEvent.type(estiva, '12ab34');
  expect(estiva).toHaveValue('1234');
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  await ref.current.save();
  expect(api.savePluginSettings).toHaveBeenCalledWith('booking-intake', {
    hotelIds: '{"1":"14407976","2":"1234"}',
  });
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});

test('specs/booking-extranet-intake.md rule 21 (amended 2026-10-18): no field asks which iCal sources count as Booking', async () => {
  render(<SettingsSection />);
  await screen.findByLabelText('La Granja');
  expect(screen.queryByLabelText(/Sources iCal/)).not.toBeInTheDocument();
});

test('specs/booking-extranet-intake.md rule 20: the last pages received are listed with their outcome and the reason of a refusal', async () => {
  render(<SettingsSection />);
  expect(await screen.findByText(/15\/10\/2026 · 6300000001 · rempli/)).toBeInTheDocument();
  expect(screen.getByText(/6300000002 · refusé \(Aucune fiche du 06\/11 au 08\/11\)/)).toBeInTheDocument();
});

test('specs/booking-extranet-intake.md rule 12: a refused save shows the server’s message under the field and rejects', async () => {
  api.savePluginSettings.mockRejectedValue(Object.assign(new Error('INVALID'), { errors: { hotelIds: 'Un identifiant d’établissement Booking est fait de chiffres.' } }));
  const ref = createRef();
  render(<SettingsSection ref={ref} />);
  await userEvent.type(await screen.findByLabelText('L’Estiva'), '1');
  await expect(ref.current.save()).rejects.toThrow('INVALID');
  expect(await screen.findByText('Un identifiant d’établissement Booking est fait de chiffres.')).toBeInTheDocument();
});
