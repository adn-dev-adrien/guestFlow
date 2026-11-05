/**
 * DataChecksPanel — a counted list of data checks, each row opening the records it concerns
 * (specs/finance-data-checks.md rules 12-17). Generic: any « faire le point » view holding checks of the
 * shape `{ key, severity: 'fix'|'check'|'info', label, hint?, count, moreCount, items: [{ label, detail? }] }`.
 * Counts, order, labels and the rest-count arrive from the server; the panel only renders them.
 *
 * Props:
 *   checks:     Array<check>                  in display order; a check with count 0 is not drawn
 *   itemHref:   (item, check) => string|null  the in-app path an item links to (null → plain text)
 *   label?:     string                        panel title, default « À vérifier »
 *   caption?:   string                        one muted line under the title (the scope read)
 *   emptyText?: string                        the single line shown when no check holds anything
 *   sx?:        object
 */
import React, { useId, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Box, ButtonBase, Collapse, Link, Typography, useMediaQuery } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Panel from './Panel';
import DefinitionButton from './DefinitionButton';
import { softChipSx } from './StatusBadge';

// Rule 13 — the severity's words and tone, never its key.
export const SEVERITY = {
  fix: { label: 'à corriger', status: 'error' },
  check: { label: 'à vérifier', status: 'warning' },
  info: { label: 'information', status: 'neutral' },
};

const moreLabel = (n) => `+ ${n} ${n > 1 ? 'autres' : 'autre'}`;

function SeverityChip({ severity }) {
  const s = SEVERITY[severity] || SEVERITY.info;
  return (
    <Box
      component="span"
      sx={[softChipSx(s.status), { fontSize: '0.72rem', fontWeight: 700, px: 1, py: 0.25, borderRadius: 999, whiteSpace: 'nowrap', lineHeight: 1.5 }]}
    >
      {s.label}
    </Box>
  );
}

function CheckRow({ check, itemHref, reduceMotion }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <Box component="li" sx={{ listStyle: 'none', border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pr: 1 }}>
        <ButtonBase
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          sx={{
            flex: 1, minWidth: 0, minHeight: 48, px: 1.75, py: 1, gap: 1.5, justifyContent: 'flex-start', textAlign: 'left',
            borderRadius: 1, flexWrap: { xs: 'wrap', sm: 'nowrap' },
            '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
          }}
        >
          <Typography component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: '2ch', textAlign: 'right' }}>
            {check.count}
          </Typography>
          <Typography component="span" variant="body2" sx={{ flex: '1 1 12rem', minWidth: 0, overflowWrap: 'anywhere' }}>
            {check.label}
          </Typography>
          <SeverityChip severity={check.severity} />
          <ExpandMoreIcon
            aria-hidden
            fontSize="small"
            sx={{ color: 'text.secondary', transform: open ? 'rotate(180deg)' : 'none', transition: reduceMotion ? 'none' : 'transform .2s' }}
          />
        </ButtonBase>
        {check.hint && <DefinitionButton label={check.label} definition={check.hint} />}
      </Box>
      <Collapse in={open} timeout={reduceMotion ? 0 : 'auto'} unmountOnExit>
        <Box component="ul" id={listId} sx={{ m: 0, pl: { xs: 1.75, sm: 6 }, pr: 1.75, pb: 1.5, pt: 0 }}>
          {check.items.map((item, i) => {
            const href = itemHref ? itemHref(item, check) : null;
            const detail = item.detail && (
              <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>{item.detail}</Typography>
            );
            return (
              <Box component="li" key={item.reservationId ?? item.clientId ?? item.month ?? i} sx={{ listStyle: 'none', py: 0.5, fontSize: '0.88rem', overflowWrap: 'anywhere' }}>
                {href ? <Link component={RouterLink} to={href} underline="hover" sx={{ '@media (pointer: coarse)': { display: 'inline-block', py: 0.75 } }}>{item.label}</Link> : item.label}
                {detail}
              </Box>
            );
          })}
          {check.moreCount > 0 && (
            <Typography component="li" variant="body2" color="text.secondary" sx={{ listStyle: 'none', py: 0.5 }}>
              {moreLabel(check.moreCount)}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

export default function DataChecksPanel({ checks, itemHref, label = 'À vérifier', caption, emptyText = 'Rien à vérifier.', sx }) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const shown = (checks || []).filter((c) => c.count > 0);
  return (
    <Panel label={label} sx={sx}>
      {caption && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.75, mb: 1.25 }}>{caption}</Typography>}
      {shown.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{emptyText}</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, '& > li + li': { mt: 1 } }}>
          {shown.map((check) => <CheckRow key={check.key} check={check} itemHref={itemHref} reduceMotion={reduceMotion} />)}
        </Box>
      )}
    </Panel>
  );
}
