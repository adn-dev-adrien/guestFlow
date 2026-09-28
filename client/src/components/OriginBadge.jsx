/**
 * OriginBadge — where a booking came from, as the server labels it (specs/site-traffic-analytics.md
 * rule 19): « Réseaux sociaux · Instagram », « Campagne · lancement-2026 », « Origine inconnue »…
 * Renders nothing without a label. On a phone the label is cut with an ellipsis; the tooltip keeps
 * the full text and the raw detail (landing page, UTM parameters, referrer).
 *
 * Props:
 *   label:   string | null   ready-to-render origin (`originLabel` of the payload)
 *   detail?: string | null   tooltip detail (`originDetail` of the payload)
 */
import React from 'react';
import { Box, Tooltip } from '@mui/material';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import StatusBadge from './StatusBadge';

export default function OriginBadge({ label, detail }) {
  if (!label) return null;
  return (
    <Tooltip title={detail ? `${label} — ${detail}` : `Origine de la demande : ${label}`}>
      <Box
        component="span"
        sx={{ display: 'inline-flex', minWidth: 0, maxWidth: { xs: 220, sm: 'none' }, '& .MuiChip-root': { maxWidth: '100%' } }}
      >
        <StatusBadge status="neutral" label={label} icon={<PlaceOutlinedIcon sx={{ fontSize: 14 }} />} />
      </Box>
    </Tooltip>
  );
}
