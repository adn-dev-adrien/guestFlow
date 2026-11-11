/**
 * PluginLoadBanner — says that the plugins could not be loaded (specs/plugins-phase-4-registry.md
 * rule 18, review minor 8): when the list of plugin bundles could not be read, the app renders without
 * them; this banner keeps that from looking like a complete app, and offers a reload.
 * Plugin-specific; reads the runtime’s LOAD_STATE, set once before the app renders.
 * Props: onReload? () => void — default window.location.reload (tests pass their own).
 */
import React from 'react';
import { Alert, Button } from '@mui/material';
import { LOAD_STATE } from '../plugins/runtimeModules';

export default function PluginLoadBanner({ onReload = () => window.location.reload() }) {
  if (!LOAD_STATE.entriesError) return null;
  return (
    <Alert
      severity="error"
      sx={{ mb: 2, alignItems: 'center' }}
      action={<Button color="inherit" onClick={onReload} sx={{ minHeight: 44 }}>Recharger</Button>}
    >
      Modules indisponibles.
    </Alert>
  );
}
