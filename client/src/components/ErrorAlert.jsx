/**
 * ErrorAlert — the one way to surface a load/action failure (specs/ds-components.md §3.1).
 * Kills the silent-fetch-error pattern: pages render this instead of swallowing the catch.
 *
 * Props:
 *   message?:  string       French error text (default « Impossible de charger les données. »)
 *   onRetry?:  () => void   optional action button
 *   retryLabel?: string     the action's label (default « Réessayer »)
 *   sx?:       object       forwarded to the Alert
 */
import React from 'react';
import { Alert, Button } from '@mui/material';

export default function ErrorAlert({ message = 'Impossible de charger les données.', onRetry, retryLabel = 'Réessayer', sx }) {
  return (
    <Alert
      severity="error"
      sx={sx}
      action={onRetry ? (
        <Button color="inherit" size="small" onClick={onRetry}>{retryLabel}</Button>
      ) : undefined}
    >
      {message}
    </Alert>
  );
}
