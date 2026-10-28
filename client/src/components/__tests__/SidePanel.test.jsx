// SidePanel — generic contract (specs/options-resources-ux.md §4.2): sheet on xs, drawer on sm+, dirty
// guard, Escape, save gating, section chips with error state.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import SidePanel, { SidePanelSection, errorCountLabel } from '../SidePanel';

function mockViewport(width) {
  window.matchMedia = (query) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const matches = !query.includes('prefers-reduced-motion') && (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return { matches, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  };
}
afterEach(() => { delete window.matchMedia; });

function renderPanel(props = {}, width = 1280) {
  mockViewport(width);
  const handlers = { onClose: vi.fn(), onSave: vi.fn() };
  render(
    <MemoryRouter>
      <SidePanel
        open
        title="Ménage"
        sections={[{ id: 'gen', label: 'Général' }, { id: 'prix', label: 'Prix', hasError: true }]}
        {...handlers}
        {...props}
      >
        <SidePanelSection id="gen" title="Général"><input aria-label="Nom" /></SidePanelSection>
        <SidePanelSection id="prix" title="Prix"><input aria-label="Montant" /></SidePanelSection>
      </SidePanel>
    </MemoryRouter>,
  );
  return handlers;
}

test('is a dialog named by its title, with a close button of 44 px', () => {
  renderPanel();
  expect(screen.getByRole('dialog', { name: 'Ménage' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
});

test('renders nothing while closed', () => {
  mockViewport(1280);
  render(<MemoryRouter><SidePanel open={false} onClose={() => {}} title="X">contenu</SidePanel></MemoryRouter>);
  expect(screen.queryByText('contenu')).not.toBeInTheDocument();
});

test('closes at once when nothing changed: close button, Annuler and Escape', async () => {
  const user = userEvent.setup();
  const { onClose } = renderPanel();
  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(3);
});

test('with unsaved changes, closing asks first and « Rester » keeps the panel open', async () => {
  const user = userEvent.setup();
  const { onClose } = renderPanel({ dirty: true });
  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Rester sur la page' }));
  expect(onClose).not.toHaveBeenCalled();
});

test('« Quitter sans enregistrer » closes without saving', async () => {
  const user = userEvent.setup();
  const { onClose, onSave } = renderPanel({ dirty: true });
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});

test('« Enregistrer et quitter » saves and leaves closing to the owner', async () => {
  const user = userEvent.setup();
  const { onClose, onSave } = renderPanel({ dirty: true });
  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  await user.click(screen.getByRole('button', { name: 'Enregistrer et quitter' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

test('Enregistrer is disabled until something changed, then enabled; the footer says « Modifié »', () => {
  const { unmount } = render(<span />);
  unmount();
  renderPanel();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('a dirty form can be saved and says « Modifié »', async () => {
  const user = userEvent.setup();
  const { onSave } = renderPanel({ dirty: true });
  expect(screen.getByText('Modifié')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledTimes(1);
});

test('invalid fields disable saving and are counted, singular and plural', () => {
  renderPanel({ dirty: true, errorCount: 2 });
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  expect(screen.getByText('2 champs à corriger')).toBeInTheDocument();
  expect(errorCountLabel(1)).toBe('1 champ à corriger');
});

test('saving shows a spinner and blocks a second click', () => {
  renderPanel({ dirty: true, saving: true });
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

test('section chips scroll to their section and flag the ones holding an error', async () => {
  const user = userEvent.setup();
  renderPanel();
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const prix = screen.getByRole('button', { name: 'Prix' });
  expect(prix).toHaveAttribute('data-has-error', 'true');
  expect(screen.getByRole('button', { name: 'Général' })).not.toHaveAttribute('data-has-error');
  await user.click(prix);
  expect(scrollIntoView).toHaveBeenCalled();
  expect(scrollIntoView.mock.contexts[0]).toBe(document.querySelector('[data-side-panel-section="prix"]'));
});

test('on a phone it is a bottom sheet (anchor bottom), on a laptop a right drawer', () => {
  renderPanel({}, 390);
  expect(screen.getByRole('dialog')).toHaveAttribute('data-anchor', 'bottom');
});

test('on a laptop it is anchored right', () => {
  renderPanel({}, 1280);
  expect(screen.getByRole('dialog')).toHaveAttribute('data-anchor', 'right');
});
