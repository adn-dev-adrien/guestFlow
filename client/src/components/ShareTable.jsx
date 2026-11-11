/**
 * ShareTable — part-to-whole as a thin segmented bar above the table of its figures
 * (specs/report-grammar.md rule 15; never a pie). Hovering or focusing a row brings its segment
 * forward, and hovering a segment its row. Shares and the total come from the server: the bar's
 * widths ARE the server's shares.
 *
 * Props:
 *   rows:            Array<{ key, label, quantity?, amount, share: number (0–1), color?, other?, caption? }>
 *                    at most five categories plus one `other: true` row (« Autres », grey) — the server
 *                    groups the rest; `caption` = the segment's hover text (default « label : share »)
 *   total:           { quantity?, amount }      the total row, from the server
 *   formatAmount:    (n) => string
 *   formatShare?:    (share) => string          default « 38 % »
 *   labelHeader?:    string                      default « Type »
 *   quantityHeader?: string | null               default « Qté »; null hides the column
 *   amountHeader?:   string                      default « Montant »
 *   shareHeader?:    string                      default « Part »
 *   ariaLabel?:      string                      the bar's name, default « Répartition »
 *   emptyText?:      string                      when set (the server says there is nothing), this sentence
 *                                                replaces the bar and the table (rule 28)
 */
import React, { useState } from 'react';
import { Box, Table, TableBody, TableCell, TableFooter, TableHead, TableRow } from '@mui/material';
import { chart } from '../utils/chartColors';

const defaultShare = (s) => `${Math.round(s * 100)} %`;
const FADE = { transition: 'opacity .2s', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } };

// Rule 32 — never a recycled hue: the five palette hues in order, then the grey of « Autres ».
export function shareColors(rows) {
  let n = 0;
  return rows.map((r) => {
    if (r.color) return r;
    if (r.other || n >= chart.categorical.length) return { ...r, color: chart.other };
    const color = chart.categorical[n];
    n += 1;
    return { ...r, color };
  });
}

export default function ShareTable({ rows, total, formatAmount, formatShare = defaultShare, labelHeader = 'Type', quantityHeader = 'Qté', amountHeader = 'Montant', shareHeader = 'Part', ariaLabel = 'Répartition', emptyText }) {
  const [active, setActive] = useState(null);
  const colored = shareColors(rows);
  if (emptyText) return <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary', fontSize: '0.9rem' }}>{emptyText}</Box>;
  const dim = (key) => active != null && active !== key;
  const showQty = quantityHeader != null;
  return (
    <Box onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)} sx={{ minWidth: 0 }}>
      <Box role="img" aria-label={ariaLabel} sx={{ display: 'flex', gap: '2px', height: 12, borderRadius: '6px', overflow: 'hidden', mt: 0.5, mb: 1.5 }}>
        {colored.filter((r) => r.share > 0).map((r) => (
          <Box
            key={r.key}
            data-testid={`share-segment-${r.key}`}
            data-dimmed={dim(r.key) ? 'true' : 'false'}
            title={r.caption ?? `${r.label} : ${formatShare(r.share)}`}
            onPointerEnter={() => setActive(r.key)}
            sx={{ width: `${r.share * 100}%`, bgcolor: r.color, opacity: dim(r.key) ? 0.28 : 1, ...FADE }}
          />
        ))}
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ '& td, & th': { px: { xs: 0.75, sm: 2 } } }}>
          <TableHead>
            <TableRow>
              <TableCell scope="col">{labelHeader}</TableCell>
              {showQty && <TableCell scope="col" align="right">{quantityHeader}</TableCell>}
              <TableCell scope="col" align="right">{amountHeader}</TableCell>
              <TableCell scope="col" align="right">{shareHeader}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {colored.map((r) => (
              <TableRow
                key={r.key}
                tabIndex={0}
                data-testid={`share-row-${r.key}`}
                data-dimmed={dim(r.key) ? 'true' : 'false'}
                onPointerEnter={() => setActive(r.key)}
                onPointerDown={() => setActive(r.key)}
                onFocus={() => setActive(r.key)}
                sx={{ '& td, & th': { opacity: dim(r.key) ? 0.4 : 1, ...FADE }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
              >
                <TableCell component="th" scope="row" sx={{ minWidth: 104, overflowWrap: 'break-word' }}>
                  <Box component="span" aria-hidden="true" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '3px', mr: 1, verticalAlign: '-1px', bgcolor: r.color }} />
                  {r.label}
                </TableCell>
                {showQty && <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.quantity ?? '—'}</TableCell>}
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatAmount(r.amount)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatShare(r.share)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow sx={{ '& td, & th': { fontWeight: 700, color: 'text.primary', fontSize: '0.875rem' } }}>
              <TableCell component="th" scope="row">Total</TableCell>
              {showQty && <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{total.quantity ?? '—'}</TableCell>}
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatAmount(total.amount)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </Box>
    </Box>
  );
}
