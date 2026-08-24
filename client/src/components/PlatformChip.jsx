/**
 * PlatformChip — the one rendering for a booking-platform badge (specs/ds-components.md §3.1):
 * filled chip, platform color background, white text. Replaces both the ad-hoc filled Chips and
 * the hand-rolled outlined Boxes.
 *
 * The label goes through `formatPlatformLabel`, so a stored spelling that drifted to lowercase
 * still reads with its leading capital and the badge never contradicts the calendar legend.
 *
 * Props:
 *   platform: string   platform name as stored (any case — resolved via getPlatformColor)
 *   size?:    'small' | 'medium'   default 'small'
 *   sx?:      object   forwarded to the Chip
 */
import React from 'react';
import { Chip } from '@mui/material';
import { getPlatformColor, formatPlatformLabel } from '../constants/platforms';

export default function PlatformChip({ platform, size = 'small', sx }) {
  if (!platform) return null;
  return (
    <Chip
      size={size}
      label={formatPlatformLabel(platform)}
      sx={{ bgcolor: getPlatformColor(platform), color: '#fff', fontWeight: 600, ...sx }}
    />
  );
}
