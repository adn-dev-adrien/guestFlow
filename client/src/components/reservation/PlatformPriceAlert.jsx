/**
 * PlatformPriceAlert — the one alert of the pricing summary: a platform stay sold far from the
 * « Prix plateformes » grid of its channel (specs/reservation-payment-ledger.md rules 58-63).
 *
 * Renders what the server decided and shaped (`platformPriceCheck`); it compares nothing. Renders
 * nothing for `null`. Specific to the reservation fiche: its only content is this check.
 *
 * Props:
 *   check   { platformLabel, paid, expected, gapPercent, gridPath } | null
 */
import React from 'react';
import { Alert, AlertTitle, Box, Link as MuiLink } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { formatCurrency, formatSignedPercent } from '../../utils/formatters';
import { formatPlatformLabel } from '../../constants/platforms';
import { PLATFORM_PRICE_ALERT } from '../../constants/pricingSummaryStrings';

const nowrap = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

export default function PlatformPriceAlert({ check }) {
  if (!check) return null;
  return (
    <Alert
      severity="warning"
      icon={false}
      data-testid="platform-price-alert"
      sx={{ mb: 2, borderRadius: '10px', px: 1.5, py: 1.5, alignItems: 'flex-start' }}
    >
      <AlertTitle sx={{ fontWeight: 600, mb: 0.5 }}>{PLATFORM_PRICE_ALERT.title(formatPlatformLabel(check.platformLabel))}</AlertTitle>
      <Box sx={{ typography: 'body2' }}>
        <Box component="span" sx={nowrap}>{formatCurrency(check.paid)}</Box>
        {` ${PLATFORM_PRICE_ALERT.paid} · `}
        <Box component="span" sx={nowrap}>{formatCurrency(check.expected)}</Box>
        {` ${PLATFORM_PRICE_ALERT.expected} (`}
        <Box component="span" sx={nowrap}>{formatSignedPercent(check.gapPercent)}</Box>
        )
      </Box>
      <MuiLink
        component={RouterLink}
        to={check.gridPath}
        variant="body2"
        underline="hover"
        sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontWeight: 600 }}
      >
        {PLATFORM_PRICE_ALERT.link}
      </MuiLink>
    </Alert>
  );
}
