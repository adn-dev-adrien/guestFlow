/**
 * FrontPriceField — « Position du prix » of the merchant card's front (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 21): the corner GuestFlow draws « à partir de » and the
 * lowest price in, or « Aucun », with a miniature of the visual showing the label where it will print (the translucent fir medallion of the PDF). The price is the server's (`priceCents`, the campaign's lowest), never computed here.
 *
 * Props: value ('bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'none'), onChange(value), visual ({ id, versionId } | null), priceCents (number | null), error?
 */
import React from 'react';
import { Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import giftVouchersApi from './giftVouchersApi';
import { CAMPAIGN_TEXTS } from './giftVoucherTexts';
import { formatCents } from './giftVoucherFormat';

const T = CAMPAIGN_TEXTS.editor;

export default function FrontPriceField({
  value, onChange, visual, priceCents, error = null,
}) {
  const whole = priceCents != null && priceCents % 100 === 0 ? `${priceCents / 100} €` : (priceCents != null ? formatCents(priceCents) : '— €');
  const corner = value === 'none' ? null : value;
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Box
        data-testid="front-price-preview"
        sx={{
          position: 'relative', width: 56, height: 80, flexShrink: 0, borderRadius: 0.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden', bgcolor: 'action.hover',
          ...(visual ? { backgroundImage: `url(${giftVouchersApi.visualImageUrl(visual)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        }}
      >
        {corner ? (
          <Box
            data-corner={corner}
            sx={{
              position: 'absolute', aspectRatio: '1 / 1', p: '3px', boxSizing: 'border-box', borderRadius: '50%', bgcolor: 'rgba(47, 93, 80, 0.6)', color: '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1, typography: 'caption', fontSize: '0.4em', whiteSpace: 'nowrap',
              ...(corner.startsWith('top') ? { top: 4 } : { bottom: 4 }),
              ...(corner.endsWith('left') ? { left: 4 } : { right: 4 }),
            }}
          >
            <Box component="span" sx={{ display: 'block', fontSize: '0.7em' }}>à partir de</Box>
            {whole}
          </Box>
        ) : null}
      </Box>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <TextField select fullWidth size="small" label={T.frontPrice} value={value} onChange={(e) => onChange(e.target.value)} error={Boolean(error)} helperText={error || undefined}>
          {T.frontPriceOptions.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>{T.frontPriceHelp}</Typography>
      </Stack>
    </Stack>
  );
}
