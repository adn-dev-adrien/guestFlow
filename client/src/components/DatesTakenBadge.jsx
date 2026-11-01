/**
 * DatesTakenBadge — « Dates prises » on a devis or an unpaid reservation whose nights another stay now holds
 * (specs/payment-link-lifecycle.md rule 48). The record stays as it is; the badge says so and opens the stay
 * that took the dates. Renders nothing without a marker. Inside the router the link leaves through the page's
 * unsaved-changes guard, like a sidebar link (rule 48, audit R11-C1): a dirty fiche asks before it is left.
 *
 * Props:
 *   - datesTaken?: { label: string, takenBy?: { id, label, url } } | null   — the server's marker, printed as is
 *   - linked?: boolean — the badge opens `takenBy.url` (default true); a list row passes false, its row opens the devis
 */
import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import { Link as RouterLink, useInRouterContext, useNavigate } from 'react-router';
import { softChipSx } from './StatusBadge';
import { touchHitArea } from '../utils/touchHitArea';
import { isPlainClick, navigateThroughGuard } from '../utils/guardedNavigation';

function GuardedBadge({ datesTaken, url }) {
  const navigate = useNavigate();
  const open = (event) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigateThroughGuard(navigate, url);
  };
  return <Badge datesTaken={datesTaken} nav={{ component: RouterLink, to: url, onClick: open, clickable: true }} />;
}

export default function DatesTakenBadge({ datesTaken, linked = true }) {
  const inRouter = useInRouterContext();
  if (!datesTaken) return null;
  const url = linked ? datesTaken.takenBy?.url : null;
  if (url && inRouter) return <GuardedBadge datesTaken={datesTaken} url={url} />;
  return <Badge datesTaken={datesTaken} nav={url ? { component: 'a', href: url, clickable: true } : null} />;
}

function Badge({ datesTaken, nav }) {
  const takenBy = datesTaken.takenBy || null;
  const asLink = Boolean(nav);
  const chip = (
    <Chip
      size="small"
      icon={<EventBusyIcon />}
      label={datesTaken.label}
      aria-label={takenBy ? `${datesTaken.label} par ${takenBy.label}` : datesTaken.label}
      {...(nav || {})}
      // A link in the action bar: a 44 px hit area on a finger-driven screen (review of #907, m4).
      sx={[softChipSx('warning'), { fontWeight: 600 }, asLink ? touchHitArea : {}]}
    />
  );
  return takenBy ? <Tooltip title={`Par ${takenBy.label}`}><span style={{ display: 'inline-flex' }}>{chip}</span></Tooltip> : chip;
}
