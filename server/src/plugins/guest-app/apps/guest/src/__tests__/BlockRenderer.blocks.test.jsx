// specs/guest-app.md rules 11ter, 18, 49 — one renderer per block type, fed by props only (the studio preview renders
// the same components); an unknown type draws nothing.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BlockRenderer, { BlockList, RENDERERS } from '../components/BlockRenderer';

const IMAGE = { url: '/uploads/a-1600.webp', sizes: { 400: '/uploads/a-400.webp', 800: '/uploads/a-800.webp', 1600: '/uploads/a-1600.webp' }, width: 1600, height: 1067, alt: 'Le bain' };

describe('BlockRenderer', () => {
  it('rule 18: the closed list of block types, one renderer each', () => {
    expect(Object.keys(RENDERERS).sort()).toEqual(['button', 'callout', 'contact', 'faq', 'gallery', 'hours', 'image', 'place', 'steps', 'text', 'wifi']);
  });

  it('text: the server\'s sanitised HTML, links kept', () => {
    render(<BlockRenderer block={{ type: 'text', html: '<p>Bienvenue à <b>La Granja</b> — <a href="tel:+33600000000">appelez</a></p>' }} />);
    expect(screen.getByText('La Granja').tagName).toBe('B');
    expect(screen.getByRole('link', { name: 'appelez' })).toHaveAttribute('href', 'tel:+33600000000');
  });

  it('image and gallery: responsive sources and alt text from the media payload', () => {
    render(<BlockList blocks={[{ type: 'image', image: IMAGE, caption: 'Au crépuscule' }, { type: 'gallery', items: [{ image: IMAGE }, { image: { ...IMAGE, alt: 'Le poêle' } }] }]} />);
    expect(screen.getAllByRole('img', { name: 'Le bain' })[0]).toHaveAttribute('srcset', expect.stringContaining('/uploads/a-400.webp 400w'));
    expect(screen.getByText('Au crépuscule')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Le poêle' })).toBeInTheDocument();
  });

  it('callout: a warning is a note with its title', () => {
    render(<BlockRenderer block={{ type: 'callout', tone: 'warning', title: 'Chemin étroit', text: 'Roulez au pas.' }} />);
    expect(screen.getByRole('note')).toHaveTextContent('Chemin étroitRoulez au pas.');
  });

  it('steps: numbered, in order', () => {
    render(<BlockRenderer block={{ type: 'steps', steps: [{ text: 'Ouvrez' }, { text: 'Garez-vous' }] }} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1Ouvrez', '2Garez-vous']);
  });

  it('rule 11ter: wifi shows the lodging\'s network and copies the password; without wifi, the lodging\'s message', () => {
    const onCopy = vi.fn();
    const { unmount } = render(<BlockRenderer block={{ type: 'wifi', available: true, network: 'Solio', password: 'chenes', joinQr: 'data:image/png;base64,AA' }} onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copier' }));
    expect(onCopy).toHaveBeenCalledWith('chenes');
    expect(screen.getByRole('img', { name: 'QR code pour rejoindre le wifi' })).toBeInTheDocument();
    unmount();
    render(<BlockRenderer block={{ type: 'wifi', available: false, text: 'À La Granja, il n’y a pas de wifi.' }} />);
    expect(screen.getByText('À La Granja, il n’y a pas de wifi.')).toBeInTheDocument();
  });

  it('contact: call, WhatsApp and e-mail as links', () => {
    render(<BlockRenderer block={{ type: 'contact', contacts: [{ name: 'Sophie', role: 'Accueil', phone: '+33 6 12', telUrl: 'tel:+33612', whatsappUrl: 'https://wa.me/33612', mailto: 'mailto:s@x.test' }] }} />);
    expect(screen.getByRole('link', { name: 'Appeler' })).toHaveAttribute('href', 'tel:+33612');
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/33612');
    expect(screen.getByRole('link', { name: 'E-mail' })).toHaveAttribute('href', 'mailto:s@x.test');
  });

  it('place, faq, hours: the server\'s words', () => {
    render(<BlockList blocks={[
      { type: 'place', name: 'Déchetterie', address: '07270 Lamastre', mapsUrl: 'https://maps.example/x' },
      { type: 'faq', items: [{ question: 'Combien de temps ?', answer: 'Trois heures.' }] },
      { type: 'hours', title: 'Horaires', rows: [{ label: 'Départ', value: 'avant 10 h' }] },
    ]} />);
    expect(screen.getByRole('link', { name: 'Itinéraire' })).toHaveAttribute('href', 'https://maps.example/x');
    expect(screen.getByText('Combien de temps ?').closest('details')).toBeInTheDocument();
    expect(screen.getByText('avant 10 h')).toBeInTheDocument();
  });

  it('button: a page or an item target goes back to the app, a url opens outside', () => {
    const onNavigate = vi.fn();
    const { unmount } = render(<BlockRenderer block={{ type: 'button', label: 'Réserver un créneau', target: { kind: 'item', itemKind: 'resource', itemId: 6 } }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Réserver un créneau' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'item', itemKind: 'resource', itemId: 6 });
    unmount();
    render(<BlockRenderer block={{ type: 'button', label: 'Le site', target: { kind: 'url', href: 'https://domainesolio.com' } }} />);
    expect(screen.getByRole('link', { name: 'Le site' })).toHaveAttribute('target', '_blank');
  });

  it('an unknown type draws nothing', () => {
    const { container } = render(<BlockRenderer block={{ type: 'video', url: 'x' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
