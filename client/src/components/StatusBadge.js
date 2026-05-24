/**
 * StatusBadge — colored chip + label for status/feature-health displays.
 *
 * Props:
 *   status:  'success' | 'warning' | 'error' | 'neutral'   (required)
 *   label:   string                                         (required)
 *   icon?:   ReactNode                                      (optional leading icon)
 *
 * Color map: success → success, warning → warning, error → error, neutral → default.
 */
import React from 'react';
import { Chip } from '@mui/material';

const COLOR_MAP = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  neutral: 'default',
};

export default function StatusBadge({ status, label, icon }) {
  const color = COLOR_MAP[status] || 'default';
  return (
    <Chip
      size="small"
      color={color}
      label={label}
      icon={icon || undefined}
      sx={{ fontWeight: 600 }}
    />
  );
}
