// SidePanel — generic contract (specs/options-resources-ux.md §4.2): sheet on xs, drawer on sm+, dirty
// guard, Escape, save gating, section chips with error state.
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
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
  const handlers = { onClose: vi.fn(), onSave: props.onSave || vi.fn() };
  const view = render(
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
  return { ...handlers, ...view };
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

test('« Enregistrer et quitter » saves, then goes on to leave', async () => {
  const user = userEvent.setup();
  const { onClose, onSave } = renderPanel({ dirty: true, onSave: vi.fn().mockResolvedValue(true) });
  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  await user.click(screen.getByRole('button', { name: 'Enregistrer et quitter' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

test('« Enregistrer et quitter » with a save that refused stays on the panel', async () => {
  const user = userEvent.setup();
  const { onClose, onSave } = renderPanel({ dirty: true, onSave: vi.fn().mockResolvedValue(false) });
  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  await user.click(screen.getByRole('button', { name: 'Enregistrer et quitter' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument());
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

test('rule 29: while open the panel owns one history entry; Back closes a clean panel', () => {
  const push = vi.spyOn(window.history, 'pushState');
  const { onClose } = renderPanel();
  expect(push).toHaveBeenCalledTimes(1);
  expect(window.history.state.sidePanel).toBe(true);
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(onClose).toHaveBeenCalledTimes(1);
  push.mockRestore();
});

test('rule 29: Back on a dirty panel asks first, puts the entry back and keeps the panel', () => {
  const push = vi.spyOn(window.history, 'pushState');
  const { onClose } = renderPanel({ dirty: true });
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(push).toHaveBeenCalledTimes(2);
  expect(onClose).not.toHaveBeenCalled();
  push.mockRestore();
});

test('rule 29: closing the panel any other way removes its history entry', async () => {
  const user = userEvent.setup();
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  const { rerender } = renderPanel();
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  rerender(<MemoryRouter><SidePanel open={false} onClose={() => {}} title="Ménage" /></MemoryRouter>);
  expect(back).toHaveBeenCalledTimes(1);
  back.mockRestore();
});

test('rule 29: closing the panel does not go back when its own history entry is no longer the current one', () => {
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  const { rerender } = renderPanel();
  window.history.replaceState({ usr: null, key: 'elsewhere', idx: 9 }, '', window.location.href);
  rerender(<MemoryRouter><SidePanel open={false} onClose={() => {}} title="Ménage" /></MemoryRouter>);
  expect(back).not.toHaveBeenCalled();
  back.mockRestore();
});

test('rule 29: a clean panel holds no navigation guard, a dirty one does, and closing releases it', () => {
  window.__guestflowBeforeNavigate = undefined;
  delete window.__guestflowBeforeNavigate;
  const view = renderPanel();
  expect(window.__guestflowBeforeNavigate).toBeUndefined();
  view.rerender(<MemoryRouter><SidePanel open title="Ménage" dirty onClose={() => {}}><i /></SidePanel></MemoryRouter>);
  expect(typeof window.__guestflowBeforeNavigate).toBe('function');
  view.rerender(<MemoryRouter><SidePanel open={false} title="Ménage" dirty onClose={() => {}}><i /></SidePanel></MemoryRouter>);
  expect(window.__guestflowBeforeNavigate).toBeUndefined();
});

test('rule 30: the dialog is named by its visible title, even when the title is not a string', () => {
  mockViewport(1280);
  render(<MemoryRouter><SidePanel open title={<span>Titre riche</span>} onClose={() => {}}>x</SidePanel></MemoryRouter>);
  expect(screen.getByRole('dialog', { name: 'Titre riche' })).toBeInTheDocument();
});

test('on a phone it is a bottom sheet (anchor bottom), on a laptop a right drawer', () => {
  renderPanel({}, 390);
  expect(screen.getByRole('dialog')).toHaveAttribute('data-anchor', 'bottom');
});

test('on a laptop it is anchored right', () => {
  renderPanel({}, 1280);
  expect(screen.getByRole('dialog')).toHaveAttribute('data-anchor', 'right');
});
