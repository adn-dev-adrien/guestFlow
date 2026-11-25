// specs/gift-voucher-campaigns.md rule 4 — the add-ons list is a checklist that stays open after a pick.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddOnsPicker from '../AddOnsPicker';

const elements = [
  { kind: 'option', articleRef: 'option:1', label: 'Bouteille de cidre', priceTypeLabel: 'Par unité', sellable: true },
  { kind: 'option', articleRef: 'option:2', label: 'Planche apéritive', priceTypeLabel: 'Par personne', sellable: true },
  { kind: 'option', articleRef: 'option:3', label: 'Ménage', priceTypeLabel: 'Par jour', sellable: false, reason: 'Demande un séjour' },
];

function Harness() {
  const [value, setValue] = React.useState([]);
  return <AddOnsPicker value={value} onChange={setValue} elements={elements} label="Options à proposer" />;
}

describe('AddOnsPicker — checklist', () => {
  it('keeps the list open after a pick and ticks each picked option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText('Options à proposer'));

    await user.click(screen.getByRole('option', { name: /Bouteille de cidre/ }));
    const listbox = screen.getByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: /Planche apéritive/ }));

    const boxes = within(screen.getByRole('listbox')).getAllByRole('checkbox', { hidden: true });
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false]);
    expect(boxes[2]).toBeDisabled();
  });
});
