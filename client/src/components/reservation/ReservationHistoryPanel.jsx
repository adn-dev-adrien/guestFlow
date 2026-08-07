import React from 'react';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import LoadingState from '../LoadingState';
import EmptyState from '../EmptyState';
import { displayDateTime } from '../../utils/formatters';

/**
 * « Historique des modifications » card of a reservation fiche.
 *
 * Pure renderer: the server ships ready-to-print rows
 * (`{ field, group, label, kind: 'added'|'removed'|'changed', fromText, toText }`) split into
 * `changes` (what was edited) and `derived` (what the pricing engine recomputed).
 * See specs/reservation-history-granular-diff.md.
 *
 * Props:
 * - entries: array of `{ id, eventType, createdAt, changes, derived }`
 * - loading: boolean — a fetch is in flight
 * - open: boolean — body visible
 * - onToggle: () => void — « Voir / Masquer historique »
 */

// Title of an entry, per event type. Anything unknown reads « Modification » (the historical
// default). specs/arrival-departure-sas.md §3.7 adds the two SAS ones.
const HISTORY_EVENT_TITLES = {
  create: 'Création',
  update: 'Modification',
  sas_arrival: 'SAS arrivée',
  sas_departure: 'SAS départ',
};

const KIND_PREFIX = {
  added: { text: '+', color: 'success.main' },
  removed: { text: '−', color: 'error.main' },
};

// SQLite stores `datetime('now')` as a space-separated UTC string with no zone marker.
function formatHistoryDate(value) {
  if (!value) return '';
  const raw = String(value);
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const utcIso = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  if (Number.isNaN(new Date(utcIso).getTime())) return raw;
  return displayDateTime(utcIso);
}

function ChangeRow({ row }) {
  const prefix = KIND_PREFIX[row.kind];
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.5, lineHeight: 1.5 }}>
      {prefix && (
        <Typography variant="caption" sx={{ fontWeight: 700, color: prefix.color, width: 12 }}>
          {prefix.text}
        </Typography>
      )}
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>
        {row.label}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
        {row.fromText}
        {row.fromText != null && row.toText != null && (
          <Box component="span" sx={{ mx: 0.5, color: 'text.disabled' }}>→</Box>
        )}
        {row.toText}
      </Typography>
    </Box>
  );
}

// Rows carrying a `group` (Options / Ressources) get their group name printed once, above them.
function ChangeList({ rows }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {rows.map((row, index) => (
        <React.Fragment key={`${row.field}-${row.label}-${index}`}>
          {row.group && row.group !== rows[index - 1]?.group && (
            <Typography variant="caption" color="text.disabled" sx={{ mt: index === 0 ? 0 : 0.5 }}>
              {row.group}
            </Typography>
          )}
          <Box sx={{ pl: row.group ? 1 : 0 }}>
            <ChangeRow row={row} />
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

function HistoryEntry({ entry }) {
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  const derived = Array.isArray(entry.derived) ? entry.derived : [];
  const emptyText = entry.eventType === 'create' ? 'Réservation créée' : 'Mise à jour sans changement détecté';

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1, py: 0.75, bgcolor: 'grey.50' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {HISTORY_EVENT_TITLES[entry.eventType] || 'Modification'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatHistoryDate(entry.createdAt)}
        </Typography>
      </Box>

      <Box sx={{ mt: 0.5 }}>
        {changes.length === 0 ? (
          <Typography variant="caption" color="text.secondary">{emptyText}</Typography>
        ) : (
          <ChangeList rows={changes} />
        )}

        {derived.length > 0 && (
          <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid', borderColor: 'divider', opacity: 0.85 }}>
            <Typography variant="caption" color="text.disabled">Recalculs</Typography>
            <ChangeList rows={derived} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function ReservationHistoryPanel({ entries = [], loading = false, open = false, onToggle }) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent sx={{ py: 1.25, px: { xs: 1, sm: 2 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="sectionHeader">Historique des modifications</Typography>
          <Button size="small" variant="outlined" onClick={onToggle}>
            {open ? 'Masquer historique' : 'Voir historique'}
          </Button>
        </Box>

        {open && (
          <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {loading && <LoadingState py={2} />}
            {!loading && entries.length === 0 && <EmptyState message="Aucun historique disponible." py={2} />}
            {!loading && entries.map((entry) => <HistoryEntry key={entry.id} entry={entry} />)}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
