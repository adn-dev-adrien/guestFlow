/**
 * ExtrasFold — « Ajouter au bon » on « Nouveau bon » (specs/gift-voucher-campaigns.md rule 63): the extra time and the add-ons of a campaign in one fold, closed by default, each
 * line with the price GuestFlow gives for its quantity. Every amount is looked up in the offer's `prices` arrays; nothing is multiplied or added here.
 *
 * Props:
 *  - `campaign`       the offer's campaign: `{ extraTime: { maxMinutes, stepMinutes, prices }, addOns: [{ articleRef, label, maxQty, unitLabel, linear, prices }] }`.
 *  - `extraMinutes`   the extra time chosen (minutes).
 *  - `quantities`     `{ [articleRef]: qty }` the add-ons chosen.
 *  - `onExtraMinutes(minutes)`, `onQuantity(articleRef, qty)` — committed values.
 *  - `extrasCents`    the price answer's `extrasCents` (number), `null` while it is being asked, `undefined` when there is none to show.
 *  - `extraTimeError` the server's sentence for the extra time, shown on its line; `addOnsError` the one for the add-ons, shown under the lines.
 */
import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { CollapsibleSection, QuantityField } from '../sdk';
import { formatCents, formatMinutes } from './giftVoucherFormat';
import { NEW_VOUCHER_TEXTS as T } from './giftVoucherTexts';

const priceAt = (prices, key, value) => {
  const found = prices.find((p) => p[key] === value);
  return found && found.cents !== null && found.cents !== undefined ? found.cents : null;
};

export default function ExtrasFold({
  campaign, extraMinutes, quantities, onExtraMinutes, onQuantity, extrasCents, extraTimeError, addOnsError,
}) {
  const extra = campaign.extraTime && campaign.extraTime.prices && campaign.extraTime.prices.length ? campaign.extraTime : null;
  const addOns = (campaign.addOns || []).filter((a) => a.prices && a.prices.length);
  const available = addOns.length + (extra ? 1 : 0);
  if (!available) return null;

  const firsts = [...addOns.map((a) => a.prices[0].cents), ...(extra ? [extra.prices[0].cents] : [])].filter((cents) => cents !== null && cents !== undefined);
  const extraMax = extra ? Math.min(extra.maxMinutes, extra.prices[extra.prices.length - 1].minutes) : 0;

  const lines = [];
  if (extra) {
    const chosen = extraMinutes > 0;
    let sub = T.extras.extraTimeStep(formatCents(extra.prices[0].cents), formatMinutes(extra.stepMinutes));
    if (chosen) {
      const cents = priceAt(extra.prices, 'minutes', extraMinutes);
      sub = cents === null ? T.extras.extraTimeOnly(formatMinutes(extraMinutes)) : T.extras.extraTimeTotal(formatMinutes(extraMinutes), formatCents(cents));
      if (extraMinutes >= extraMax) sub = `${sub} · ${T.extras.max(formatMinutes(extraMax))}`;
    }
    lines.push({
      key: 'extraTime', label: T.extraTime, fieldLabel: T.extras.minutes, sub, chosen, name: `+${formatMinutes(extraMinutes)}`, error: extraTimeError,
      field: {
        value: extraMinutes, step: extra.stepMinutes, max: extraMax, onCommit: onExtraMinutes,
      },
    });
  }
  addOns.forEach((a) => {
    const qty = quantities[a.articleRef] || 0;
    const maxQty = Math.min(a.maxQty, a.prices[a.prices.length - 1].qty);
    let sub = T.extras.each(formatCents(a.prices[0].cents), a.unitLabel);
    const lineCents = qty > 0 ? priceAt(a.prices, 'qty', qty) : null;
    if (lineCents !== null) {
      const total = formatCents(lineCents);
      sub = a.linear === false ? T.extras.progressiveTotal(qty, total) : T.extras.lineTotal(qty, formatCents(a.prices[0].cents), total);
      if (qty >= maxQty) sub = `${sub} · ${T.extras.max(qty)}`;
    }
    lines.push({
      key: a.articleRef, label: a.label, sub, chosen: qty > 0, name: `${a.label}${qty > 1 ? ` ×${qty}` : ''}`,
      field: {
        value: qty, step: 1, max: maxQty, onCommit: (v) => onQuantity(a.articleRef, v),
      },
    });
  });

  const chosen = lines.filter((l) => l.chosen);
  let gain = null;
  if (chosen.length && (extrasCents === null || typeof extrasCents === 'number')) gain = extrasCents === null ? T.extras.pending : `+ ${formatCents(extrasCents)}`;
  const problem = extraTimeError || addOnsError;
  const subtitle = problem ? (
    <Typography variant="body2" color="error" role="alert" noWrap>{problem}</Typography>
  ) : (
    <Stack direction="row" spacing={0.5} sx={{ minWidth: 0, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
      <Typography variant="body2" noWrap sx={{ minWidth: 0, color: 'inherit' }}>
        {chosen.length ? chosen.map((l) => l.name).join(', ') : T.extras.available(available, formatCents(Math.min(...firsts)))}
      </Typography>
      {gain ? <Typography variant="body2" sx={{ flexShrink: 0, fontWeight: 600, color: 'primary.main' }}>{gain}</Typography> : null}
    </Stack>
  );

  return (
    <CollapsibleSection title={T.extras.title} ariaLabel={T.extras.ariaLabel(chosen.length)} subtitle={subtitle} count={chosen.length} disableDivider>
      <Stack spacing={0}>
        {lines.map((line) => (
          <Stack
            key={line.key}
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: 'center', justifyContent: 'space-between', py: 1, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{line.label}</Typography>
              <Typography variant="caption" color={line.error ? 'error' : (line.chosen ? 'primary.main' : 'text.secondary')} sx={{ display: 'block', fontVariantNumeric: 'tabular-nums' }} role={line.error ? 'alert' : undefined}>
                {line.error || line.sub}
              </Typography>
            </Box>
            <QuantityField
              label={line.fieldLabel || T.quantity} slotProps={{ htmlInput: { 'aria-label': line.label } }} value={line.field.value} step={line.field.step} min={0} max={line.field.max} size="small"
              onCommit={line.field.onCommit} sx={{ width: 170, flexShrink: 0 }}
            />
          </Stack>
        ))}
        {addOnsError ? <Typography variant="body2" color="error" role="alert">{addOnsError}</Typography> : null}
        <Typography variant="caption" color="text.secondary" sx={{ pt: 0.5 }}>{T.extras.foot}</Typography>
      </Stack>
    </CollapsibleSection>
  );
}
