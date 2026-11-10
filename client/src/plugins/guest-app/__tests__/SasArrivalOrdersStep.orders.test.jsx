// specs/guest-app.md rules 71, 87 — the arrival SAS step « Commandes Mon séjour »: a collapsible list drawn from the server's payload
// (unfolded while something is to collect, folded when every order is paid), an unpaid order edited line by line or removed through a
// confirmation, a card-paid one read-only; every figure is the server's.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import guestAppApi from '../guestAppApi';
import SasArrivalOrdersStep from '../SasArrivalOrdersStep';

vi.mock('../guestAppApi', () => ({ default: { amendOrder: vi.fn() } }));

const line = (over) => ({ key: 'opt:1', label: 'Cidre fermier', quantity: 2, unitLabel: '2 × 6 €', amountLabel: '12 €', editable: true, removable: true, maxQuantity: 5, ...over });
const unpaid = { id: 7, number: 7, deliveryLabel: 'ven. 13 nov., 18 h', statusLabel: 'À régler à l’arrivée', paid: false, editable: true, totalLabel: '12 €', lines: [line()] };
const paid = { id: 8, number: 8, deliveryLabel: null, statusLabel: 'Payée par carte', paid: true, editable: false, totalLabel: '6 €', lines: [line({ key: 'opt:2', label: 'Jus', quantity: 1, unitLabel: '1 × 6 €', amountLabel: '6 €', editable: false, removable: false, maxQuantity: 1 })] };
const DATA = { ordersAtArrival: { orders: [unpaid, paid], summaryLabel: '2 commandes · 12 € à percevoir · 6 € payés par carte', toCollect: 12, toCollectLabel: '12 €', paid: 6, paidLabel: '6 €', changed: false } };

beforeEach(() => vi.clearAllMocks());

describe('SasArrivalOrdersStep', () => {
  it('rule 71: the summary line names the orders and what is to collect; the list is unfolded while something is to collect, with each order\'s lines and totals', () => {
    render(<SasArrivalOrdersStep data={DATA} />);
    expect(screen.getByRole('button', { name: /2 commandes · 12 € à percevoir · 6 € payés par carte/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Commande n° 7')).toBeInTheDocument();
    expect(screen.getByText('ven. 13 nov., 18 h')).toBeInTheDocument();
    expect(screen.getByText('2 × 6 €')).toBeInTheDocument();
    expect(screen.getByText('Total à percevoir')).toBeInTheDocument();
    expect(screen.getByText('Déjà payé par carte')).toBeInTheDocument();
  });

  it('rule 71: every order paid — the list is folded, and unfolds on a tap', () => {
    render(<SasArrivalOrdersStep data={{ ordersAtArrival: { ...DATA.ordersAtArrival, orders: [paid], summaryLabel: '1 commande · 6 € payés par carte', toCollect: 0, toCollectLabel: '0 €' } }} />);
    const toggle = screen.getByRole('button', { name: /1 commande/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Commande n° 8')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Commande n° 8')).toBeInTheDocument();
  });

  it('rule 87: a paid order is read-only — no stepper, no « Retirer »', () => {
    render(<SasArrivalOrdersStep data={DATA} />);
    const group = screen.getByRole('region', { name: 'Commande n° 8' });
    expect(group.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Commande n° 7' }).querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('rule 87: a quantity step is one amend request, and the list shows the server\'s answer', async () => {
    guestAppApi.amendOrder.mockResolvedValue({ ordersAtArrival: { ...DATA.ordersAtArrival, orders: [{ ...unpaid, totalLabel: '18 €', lines: [line({ quantity: 3, amountLabel: '18 €' })] }, paid], summaryLabel: '2 commandes · 18 € à percevoir', toCollect: 18, toCollectLabel: '18 €', changed: true } });
    render(<SasArrivalOrdersStep data={DATA} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus de Cidre fermier' }));
    await waitFor(() => expect(screen.getByText('18 €', { selector: 'p, span' })).toBeInTheDocument());
    expect(guestAppApi.amendOrder).toHaveBeenCalledWith(7, { lines: [{ key: 'opt:1', quantity: 3 }] });
    expect(screen.getByText(/Lignes modifiées depuis la commande/)).toBeInTheDocument();
  });

  it('rule 87 (audit item 3): after an amendment the SAS data is read again — the step asks `onRefresh`, and shows the fresh payload it is given', async () => {
    const fresh = { ...DATA.ordersAtArrival, orders: [{ ...unpaid, totalLabel: '6 €', lines: [line({ quantity: 1, amountLabel: '6 €' })] }, paid], toCollect: 6, toCollectLabel: '6 €', summaryLabel: '2 commandes · 6 € à percevoir' };
    guestAppApi.amendOrder.mockResolvedValue({ ordersAtArrival: fresh });
    const onRefresh = vi.fn().mockResolvedValue();
    const { rerender } = render(<SasArrivalOrdersStep data={DATA} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Moins de Cidre fermier' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    rerender(<SasArrivalOrdersStep data={{ ordersAtArrival: fresh }} onRefresh={onRefresh} />);
    expect(screen.getByRole('button', { name: /2 commandes · 6 € à percevoir/ })).toBeInTheDocument();
  });

  it('rule 87: an amendment that leaves nothing to show reads « Plus aucune commande à percevoir. », never a blank page', () => {
    render(<SasArrivalOrdersStep data={{}} />);
    expect(screen.getByText('Plus aucune commande à percevoir.')).toBeInTheDocument();
  });

  it('rule 71 (item 9): the order\'s rows keep the price beside the label, the controls take their own row — the bath is one row with its evening supplement said inside it', () => {
    const bath = line({ key: 'res:9', label: 'Bain nordique', quantity: 1, unitLabel: 'ven. 13 nov., 20 h – 21 h · offerte · + 10 € soirée', amountLabel: '10 €', editable: false, removable: true });
    render(<SasArrivalOrdersStep data={{ ordersAtArrival: { ...DATA.ordersAtArrival, orders: [{ ...unpaid, lines: [bath] }] } }} />);
    expect(screen.getByText('ven. 13 nov., 20 h – 21 h · offerte · + 10 € soirée')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plus de Bain nordique/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retirer' })).toBeInTheDocument();
  });

  it('rule 87: « Retirer la commande » asks first, then amends with removeOrder; a refusal is said', async () => {
    guestAppApi.amendOrder.mockRejectedValue(new Error('Commande non modifiable.'));
    render(<SasArrivalOrdersStep data={DATA} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la commande' }));
    expect(guestAppApi.amendOrder).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/La commande n° 7 est retirée du séjour/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer la commande' }));
    await waitFor(() => expect(guestAppApi.amendOrder).toHaveBeenCalledWith(7, { removeOrder: true }));
    expect(await screen.findByText('Commande non modifiable.')).toBeInTheDocument();
  });
});
