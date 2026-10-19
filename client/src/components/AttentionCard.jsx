/**
 * AttentionCard — one subject that asks for the operator, drawn the same way everywhere
 * (specs/shell-and-home-day-first.md rule 13). It replaces the four recipes the dashboard alerts had
 * (outlined Alert, `info.lighter` Card, `warning.soft` Card, plain Alert). Core and plugins (through
 * the SDK) render with it.
 *
 * Props:
 *   attention  { key, severity: 'urgent' | 'todo' | 'info', count, title, detail }   required — the
 *              server's words (GET /api/dashboard/attention); the card computes none of them
 *   actions?   [{ label, onClick?, href?, primary?, disabled?, startIcon?, color? }] — text buttons,
 *              at most ONE `primary` (filled); `href` opens in a new tab
 *   children?  the subject's list
 *
 * Layout: a card on its own (pinned above the day); inside `AttentionInbox` (which provides
 * `AttentionLayoutContext` = 'embedded') only the detail, the list and the actions — the inbox row
 * already shows the glyph, the title and the count.
 *
 * Also exports `SeverityGlyph` and `CountChip`, the two marks the inbox rows share with the card.
 */
import React, { createContext, useContext, useId } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import PendingActionsIcon from '@mui/icons-material/PendingActionsOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

/** The palette colour of each severity. */
export const SEVERITY_COLOR = { urgent: 'error', todo: 'warning', info: 'info' };
const SEVERITY_LABEL = { urgent: 'Urgent', todo: 'À faire', info: 'Pour info' };
const SEVERITY_ICON = { urgent: ErrorOutlineIcon, todo: PendingActionsIcon, info: InfoOutlinedIcon };

export const AttentionLayoutContext = createContext('card');

const colorOf = (severity) => SEVERITY_COLOR[severity] || 'info';

const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** The severity mark: an icon on the severity's soft background, named for screen readers. */
export function SeverityGlyph({ severity }) {
  const color = colorOf(severity);
  const Icon = SEVERITY_ICON[severity] || InfoOutlinedIcon;
  return (
    <Box
      component="span"
      sx={{
        width: 32, height: 32, borderRadius: '10px', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: `${color}.soft`, color: `${color}.main`,
      }}
    >
      <Icon sx={{ fontSize: 18 }} aria-hidden="true" />
      <Box component="span" sx={visuallyHidden}>{SEVERITY_LABEL[severity] || SEVERITY_LABEL.info}</Box>
    </Box>
  );
}

/** The count, in tabular figures, on the severity's soft background with its AA text colour. */
export function CountChip({ severity, count }) {
  const color = colorOf(severity);
  return (
    <Box
      component="span"
      data-testid="attention-count"
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        minWidth: 24, height: 22, px: 1, borderRadius: 999,
        bgcolor: `${color}.soft`, color: `${color}.text`,
        fontSize: '0.8rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
      }}
    >
      {count}
    </Box>
  );
}

function Actions({ actions, align }) {
  if (!actions || actions.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: align, mt: 1 }}>
      {actions.map((action) => (
        <Button
          key={action.label}
          size="small"
          variant={action.primary ? 'contained' : 'text'}
          color={action.color || 'primary'}
          startIcon={action.startIcon}
          onClick={action.onClick}
          disabled={action.disabled}
          {...(action.href ? { component: 'a', href: action.href, target: '_blank', rel: 'noopener noreferrer' } : {})}
          sx={{ minHeight: 40, whiteSpace: 'nowrap' }}
        >
          {action.label}
        </Button>
      ))}
    </Box>
  );
}

export default function AttentionCard({ attention, actions, children }) {
  const layout = useContext(AttentionLayoutContext);
  const titleId = useId();
  if (!attention) return null;
  const { severity, count, title, detail } = attention;

  if (layout === 'embedded') {
    return (
      <Box data-testid={`attention-body-${attention.key}`}>
        {detail ? <Typography variant="body2" color="text.secondary">{detail}</Typography> : null}
        {children ? <Box sx={{ mt: detail ? 1 : 0 }}>{children}</Box> : null}
        <Actions actions={actions} align="flex-start" />
      </Box>
    );
  }

  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      data-testid={`attention-card-${attention.key}`}
      sx={{
        mb: 2,
        p: { xs: 1.5, sm: 2 },
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: severity === 'urgent' ? 'error.main' : 'divider',
        borderRadius: 1,
        minWidth: 0,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <SeverityGlyph severity={severity} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5, minHeight: 32 }}>
            <Typography id={titleId} component="h2" variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
              {title}
            </Typography>
            <CountChip severity={severity} count={count} />
          </Box>
          {detail ? <Typography variant="body2" color="text.secondary">{detail}</Typography> : null}
        </Box>
      </Stack>
      {children ? <Box sx={{ mt: 1.5 }}>{children}</Box> : null}
      <Actions actions={actions} align="flex-end" />
    </Box>
  );
}
