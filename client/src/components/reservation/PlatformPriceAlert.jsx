/**
 * PlatformPriceAlert — the one alert of the pricing summary: a platform stay sold far from the
 * « Prix plateformes » grid of its channel (specs/reservation-payment-ledger.md rules 58-63).
 *
 * « Voir la grille » goes through the page's unsaved-changes guard (`window.__guestflowBeforeNavigate`) like a
 * sidebar link, lands on the « Prix plateformes » card and brings the operator back to the fiche.
 *
 * Renders what the server decided and shaped (`platformPriceCheck`); it compares nothing. Renders
 * nothing for `null`. Specific to the reservation fiche: its only content is this check.
 *
 * Props:
 *   check   { platformLabel, paid, expected, gapPercent, gridPath } | null
 */
import React from 'react';
import { Alert, AlertTitle, Box, Link as MuiLink } from '@mui/material';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { formatCurrency, formatSignedPercent } from '../../utils/formatters';
import { formatPlatformLabel } from '../../constants/platforms';
import { PLATFORM_PRICE_ALERT } from '../../constants/pricingSummaryStrings';
import { withFrom } from '../../utils/navigation';

const nowrap = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

export default function PlatformPriceAlert({ check }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (!check) return null;
  const target = `${withFrom(check.gridPath, `${location.pathname}${location.search}`)}#prix-plateformes`;
  const openGrid = (event) => {
    event.preventDefault();
    const beforeNavigate = window.__guestflowBeforeNavigate;
    if (typeof beforeNavigate === 'function' && beforeNavigate(target)) return;
    navigate(target);
  };
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
        to={target}
        onClick={openGrid}
        variant="body2"
        underline="hover"
        sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontWeight: 600 }}
      >
        {PLATFORM_PRICE_ALERT.link}
      </MuiLink>
    </Alert>
  );
}
