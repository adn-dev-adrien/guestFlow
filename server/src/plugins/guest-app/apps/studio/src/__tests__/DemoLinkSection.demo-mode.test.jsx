// specs/guest-app/guest-app-demo-mode.md rules 1, 2 — Réglages › « Lien de démo »: the QR and the link, « Copier le lien », « Ouvrir »,
// « Régénérer le lien » after a confirmation (the old link stops), and the one line that says what the demo is.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoLinkSection from '../components/DemoLinkSection';
import { api } from '../services/api';
import { renderStudio } from './studioFixtures';

vi.mock('../services/api', () => ({
  api: { demoLink: vi.fn(), regenerateDemoLink: vi.fn() },
}));

const LINK = { url: 'https://sejour.example.test/d/abc', qrDataUri: 'data:image/png;base64,AAAA', createdAt: 'x' };

describe('DemoLinkSection (rules 1, 2)', () => {
  it('shows the line, the QR and the link, and « Ouvrir » points at it', async () => {
    api.demoLink.mockResolvedValue(LINK);
    renderStudio(<DemoLinkSection />);
    expect(await screen.findByText('https://sejour.example.test/d/abc')).toBeInTheDocument();
    expect(screen.getByText('Un séjour fictif, sans paiement ni effet réel. À montrer, pas à envoyer à un voyageur.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR code du lien de démo' })).toHaveAttribute('src', LINK.qrDataUri);
    expect(screen.getByRole('link', { name: 'Ouvrir' })).toHaveAttribute('href', LINK.url);
  });

  it('« Copier le lien » puts the link on the clipboard', async () => {
    api.demoLink.mockResolvedValue(LINK);
    const user = userEvent.setup();
    renderStudio(<DemoLinkSection />);
    await screen.findByText(LINK.url);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Copier le lien' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK.url));
    expect(await screen.findByText('Lien copié.')).toBeInTheDocument();
  });

  it('« Régénérer le lien » asks first, then shows the new link', async () => {
    api.demoLink.mockResolvedValue(LINK);
    api.regenerateDemoLink.mockResolvedValue({ ...LINK, url: 'https://sejour.example.test/d/new' });
    const user = userEvent.setup();
    renderStudio(<DemoLinkSection />);
    await screen.findByText(LINK.url);
    await user.click(screen.getByRole('button', { name: 'Régénérer le lien' }));
    expect(api.regenerateDemoLink).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Régénérer' }));
    expect(await screen.findByText('https://sejour.example.test/d/new')).toBeInTheDocument();
    expect(screen.getByText('Nouveau lien : l’ancien ne s’ouvre plus.')).toBeInTheDocument();
  });

  it('says why when the app has no address yet', async () => {
    api.demoLink.mockRejectedValue(new Error('Il manque l’adresse de l’application (Paramètres › Intégrations).'));
    renderStudio(<DemoLinkSection />);
    expect(await screen.findByText(/Il manque l’adresse de l’application/)).toBeInTheDocument();
  });
});
