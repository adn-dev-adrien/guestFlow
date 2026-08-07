/**
 * EmptyState — the one way to render an empty list/view (specs/ds-components.md §3.1).
 * Also backs the app-level 404 and the ErrorBoundary fallback.
 *
 * Props:
 *   icon?:        ReactNode   large leading icon (rendered muted)
 *   title?:       string      short French headline (optional)
 *   message:      string      French explanation (required)
 *   actionLabel?: string      optional call-to-action button label
 *   onAction?:    () => void  CTA handler (rendered only with actionLabel)
 *   py?:          number      vertical padding (spacing units, default 6)
 */
import React from 'react';
import { Box, Button, Typography } from '@mui/material';

export default function EmptyState({ icon, title, message, actionLabel, onAction, py = 6 }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1, py, px: 2 }}>
      {icon && (
        <Box sx={{ color: 'text.secondary', '& > svg': { fontSize: 44 }, opacity: 0.7 }}>{icon}</Box>
      )}
      {title && <Typography variant="sectionHeader">{title}</Typography>}
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>{message}</Typography>
      {actionLabel && onAction && (
        <Button variant="contained" onClick={onAction} sx={{ mt: 1 }}>{actionLabel}</Button>
      )}
    </Box>
  );
}
