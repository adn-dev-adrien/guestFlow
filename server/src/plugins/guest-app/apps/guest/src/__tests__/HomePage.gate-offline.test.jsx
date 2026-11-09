// specs/guest-app.md rules 13, 21 — the gate tile read without network says the connection is needed, never
// « Accès en préparation ».
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OFFLINE, baseRoutes, renderApp, stubApi } from './guestFixtures';

describe('home — the gate tile offline (rules 13, 21)', () => {
  it('reads « Connexion nécessaire » and is not a button', async () => {
    stubApi(baseRoutes({ 'GET /gate': OFFLINE }));
    renderApp('/');
    const reason = await screen.findByText('Connexion nécessaire');
    expect(reason.closest('.tile')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('Accès en préparation')).toBeNull();
  });
});
