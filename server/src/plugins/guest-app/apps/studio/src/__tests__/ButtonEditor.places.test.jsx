// specs/guest-app/guest-app-local-amenities.md rules 10, 18 — the button's « Pratique » target offers the categories the server lists
// (`GET /places`); the Studio keeps no copy of the closed set.
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ButtonEditor from '../components/blockEditors/ButtonEditor';
import { api } from '../services/api';
import { renderStudio } from './studioFixtures';

vi.mock('../services/api', () => ({ api: { places: vi.fn() } }));

describe('ButtonEditor — the « Pratique » target', () => {
  it('offers « Toutes » and the server\'s categories, and sends the chosen one', async () => {
    api.places.mockResolvedValue({ categories: [{ key: 'dechets', label: 'Déchets' }, { key: 'poste', label: 'La Poste' }] });
    const onChange = vi.fn();
    renderStudio(<ButtonEditor data={{ label: { fr: 'Voir', en: 'See' }, target: { kind: 'places' } }} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Catégorie' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Toutes', 'Déchets', 'La Poste']);
    await user.click(within(list).getByRole('option', { name: 'Déchets' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'places', category: 'dechets' } }));
  });
});
