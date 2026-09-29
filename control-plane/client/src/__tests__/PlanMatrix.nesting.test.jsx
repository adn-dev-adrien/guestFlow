// specs/control-plane-plans-and-access.md rules 2 and 3 — the catalogue page renders the server's
// matrix (own / inherited cells with their tooltip), sends each click to the server, and shows the
// refusal of a click that would break the nesting.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import CataloguePage from '../pages/CataloguePage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { catalogue: vi.fn(), toggleCell: vi.fn(), catalogueImpact: vi.fn(), saveCatalogue: vi.fn() } }));

const plans = [
  { code: 'essentiel', name: 'Essentiel', priceLabel: '29,00 € / mois', priceMonthlyCents: 2900, priceYearlyCents: 2400, maxUnits: 2, maxUsers: 2 },
  { code: 'pro', name: 'Pro', priceLabel: '59,00 € / mois', priceMonthlyCents: 5900, priceYearlyCents: 4900, maxUnits: 6, maxUsers: 5 },
];
const row = (pluginId, name, a, b, tip) => ({ pluginId, name, cells: [{ planCode: 'essentiel', status: a, tooltip: a === 'own' ? 'Ajouté à partir de ce forfait' : 'Non inclus' }, { planCode: 'pro', status: b, tooltip: tip }] });
const view = {
  version: 1, plans, lowest: { sas: 'essentiel', linen: 'pro' },
  matrix: [row('sas', 'Arrivée et départ guidés', 'own', 'inherited', 'Inclus via Essentiel'), row('linen', 'Linge et blanchisserie', 'none', 'own', 'Ajouté à partir de ce forfait')],
  addons: [], addonChoices: [], versions: [{ version: 1, day: '29/09/2026', reason: 'Catalogue initial', changedBy: 'seed' }],
};

beforeEach(() => { setWidth(1280); vi.clearAllMocks(); api.catalogue.mockResolvedValue(view); });

it('rule 2 — an inherited cell is labelled by its lower plan, and a refused click shows the reason', async () => {
  api.toggleCell.mockRejectedValue(new Error('Refusé : Arrivée et départ guidés est inclus via Essentiel.'));
  renderAt(<CataloguePage />);
  const inherited = await screen.findByLabelText('Arrivée et départ guidés — Pro : Inclus via Essentiel');
  fireEvent.click(inherited);
  expect(api.toggleCell).toHaveBeenCalledWith(view.lowest, 'sas', 'pro');
  expect(await screen.findByText(/Refusé : Arrivée et départ guidés est inclus via Essentiel/)).toBeInTheDocument();
});

it('rule 3 — an accepted click redraws the matrix the server returns', async () => {
  api.toggleCell.mockResolvedValue({
    lowest: { sas: 'essentiel', linen: 'essentiel' },
    matrix: [view.matrix[0], row('linen', 'Linge et blanchisserie', 'own', 'inherited', 'Inclus via Essentiel')],
    message: 'Linge et blanchisserie descend en Essentiel.',
  });
  renderAt(<CataloguePage />);
  fireEvent.click(await screen.findByLabelText('Linge et blanchisserie — Essentiel : Non inclus'));
  expect(await screen.findByText('Linge et blanchisserie descend en Essentiel.')).toBeInTheDocument();
  expect(screen.getByLabelText('Linge et blanchisserie — Pro : Inclus via Essentiel')).toBeInTheDocument();
});

it('rule 2 — on a phone the matrix becomes one card per plan', async () => {
  setWidth(375);
  renderAt(<CataloguePage />);
  expect(await screen.findByRole('heading', { name: 'Essentiel' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('rule 5 — saving shows the impact and needs a reason', async () => {
  api.catalogueImpact.mockResolvedValue({ lines: ['2 clients Pro gagnent Linge (disponible, pas installé d’office).'] });
  api.saveCatalogue.mockResolvedValue({ ...view, version: 2 });
  renderAt(<CataloguePage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText(/2 clients Pro gagnent Linge/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Motif (obligatoire)'), { target: { value: 'Linge pour tous' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' }).pop());
  await waitFor(() => expect(api.saveCatalogue).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Linge pour tous', lowest: view.lowest })));
  expect(await screen.findByText(/Catalogue v2 enregistré/)).toBeInTheDocument();
});
