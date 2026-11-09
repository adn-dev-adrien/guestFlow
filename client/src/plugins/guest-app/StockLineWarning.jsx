/**
 * StockLineWarning — « Stock : épuisé » under an option or resource line of the fiche (specs/guest-app.md rule
 * 37quater). A warning only: the staff and the website are never refused, the stock may go below 0 (rule 37ter).
 * Contributed to `reservation.optionLine` (prop `option`) and `reservation.resourceLine` (prop `resource`); renders
 * nothing for an article whose stock is not followed or not exhausted.
 *
 * One read of `GET /api/guest-app/stock` serves every line of the fiche: the answer is kept 30 s.
 */
import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import guestAppApi from './guestAppApi';

const KEEP_MS = 30 * 1000;
let cached = null;

function readStock() {
  if (cached && Date.now() - cached.at < KEEP_MS) return cached.promise;
  const promise = Promise.resolve().then(() => guestAppApi.getStock())
    .then((body) => new Map(((body && body.items) || []).map((row) => [`${row.kind}:${row.id}`, row])))
    .catch(() => new Map());
  cached = { at: Date.now(), promise };
  return promise;
}

/** Forgets the shared answer (tests, and a fiche reopened after a restock). */
export function forgetStock() { cached = null; }

export default function StockLineWarning({ option, resource }) {
  const key = option ? `option:${option.id}` : `resource:${resource && resource.id}`;
  const [row, setRow] = useState(null);

  useEffect(() => {
    let live = true;
    readStock().then((rows) => { if (live) setRow(rows.get(key) || null); });
    return () => { live = false; };
  }, [key]);

  if (!row || !row.out) return null;
  return (
    <Box
      role="note"
      sx={(t) => ({
        display: 'inline-flex', alignItems: 'center', gap: 0.75, mt: 0.75, px: 1, py: 0.25, borderRadius: 1,
        bgcolor: t.palette.warning.soft, color: t.palette.warning.text,
      })}
    >
      <Inventory2OutlinedIcon sx={{ fontSize: 16 }} aria-hidden />
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'inherit' }}>
        {row.label || 'Stock : épuisé'}
      </Typography>
    </Box>
  );
}
