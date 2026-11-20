/**
 * StaySalesSection — what a stay sold apart from the total being collected (specs/pricing-components.md §3 rules 32, 85; mock M3).
 *
 * Props:
 *   `section` = `{ title, lines: [{ ref, label, totalCents, status, statusLabel, sourceLabel, block, groupLabel, addedOnReopen, offerable }], groups, totalCents,
 *     dueCents }` as the server serves it (the SAS payload's `staySales`), or null (renders nothing). A line `status: 'credit'` is the rule-104
 *     « Déjà réglé (…) » money (negative, `offerable: false`, no `statusLabel`): read-only, never offered. Every amount is the server's cents and every label its
 *     French; nothing is summed here.
 *   `onCollectNow(refs)` (optional) — makes the section actionable: each line still to collect shows « Percevoir maintenant » and, from two lines on,
 *     « Tout percevoir maintenant » heads the list; the handler gets the refs asked and returns a promise (the buttons wait for it). The
 *     lines already paid fold under « Déjà payé » and offer nothing. Without the handler the section stays a read-only list.
 *   `onOffer(ref, force)` (optional) — each line already paid offers « Offrir »; the handler returns a promise that rejects with the server's refusal.
 *     A refusal coded `OVERPAID` opens the confirmation « Ligne déjà payée : l’offrir rend X au client » (X is the server's `overpaymentTtc`) and
 *     « Offrir · X à rembourser » asks again with `force` true; any other refusal shows its message under the line. `section.refundOwedCents`
 *     (what the stay owes back for offered paid lines) shows as « À rembourser (depuis la fiche) ».
 * An article sold on several lines (`groups`, rule 13) reads under one title inside each block. A line a reopened SAS appended carries the chip
 * « Ajoutée à la réouverture ». Lines wrap on a phone and the buttons keep a 44 px target; the total keeps its tabular figures.
 */
import React, { useId, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';
import FocusKeeper from './FocusKeeper';

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);
const TEXTS = Object.freeze({
  reopenChip: 'Ajoutée à la réouverture',
  collect: 'Percevoir maintenant',
  collectAll: 'Tout percevoir maintenant',
  offer: 'Offrir',
  offerRefused: 'Cette ligne ne peut pas être offerte.',
  confirmLabel: 'Confirmer l’offre',
  confirmText: (amount) => `Ligne déjà payée : l’offrir rend ${amount} au client.`,
  confirmOffer: (amount) => `Offrir · ${amount} à rembourser`,
  keep: 'Garder',
  toCollect: 'À percevoir',
  refundOwed: (amount) => `À rembourser (depuis la fiche) : ${amount}`,
  paidFold: (count) => `Déjà payé · ${count} ligne${count > 1 ? 's' : ''}`,
});

export default function StaySalesSection({ section, onCollectNow = null, onOffer = null }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const uid = useId();
  if (!section || !Array.isArray(section.lines)) return null;
  const refundOwed = Number(section.refundOwedCents) || 0;
  if (section.lines.length === 0 && refundOwed <= 0) return null;
  const groups = section.groups || [];
  const groupOf = new Map();
  groups.forEach((group) => group.refs.forEach((ref) => groupOf.set(`${group.block}:${ref}`, group)));
  const blockOf = (line) => (line.block === 'paid' ? 'paid' : 'due');
  const inBlock = (block) => section.lines.filter((line) => blockOf(line) === block);
  const entries = (block) => {
    const out = [];
    const placed = new Set();
    inBlock(block).forEach((line) => {
      const group = groupOf.get(`${block}:${line.ref}`);
      if (!group) { out.push({ line }); return; }
      if (placed.has(group.id)) return;
      placed.add(group.id);
      out.push({ group, lines: inBlock(block).filter((l) => group.refs.includes(l.ref)) });
    });
    return out;
  };
  const collect = async (refs) => {
    setBusy(true);
    try { await onCollectNow(refs); } finally { setBusy(false); }
  };
  const offer = async (ref, force) => {
    setBusy(true);
    setRefusal(null);
    try {
      await onOffer(ref, force);
      setConfirm(null);
    } catch (err) {
      if (err && err.code === 'OVERPAID') setConfirm({ ref, amount: formatCurrency(Number(err.overpaymentTtc) || 0) });
      else setRefusal({ ref, text: (err && err.message) || TEXTS.offerRefused });
    } finally {
      setBusy(false);
    }
  };
  const dueRefs = inBlock('due').map((line) => line.ref);
  const lineRow = (line, inGroup) => (
    <Box component="li" key={line.ref} sx={{ listStyle: 'none' }}>
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: { xs: 0.5, sm: 1 }, py: 0.5, pl: inGroup ? 1.5 : 0 }}
    >
      <Typography id={`${uid}-${line.ref}`} variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {inGroup ? line.groupLabel : line.label}
        {line.statusLabel && <Typography component="span" variant="caption" color="text.secondary">{` · ${line.statusLabel}`}</Typography>}
        {line.addedOnReopen && (
          <Typography component="span" variant="caption" sx={{ ml: 0.75, px: 0.75, py: 0.125, borderRadius: 1, bgcolor: 'action.hover', color: 'text.primary', whiteSpace: 'nowrap' }}>
            {TEXTS.reopenChip}
          </Typography>
        )}
      </Typography>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: { xs: 'space-between', sm: 'flex-end' }, gap: 1, flexShrink: 0 }}>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{euros(line.totalCents)}</Typography>
        {onCollectNow && blockOf(line) === 'due' && (
          <Button size="small" variant="outlined" disabled={busy} aria-describedby={`${uid}-${line.ref}`} onClick={() => collect([line.ref])} sx={{ minHeight: 44, whiteSpace: 'nowrap' }}>
            {TEXTS.collect}
          </Button>
        )}
        {onOffer && blockOf(line) === 'paid' && !line.offered && line.offerable !== false && (
          <Button size="small" variant="outlined" disabled={busy} aria-describedby={`${uid}-${line.ref}`} onClick={() => offer(line.ref, false)} sx={{ minHeight: 44, whiteSpace: 'nowrap' }}>
            {TEXTS.offer}
          </Button>
        )}
      </Stack>
    </Stack>
    {confirm && confirm.ref === line.ref && (
      <Box role="alertdialog" aria-label={TEXTS.confirmLabel} sx={{ mt: 0.5, p: 1.25, borderRadius: 1, bgcolor: 'action.hover' }}>
        <Typography variant="body2">{TEXTS.confirmText(confirm.amount)}</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, mt: 1 }}>
          <Button size="small" variant="contained" color="error" disabled={busy} onClick={() => offer(line.ref, true)} sx={{ minHeight: 44 }}>
            {TEXTS.confirmOffer(confirm.amount)}
          </Button>
          <Button autoFocus size="small" variant="outlined" disabled={busy} onClick={() => setConfirm(null)} sx={{ minHeight: 44 }}>{TEXTS.keep}</Button>
        </Stack>
      </Box>
    )}
    {refusal && refusal.ref === line.ref && <Typography role="alert" variant="body2" color="error" sx={{ mt: 0.5 }}>{refusal.text}</Typography>}
    </Box>
  );
  const blockList = (block) => entries(block).map((entry) => (entry.group ? (
    <Box component="li" key={entry.group.id} sx={{ listStyle: 'none', pt: 0.5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{entry.group.title}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{euros(entry.group.totalCents)}</Typography>
      </Stack>
      <Box component="ul" aria-label={entry.group.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>{entry.lines.map((line) => lineRow(line, true))}</Box>
    </Box>
  ) : lineRow(entry.line, false)));
  const paidLines = inBlock('paid');
  const dueLines = inBlock('due');
  const heads = groups.length > 0 && paidLines.length > 0 && dueLines.length > 0;
  return (
    // Loop t22 UI22-1 — a collected line folds under « Déjà payé » and its button goes: the focus stays on the section, never on the page.
    <FocusKeeper component="section" aria-label={section.title} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: { xs: 1.25, sm: 1.5 } }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{section.title}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{section.lines.length > 0 ? euros(dueLines.length > 0 ? section.dueCents : section.totalCents) : ''}</Typography>
      </Stack>
      {refundOwed > 0 && (
        <Typography variant="body2" color="error" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
          {TEXTS.refundOwed(euros(refundOwed))}
        </Typography>
      )}
      {onCollectNow && dueRefs.length > 1 && (
        <Button size="small" variant="contained" disabled={busy} onClick={() => collect(dueRefs)} sx={{ mt: 1, minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>
          {TEXTS.collectAll}
        </Button>
      )}
      {dueLines.length > 0 && (
        <Box>
          {heads && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{TEXTS.toCollect}</Typography>}
          <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0 }}>{blockList('due')}</Box>
        </Box>
      )}
      {paidLines.length > 0 && (dueLines.length > 0 || onCollectNow) ? (
        <Box component="details" sx={{ mt: 1, '& > summary': { cursor: 'pointer', minHeight: 44, lineHeight: '44px' } }}>
          <Typography component="summary" variant="caption" color="text.secondary">
            {TEXTS.paidFold(paidLines.length)}
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>{blockList('paid')}</Box>
        </Box>
      ) : paidLines.length > 0 && (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0 }}>{blockList('paid')}</Box>
      )}
    </FocusKeeper>
  );
}
