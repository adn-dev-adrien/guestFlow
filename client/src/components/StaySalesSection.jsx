/**
 * StaySalesSection — what a stay sold apart from the total being collected (specs/pricing-components.md §3 rule 32).
 *
 * Props: `section` = `{ title, lines: [{ ref, label, totalCents, statusLabel, sourceLabel, block, groupLabel }], groups, totalCents, dueCents }` as the
 * server serves it (the SAS payload's `staySales`), or null (renders nothing). Every amount is the server's cents and every label its French;
 * nothing is summed here. An article sold on several lines (`groups`, rule 13) reads under one title inside each block — what is left to collect,
 * what is already paid. Lines wrap on a phone; the section is a quiet block, the total keeps its tabular figures.
 */
import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);

export default function StaySalesSection({ section }) {
  if (!section || !Array.isArray(section.lines) || section.lines.length === 0) return null;
  const groups = section.groups || [];
  const groupOf = new Map();
  groups.forEach((group) => group.refs.forEach((ref) => groupOf.set(`${group.block}:${ref}`, group)));
  const entries = (block) => {
    const out = [];
    const placed = new Set();
    section.lines.filter((line) => line.block === block).forEach((line) => {
      const group = groupOf.get(`${block}:${line.ref}`);
      if (!group) { out.push({ line }); return; }
      if (placed.has(group.id)) return;
      placed.add(group.id);
      out.push({ group, lines: section.lines.filter((l) => l.block === block && group.refs.includes(l.ref)) });
    });
    return out;
  };
  const lineRow = (line, inGroup) => (
    <Stack component="li" key={line.ref} direction="row" sx={{ justifyContent: 'space-between', gap: 1, py: 0.5, pl: inGroup ? 1.5 : 0 }}>
      <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {inGroup ? line.groupLabel : line.label}
        <Typography component="span" variant="caption" color="text.secondary">{` · ${line.statusLabel}`}</Typography>
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{euros(line.totalCents)}</Typography>
    </Stack>
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
  const heads = groups.length > 0 && section.lines.some((l) => l.block === 'paid') && section.lines.some((l) => l.block === 'due');
  return (
    <Box component="section" aria-label={section.title} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: { xs: 1.25, sm: 1.5 } }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{section.title}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{euros(section.dueCents)}</Typography>
      </Stack>
      {groups.length === 0 ? (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0 }}>{section.lines.map((line) => lineRow(line, false))}</Box>
      ) : ['due', 'paid'].map((block) => (entries(block).length > 0 && (
        <Box key={block}>
          {heads && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{block === 'due' ? 'À percevoir' : 'Déjà payé'}</Typography>}
          <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0 }}>{blockList(block)}</Box>
        </Box>
      )))}
    </Box>
  );
}
