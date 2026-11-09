// specs/guest-app.md rules 11quater, 48 — the studio opens on GuestFlow's own lodgings: their live names, a lodging
// out of the app greyed « Hors application » yet selectable.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LodgingSwitcher from '../components/LodgingSwitcher';

const LODGINGS = [
  { propertyId: 1, name: 'La Granja', enabled: true, stateLabel: null },
  { propertyId: 2, name: 'L’Estiva (renommée)', enabled: true, stateLabel: null },
  { propertyId: 3, name: 'La Cabane', enabled: false, stateLabel: 'Hors application' },
];

describe('LodgingSwitcher (rule 48)', () => {
  it('lists every lodging with its GuestFlow name, in the order given, and marks the current one', () => {
    render(<LodgingSwitcher lodgings={LODGINGS} currentId={2} onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['La Granja', 'L’Estiva (renommée)', 'La CabaneHors application']);
    expect(buttons[1]).toHaveAttribute('aria-current', 'page');
  });

  it('a lodging out of the app is greyed « Hors application » and can still be opened', async () => {
    const onSelect = vi.fn();
    render(<LodgingSwitcher lodgings={LODGINGS} currentId={1} onSelect={onSelect} />);
    const cabane = screen.getByRole('button', { name: /La Cabane/ });
    expect(cabane).toHaveTextContent('Hors application');
    expect(cabane).toHaveStyle({ opacity: '0.62' });
    await userEvent.setup().click(cabane);
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});
