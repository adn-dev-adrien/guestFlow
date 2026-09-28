/**
 * OriginBadge — the source of a website request on the fiche and the devis list.
 * specs/site-traffic-analytics.md rule 19.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OriginBadge from '../OriginBadge';

test('shows the server label, and the detail in its tooltip', async () => {
  render(<OriginBadge label="Campagne · lancement-2026" detail="Arrivé sur /la-granja/ · utm_source=instagram" />);
  const chip = screen.getByText('Campagne · lancement-2026');
  await userEvent.hover(chip);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Arrivé sur /la-granja/ · utm_source=instagram');
});

test('says « origine de la demande » when there is no detail', async () => {
  render(<OriginBadge label="Origine inconnue" detail={null} />);
  await userEvent.hover(screen.getByText('Origine inconnue'));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Origine de la demande : Origine inconnue');
});

test('renders nothing without a label (not a website request)', () => {
  const { container } = render(<OriginBadge label={null} />);
  expect(container).toBeEmptyDOMElement();
});
