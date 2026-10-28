import React, { Suspense } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useSlot } from './useSlot';

const STALE_BUNDLE = /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;

/**
 * Isolates one plugin contribution: a throwing component renders nothing and is logged, never the
 * route's error screen. A bundle that no longer exists (the plugin was updated in another tab)
 * shows a small « Recharger » prompt instead.
 */
class ContributionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error(`[plugin:${this.props.pluginId}] contribution failed:`, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!STALE_BUNDLE.test(String((error && error.message) || error))) return null;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
        <Typography variant="caption" color="text.secondary">Module mis à jour.</Typography>
        <Button size="small" onClick={() => window.location.reload()}>Recharger</Button>
      </Box>
    );
  }
}

/**
 * Slot — renders, in place, what active plugins contributed to a named slot
 * (specs/plugins-phase-1-sdk.md rules 13-14). Each contribution is a lazily loaded component: a
 * plugin's code reaches the browser only when one of its slots renders. An inactive plugin leaves
 * nothing, not even an empty box. Each contribution sits in its own error boundary
 * (specs/plugins-phase-4-registry.md rule 39): one plugin failing never takes the page down.
 *
 * Props:
 *   name      string  the slot name, e.g. 'dashboard.alerts'
 *   ...props  passed to every contributed component
 */
export default function Slot({ name, ...props }) {
  const contributions = useSlot(name);
  if (contributions.length === 0) return null;
  return (
    <>
      {contributions.map(({ key, pluginId, Component }) => (
        <ContributionBoundary key={`${pluginId}:${key}`} pluginId={pluginId}>
          <Suspense fallback={null}>
            <Component {...props} />
          </Suspense>
        </ContributionBoundary>
      ))}
    </>
  );
}
