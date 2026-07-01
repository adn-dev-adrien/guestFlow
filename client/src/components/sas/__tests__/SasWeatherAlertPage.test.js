import React from 'react';
import { render, screen } from '@testing-library/react';

import SasWeatherAlertPage from '../SasWeatherAlertPage';

// The page is purely presentational — it renders the server-shaped alert objects
// (specs/checkin-weather-alerts.md). These fixtures mirror weatherController's payload.
const CANICULE = {
  phenomenonId: 6,
  phenomenon: 'Canicule',
  colorLevel: 3,
  color: 'Orange',
  startsAt: '2026-07-02T10:00:00Z',
  endsAt: '2026-07-04T20:00:00Z',
  timingLabel: 'du 2 juillet à 12:00 au 4 juillet à 22:00',
  message: 'Vigilance orange « Canicule » en cours pour votre secteur du 2 juillet à 12:00 au 4 juillet à 22:00.',
  instructions: [
    'Les feux sont strictement interdits (barbecue, cigarette, etc.).',
    'Merci de respecter impérativement les zones fumeurs.',
  ],
};

const ORAGES = {
  phenomenonId: 3,
  phenomenon: 'Orages',
  colorLevel: 4,
  color: 'Rouge',
  startsAt: '2026-07-03T12:00:00Z',
  endsAt: '2026-07-03T18:00:00Z',
  timingLabel: 'le 3 juillet de 14:00 à 20:00',
  message: 'Vigilance rouge « Orages » en cours pour votre secteur le 3 juillet de 14:00 à 20:00.',
  instructions: ['Épisode orageux prévu le 3 juillet de 14:00 à 20:00.'],
};

test('renders each alert: phenomenon, colour chip, timing, message and instructions', () => {
  render(<SasWeatherAlertPage alerts={[CANICULE]} />);
  expect(screen.getByText('Canicule')).toBeInTheDocument();
  expect(screen.getByText('Vigilance Orange')).toBeInTheDocument();
  expect(screen.getByText(/Les feux sont strictement interdits/)).toBeInTheDocument();
  expect(screen.getByText(/zones fumeurs/)).toBeInTheDocument();
  expect(screen.getByText(CANICULE.message)).toBeInTheDocument();
});

test('renders multiple alerts', () => {
  render(<SasWeatherAlertPage alerts={[ORAGES, CANICULE]} />);
  expect(screen.getByText('Orages')).toBeInTheDocument();
  expect(screen.getByText('Canicule')).toBeInTheDocument();
  expect(screen.getByText('Vigilance Rouge')).toBeInTheDocument();
  expect(screen.getByText(/Épisode orageux prévu/)).toBeInTheDocument();
});

test('empty list renders no alert card, only the intro line', () => {
  render(<SasWeatherAlertPage alerts={[]} />);
  expect(screen.queryByText('Canicule')).not.toBeInTheDocument();
  expect(screen.getByText(/Une alerte météo est en cours/)).toBeInTheDocument();
});
