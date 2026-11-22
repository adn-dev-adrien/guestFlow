/**
 * PriceRecap — the server's priced lines of a composition or an order (specs/gift-voucher-campaigns.md rules 5, 41): label, quantity, line total, then « dont TVA » per rate.
 * It renders the answer of `POST /campaigns/preview-price` or `POST /offer/price` as it is: nothing is added up or derived here.
 *
 * Props: price ({ lines, totalCents, vatLines?, vat? }), texts ({ total, vatIncluded(rate) })
 */
import React from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { formatCents } from './giftVoucherFormat';

const rateText = (rate) => String(rate).replace('.', ',');

export default function PriceRecap({ price, texts }) {
  const vat = price.vatLines
    ? price.vatLines.map((row) => ({ rate: row.ratePercent, cents: row.vatCents }))
    : (price.vat || []);
  return (
    <Stack spacing={0.75} data-testid="price-recap">
      {price.lines.map((line, index) => (
        <Box key={index} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{line.qty > 1 ? `${line.qty} × ${line.label}` : line.label}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{formatCents(line.totalCents)}</Typography>
        </Box>
      ))}
      <Divider />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <Typography variant="body1" fontWeight={600}>{texts.total}</Typography>
        <Typography variant="body1" fontWeight={600}>{formatCents(price.totalCents)}</Typography>
      </Box>
      {vat.map((row) => (
        <Box key={row.rate} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="caption" color="text.secondary">{texts.vatIncluded(rateText(row.rate))}</Typography>
          <Typography variant="caption" color="text.secondary">{formatCents(row.cents)}</Typography>
        </Box>
      ))}
    </Stack>
  );
}
