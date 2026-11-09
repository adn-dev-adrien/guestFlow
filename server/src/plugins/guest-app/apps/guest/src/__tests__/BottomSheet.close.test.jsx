// specs/guest-app.md §6.4 — every bottom sheet (and the centred dialog it becomes from 900 px) has a visible
// « Fermer » button with an accessible name; focus stays in the sheet.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BottomSheet from '../components/BottomSheet';
import { LangContext } from '../i18n';

function renderSheet(onClose, lang = 'fr') {
  return render(
    <LangContext.Provider value={lang}>
      <div className="app wide">
        <button type="button">Derrière</button>
        <BottomSheet open onClose={onClose} label="Wifi"><p>Réseau Solio</p><button type="button">Copier</button></BottomSheet>
      </div>
    </LangContext.Provider>,
  );
}

describe('BottomSheet — « Fermer » (§6.4)', () => {
  it('closes from a named 44 px button inside the dialog', async () => {
    const onClose = vi.fn();
    renderSheet(onClose);
    const dialog = screen.getByRole('dialog', { name: 'Wifi' });
    const close = screen.getByRole('button', { name: 'Fermer' });
    expect(dialog).toContainElement(close);
    expect(close).toHaveClass('x');
    await userEvent.setup().click(close);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the focus inside the sheet, the close button reachable by keyboard', async () => {
    renderSheet(vi.fn());
    const user = userEvent.setup();
    const layer = screen.getByRole('dialog', { name: 'Wifi' }).parentElement;
    await waitFor(() => expect(layer).toContainElement(document.activeElement));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copier' })).toHaveFocus();
    await user.tab();
    expect(layer).toContainElement(document.activeElement);
  });

  it('is named in English too', () => {
    renderSheet(vi.fn(), 'en');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
