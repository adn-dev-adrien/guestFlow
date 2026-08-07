/**
 * PlatformChip — the one rendering for a booking-platform badge (specs/ds-components.md §3.1):
 * filled chip, platform color background, white text. Replaces both the ad-hoc filled Chips and
 * the hand-rolled outlined Boxes.
 *
 * Props:
 *   platform: string   platform name as stored (any case — resolved via getPlatformColor)
 *   size?:    'small' | 'medium'   default 'small'
 *   sx?:      object   forwarded to the Chip
 */
import React from 'react';
import { Chip } from '@mui/material';
import { getPlatformColor } from '../constants/platforms';

export default function PlatformChip({ platform, size = 'small', sx }) {
  if (!platform) return null;
  return (
    <Chip
      size={size}
      label={platform}
      sx={{ bgcolor: getPlatformColor(platform), color: '#fff', fontWeight: 600, ...sx }}
    />
  );
}
