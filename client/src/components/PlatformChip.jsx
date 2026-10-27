/**
 * PlatformChip — the one rendering for a booking-platform badge (specs/ds-components.md §3.1):
 * filled chip, platform color background, white text. Replaces both the ad-hoc filled Chips and
 * the hand-rolled outlined Boxes.
 *
 * The label goes through `formatPlatformLabel`: the server's display name (« Gîtes de France »,
 * specs/platform-settings-relay-and-review.md rule 12), else the stored spelling with its leading
 * capital — so the badge never contradicts the calendar legend. It re-renders when the names arrive.
 *
 * Props:
 *   platform: string   platform name as stored (any case — resolved via getPlatformColor)
 *   size?:    'small' | 'medium'   default 'small'
 *   sx?:      object   forwarded to the Chip
 */
import React, { useSyncExternalStore } from 'react';
import { Chip } from '@mui/material';
import {
  getPlatformColor, formatPlatformLabel, subscribePlatformDisplayNames, platformDisplayNamesVersion,
} from '../constants/platforms';

export default function PlatformChip({ platform, size = 'small', sx }) {
  useSyncExternalStore(subscribePlatformDisplayNames, platformDisplayNamesVersion);
  if (!platform) return null;
  return (
    <Chip
      size={size}
      label={formatPlatformLabel(platform)}
      sx={{ bgcolor: getPlatformColor(platform), color: '#fff', fontWeight: 600, ...sx }}
    />
  );
}
