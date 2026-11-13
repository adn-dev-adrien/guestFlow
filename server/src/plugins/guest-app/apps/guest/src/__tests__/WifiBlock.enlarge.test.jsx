// specs/guest-app.md rule 18 `wifi`, reading of 2026-11-13 — the join QR is scanned by another phone: a tap on the
// ticket's QR opens it full screen with the network's name, and « Fermer » brings the ticket back.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WifiBlock from '../components/blocks/WifiBlock';

const BLOCK = { available: true, network: 'Solio-Granja', password: 'chenes', joinQr: 'data:image/png;base64,AA' };

describe('WifiBlock — QR full screen', () => {
  it('a tap on the QR opens it full screen; « Fermer » closes it', () => {
    render(<div className="app"><WifiBlock block={BLOCK} /></div>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Toucher pour agrandir/ }));
    const dialog = screen.getByRole('dialog', { name: 'QR code pour rejoindre le wifi' });
    expect(dialog).toHaveTextContent('Solio-Granja');
    expect(dialog).toHaveTextContent('Scanner avec l’appareil photo d’un autre téléphone');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no QR, nothing to enlarge', () => {
    render(<WifiBlock block={{ ...BLOCK, joinQr: undefined }} />);
    expect(screen.queryByRole('button', { name: /Toucher pour agrandir/ })).not.toBeInTheDocument();
  });
});
