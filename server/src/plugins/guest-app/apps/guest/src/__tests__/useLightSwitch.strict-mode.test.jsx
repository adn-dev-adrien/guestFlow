// specs/guest-app-home-automation.md rule 22 — the tap survives React's development double mount: the switch says
// « Allumage… » and follows the command, instead of staying silent (found in the local loop, 2026-11-15).
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { stubApi } from './guestFixtures';
import { homeRoutes } from './smartHomeFixtures';

describe('Domotique — a tap under StrictMode', () => {
  it('shows the pending state', async () => {
    stubApi(homeRoutes({
      'POST /home/lights/l1': { id: 9, state: 'pending', on: true },
      'GET /home/commands/9': { id: 9, state: 'pending', on: true },
    }));
    render(<StrictMode><MemoryRouter initialEntries={['/domotique']}><App /></MemoryRouter></StrictMode>);
    fireEvent.click(await screen.findByRole('switch', { name: 'Le chêne' }));
    expect(await screen.findByText('Allumage…')).toBeInTheDocument();
  });
});
