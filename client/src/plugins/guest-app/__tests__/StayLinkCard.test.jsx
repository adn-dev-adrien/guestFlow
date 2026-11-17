// specs/guest-app.md rules 1, 9bis (c) — « Lien Mon séjour » on the fiche: the link, its QR, copy, regenerate after
// a confirmation; the server's reason when the link is refused (409), nothing for a new or unknown stay.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
import guestAppApi from '../guestAppApi';
import StayLinkCard from '../StayLinkCard';

vi.mock('../guestAppApi', () => ({ default: { getStayLink: vi.fn(), regenerateStayLink: vi.fn() } }));

const LINK = { url: 'https://sejour.example.test/s/AAAA', qrDataUri: 'data:image/png;base64,AAAA', validUntilLabel: 'Le lien vaut jusqu’au lun. 9 nov., 12 h.' };
const renderCard = (id = 40) => render(<ThemeProvider theme={theme}><DialogProvider><StayLinkCard reservationId={id} /></DialogProvider></ThemeProvider>);

beforeEach(() => vi.clearAllMocks());

test('rule 9bis (c): the link, its QR and its validity', async () => {
  guestAppApi.getStayLink.mockResolvedValue(LINK);
  renderCard();
  expect(await screen.findByText('https://sejour.example.test/s/AAAA')).toBeInTheDocument();
  expect(screen.getByAltText('QR du lien Mon séjour')).toHaveAttribute('src', LINK.qrDataUri);
  expect(screen.getByText(LINK.validUntilLabel)).toBeInTheDocument();
});

test('rule 1: « Régénérer le lien » asks first, then shows the new link', async () => {
  guestAppApi.getStayLink.mockResolvedValue(LINK);
  guestAppApi.regenerateStayLink.mockResolvedValue({ ...LINK, url: 'https://sejour.example.test/s/BBBB' });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Régénérer le lien' }));
  expect(guestAppApi.regenerateStayLink).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('button', { name: 'Régénérer' }));
  expect(await screen.findByText('https://sejour.example.test/s/BBBB')).toBeInTheDocument();
});

test('rule 9bis (c): a refused link keeps the card and states the server reason', async () => {
  const reason = 'Ce logement n’est pas dans l’application clients.';
  guestAppApi.getStayLink.mockRejectedValue(Object.assign(new Error(reason), { status: 409 }));
  renderCard();
  expect(await screen.findByText('Lien Mon séjour')).toBeInTheDocument();
  expect(screen.getByText(reason)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copier le lien' })).not.toBeInTheDocument();
});

test('a devis (409 NOT_A_STAY) → no card', async () => {
  guestAppApi.getStayLink.mockRejectedValue(Object.assign(new Error('x'), { status: 409, code: 'NOT_A_STAY' }));
  const { container } = renderCard();
  await waitFor(() => expect(guestAppApi.getStayLink).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('an unknown stay (404) or a network failure → no card', async () => {
  guestAppApi.getStayLink.mockRejectedValue(Object.assign(new Error('x'), { status: 404 }));
  const { container } = renderCard();
  await waitFor(() => expect(guestAppApi.getStayLink).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('a new fiche (no id yet) asks nothing', () => {
  const { container } = renderCard(null);
  expect(guestAppApi.getStayLink).not.toHaveBeenCalled();
  expect(container).toBeEmptyDOMElement();
});
