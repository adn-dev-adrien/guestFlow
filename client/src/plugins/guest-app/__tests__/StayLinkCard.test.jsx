// specs/guest-app.md rules 1, 9bis (c) — « Lien Mon séjour » on the fiche: the link, its QR, copy, regenerate after
// a confirmation; nothing at all when the stay has no link to show.
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

test('no link for this stay (cancelled, lodging off, no guest host) → no card', async () => {
  guestAppApi.getStayLink.mockRejectedValue(Object.assign(new Error('x'), { status: 409 }));
  const { container } = renderCard();
  await waitFor(() => expect(guestAppApi.getStayLink).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('a new fiche (no id yet) asks nothing', () => {
  const { container } = renderCard(null);
  expect(guestAppApi.getStayLink).not.toHaveBeenCalled();
  expect(container).toBeEmptyDOMElement();
});
