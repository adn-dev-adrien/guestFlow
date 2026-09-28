// specs/plugins-phase-0-foundation.md rule 16 — PluginGate mounts its children only while the plugin is active.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import { useAuth } from '../../hooks/useAuth';
import PluginGate from '../PluginGate';

const setPlugins = (enabledPlugins) => useAuth.mockReturnValue({ user: { roles: ['admin'], enabledPlugins } });

describe('PluginGate', () => {
  test('renders its children while the plugin is active', () => {
    setPlugins(['linen']);
    render(<PluginGate id="linen"><p>Linge</p></PluginGate>);
    expect(screen.getByText('Linge')).toBeInTheDocument();
  });

  test('renders nothing — and never mounts the children — while it is not', () => {
    setPlugins(['sas']);
    const mounted = vi.fn();
    function Child() { mounted(); return <p>Linge</p>; }
    const { container } = render(<PluginGate id="linen"><Child /></PluginGate>);
    expect(container).toBeEmptyDOMElement();
    expect(mounted).not.toHaveBeenCalled();
  });

  test('renders the fallback instead when one is given', () => {
    setPlugins([]);
    render(<PluginGate id="linen" fallback={<p>Sans linge</p>}><p>Linge</p></PluginGate>);
    expect(screen.getByText('Sans linge')).toBeInTheDocument();
  });
});
