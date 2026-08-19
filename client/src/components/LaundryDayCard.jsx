/**
 * LaundryDayCard — pure renderer for the weekly bed-linen summary on PlanningPage
 * (specs/weekly-bed-linen-tracking.md §6.1).
 *
 * Sits under the day header of every laundry-day cell. Two blocks side by side: "À apporter"
 * (sheets used since the previous laundry day) + "À récupérer" (the previous batch coming back
 * from the laundry). Stacks vertically on `xs`.
 *
 * Returns `null` when both sides are zero (rule 13: no visual noise on a quiet week). The
 * server still emits zero-everywhere days uniformly — the silence is a client decision.
 *
 * Props:
 *   data — { dropOff: { singleBeds, doubleBeds, babyBeds }, pickUp: same } from the server.
 *     Pass `undefined` / `null` → renders nothing. `dropOff.incomplete` (optional) lists the stays
 *     that declare bed linen with no quantity saved yet — rendered as a warning + clickable chips
 *     (specs/laundry-counts-explicit-option-only.md §3.2).
 *   inventoryAfter — per-type `clean` snapshot at end-of-day on this laundry day. Optional.
 *   date — ISO `YYYY-MM-DD` of this laundry day. Required when `onToggleSkip` is provided
 *     (the handler is called with this date).
 *   isSkipped — boolean. When true: the card greys out (opacity 0.45), the 3 detail blocks
 *     are replaced by a single muted caption "Voyage non réalisé — reporté au prochain
 *     voyage", and the header IconButton swaps to "Réactiver". Hide-when-empty rule is
 *     bypassed (a skipped card is always rendered, even if its pre-skip counts were 0).
 *     Spec: specs/skip-laundry-trip.md §3.3 + §6.
 *   onToggleSkip — `(date, nextValue) => Promise<void>`. When provided, the header shows an
 *     IconButton to flip the skip flag. Omit (or pass null) on read-only surfaces.
 *   onOpenReservation — `(reservationId) => void`. Called when an incompleteness chip is clicked.
 *     Omit → the chips render as plain, non-clickable labels. Kept as a callback (rather than a
 *     `useNavigate` inside) so the card stays a pure renderer, mountable without a Router.
 *   onEditExtra / onDeleteExtra — `(date) => void`. Only read when `data.kind === 'extra'`
 *     (specs/laundry-extra-trip.md §3.5 rule 19): the extra-trip card shows a pencil + a trash
 *     IconButton instead of the skip toggle. Omit both on read-only surfaces (reception role).
 *
 * `data.kind === 'extra'` flags an extra laundry trip on a free date: the title changes, a small
 * « exceptionnel » chip joins it, `data.pickUpAll === false` adds the « Récupération partielle »
 * caption listing `data.leftAtLaundry`, `isSkipped` / `onToggleSkip` are ignored, and the card is
 * always rendered (the operator must see and be able to undo his own decision).
 */
import React from 'react';
import { Card, CardContent, Box, Typography, Stack, IconButton, Tooltip, Chip } from '@mui/material';
import { cyan } from '@mui/material/colors';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { formatSheets, formatTowels } from '../utils/formatLinen';

// Laundry-themed palette (2026-06-02). Cyan reads as "fresh / water / linen" without leaning
// clinical or flashy. Three tones cascade — bg subtle → border just defined enough to pop off
// the page → icon + title saturated enough to draw the eye to the actionable info.
const LAUNDRY_BG = cyan[50];      // #E0F7FA
const LAUNDRY_BORDER = cyan[200]; // #80DEEA
const LAUNDRY_ACCENT = cyan[800]; // #00838F

function totalSheets(side) {
  if (!side) return 0;
  return Number(side.singleBeds || 0) + Number(side.doubleBeds || 0) + Number(side.babyBeds || 0);
}

function totalTowels(side) {
  if (!side) return 0;
  return Number(side.largeTowels || 0) + Number(side.mediumTowels || 0) + Number(side.smallTowels || 0)
    + Number(side.bathMats || 0);
}

// One half of a signed manual line, as positive counts: `sign = 1` keeps the additions, `sign = -1`
// keeps the withdrawals (specs/laundry-manual-removals.md §3 rule 7). Everything else lands at 0, so
// the existing formatters — which only print what is > 0 — render exactly one sentence per half.
function signedHalf(counts, sign) {
  if (!counts) return null;
  const out = {};
  for (const [key, value] of Object.entries(counts)) {
    const n = Number(value) || 0;
    out[key] = Math.sign(n) === sign ? Math.abs(n) : 0;
  }
  return out;
}

function SideBlock({ title, side }) {
  const sheetsLine = formatSheets(side);
  const towelsLine = formatTowels(side);
  // Both null → render the em-dash placeholder so the visual symmetry holds when only the
  // other side has something to show.
  const hasAny = sheetsLine || towelsLine;
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </Typography>
      {!hasAny && (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>—</Typography>
      )}
      {sheetsLine && (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, mr: 0.5 }}>Draps :</Box>
          {sheetsLine}
        </Typography>
      )}
      {towelsLine && (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, mr: 0.5 }}>Serviettes :</Box>
          {towelsLine}
        </Typography>
      )}
    </Box>
  );
}

// Third block — "Disponible après ce dépôt" (specs/linen-inventory-shortage-tracking.md §6.2).
// Prop `inventoryAfter` is the per-type `clean` snapshot at end-of-day on this laundry day.
// Each type with stock > 0 (i.e. tracked at all — server emits only those) gets a chip; values
// < 0 render in red with the math-minus prefix (`−2 bébé`).
function formatInventoryParts(byType, typeKeys, labels) {
  if (!byType) return [];
  const out = [];
  for (const t of typeKeys) {
    if (!(t in byType)) continue;
    const n = Number(byType[t]);
    const label = labels[t];
    const isShortage = n < 0;
    out.push({
      key: t,
      text: isShortage ? `−${Math.abs(n)} ${label(Math.abs(n))}` : `${n} ${label(n)}`,
      isShortage,
    });
  }
  return out;
}

const BED_LABELS = {
  double: (n) => (n > 1 ? 'doubles' : 'double'),
  single: (n) => (n > 1 ? 'simples' : 'simple'),
  baby: () => 'bébé',
};
const TOWEL_LABELS = {
  large: (n) => (n > 1 ? 'grandes' : 'grande'),
  medium: (n) => (n > 1 ? 'moyennes' : 'moyenne'),
  small: (n) => (n > 1 ? 'petites' : 'petite'),
  bathMat: () => 'tapis',
};

function InventoryLine({ label, parts }) {
  if (parts.length === 0) return null;
  return (
    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>
      <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, mr: 0.5 }}>{label}</Box>
      {parts.map((p, idx) => (
        <Box
          key={p.key}
          component="span"
          sx={{ color: p.isShortage ? 'error.main' : 'inherit', fontWeight: p.isShortage ? 700 : 600 }}
        >
          {idx > 0 && <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}> · </Box>}
          {p.text}
        </Box>
      ))}
    </Typography>
  );
}

export default function LaundryDayCard({
  data, inventoryAfter, date, isSkipped = false, onToggleSkip, manualAddition, onEditManual, onOpenReservation,
  onEditExtra, onDeleteExtra,
}) {
  if (!data) return null;
  // specs/laundry-extra-trip.md §3.5 rule 19 — an extra trip on a free date. It cannot be skipped
  // (delete it instead), so the skip state is ignored for it.
  const isExtra = data.kind === 'extra';
  const skipped = isSkipped && !isExtra;
  const isPartial = isExtra && data.pickUpAll === false;
  const leftSheets = isPartial ? formatSheets(data.leftAtLaundry) : null;
  const leftTowels = isPartial ? formatTowels(data.leftAtLaundry) : null;
  const leftLine = [leftSheets, leftTowels].filter(Boolean).join(' · ');
  const canEditExtra = isExtra && typeof onEditExtra === 'function' && Boolean(date);
  const canDeleteExtra = isExtra && typeof onDeleteExtra === 'function' && Boolean(date);
  // specs/laundry-counts-explicit-option-only.md §3.2 rule 9 — stays of this window that declare
  // bed linen but carry no quantity yet. They contribute 0 to the counts above, so the card says so
  // rather than letting the operator read a number it knows is short.
  const incomplete = Array.isArray(data.dropOff?.incomplete) ? data.dropOff.incomplete : [];
  // The manual line (specs/manual-laundry-additions.md) is already folded into `data` by the server;
  // here we only surface the captions + the edit affordance. It is SIGNED
  // (specs/laundry-manual-removals.md §3 rule 7): the positive half is linen added to the trip, the
  // negative half is linen the operator washed himself — two different sentences, both in positive
  // numbers, so « −2 » never reaches the operator's eye.
  const manualAdded = signedHalf(manualAddition, 1);
  const manualWithdrawn = signedHalf(manualAddition, -1);
  const manualSheets = formatSheets(manualAdded);
  const manualTowels = formatTowels(manualAdded);
  const withdrawnSheets = formatSheets(manualWithdrawn);
  const withdrawnTowels = formatTowels(manualWithdrawn);
  const hasManual = Boolean(manualSheets || manualTowels);
  const hasWithdrawn = Boolean(withdrawnSheets || withdrawnTowels);
  const canEditManual = typeof onEditManual === 'function' && Boolean(date);
  // Hide the card when everything is zero on BOTH sides (no sheets and no towels at all). Per
  // spec rule 13 — keeps a quiet week silent. EXCEPTION (specs/skip-laundry-trip.md §3.3
  // rule 11): a skipped card is ALWAYS shown so the operator can see (and undo) their own
  // decision, even if the pre-skip counts would have been 0. SECOND EXCEPTION
  // (specs/laundry-counts-explicit-option-only.md §3.2): a week whose only departures still lack
  // their quantities totals zero on both sides — the very case the warning exists for, so the card
  // must survive the silence rule.
  // THIRD EXCEPTION (specs/laundry-extra-trip.md §3.5 rule 19): an extra trip is always rendered —
  // it is the operator's own decision, and the card is where he edits or deletes it.
  const dropTotal = totalSheets(data.dropOff) + totalTowels(data.dropOff);
  const pickTotal = totalSheets(data.pickUp) + totalTowels(data.pickUp);
  if (dropTotal === 0 && pickTotal === 0 && !skipped && !isExtra && incomplete.length === 0) return null;

  // §3.5 — third block: post-drop available stock. Hidden when no inventory data is provided
  // (e.g. stock untracked = nothing to display).
  const bedParts = formatInventoryParts(inventoryAfter, ['double', 'single', 'baby'], BED_LABELS);
  const towelParts = formatInventoryParts(inventoryAfter, ['large', 'medium', 'small', 'bathMat'], TOWEL_LABELS);
  const hasInventoryLine = bedParts.length + towelParts.length > 0;

  // specs/skip-laundry-trip.md §3.3 — the IconButton flips the skip state via the parent's
  // handler. Optimistic UI lives in PlanningPage; this component just signals "the operator
  // clicked the toggle for THIS date".
  const canToggleSkip = !isExtra && typeof onToggleSkip === 'function' && Boolean(date);
  const handleClickSkip = canToggleSkip
    ? () => onToggleSkip(date, !skipped)
    : undefined;
  const skipTooltip = skipped
    ? 'Marquer ce voyage blanchisserie comme réalisé'
    : 'Marquer ce voyage blanchisserie comme non réalisé';

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.25,
        bgcolor: LAUNDRY_BG,
        borderColor: LAUNDRY_BORDER,
        opacity: skipped ? 0.45 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <LocalLaundryServiceIcon fontSize="small" sx={{ color: LAUNDRY_ACCENT }} />
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700, color: LAUNDRY_ACCENT, flexGrow: 1, minWidth: 0 }}>
            {isExtra ? (
              // Shorter on xs: the header also holds the pencil / trash / « + » buttons.
              <>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Voyage blanchisserie exceptionnel</Box>
                <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Voyage exceptionnel</Box>
              </>
            ) : 'Linge à la blanchisserie'}
          </Typography>
          {isExtra && (
            <Chip
              size="small"
              variant="outlined"
              label="exceptionnel"
              sx={{ color: LAUNDRY_ACCENT, borderColor: LAUNDRY_ACCENT, fontWeight: 600, display: { xs: 'none', sm: 'inline-flex' } }}
            />
          )}
          {canEditExtra && (
            <Tooltip title="Modifier le voyage exceptionnel" arrow>
              <IconButton
                size="small"
                onClick={() => onEditExtra(date)}
                aria-label="Modifier le voyage exceptionnel"
                sx={{ color: LAUNDRY_ACCENT }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {canDeleteExtra && (
            <Tooltip title="Supprimer le voyage exceptionnel" arrow>
              <IconButton
                size="small"
                onClick={() => onDeleteExtra(date)}
                aria-label="Supprimer le voyage exceptionnel"
                sx={{ color: LAUNDRY_ACCENT }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {canEditManual && (
            <Tooltip title="Ajouter du linge manuellement" arrow>
              <IconButton
                size="small"
                onClick={() => onEditManual(date)}
                aria-label="Ajouter du linge manuellement"
                sx={{ color: LAUNDRY_ACCENT }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {canToggleSkip && (
            <Tooltip title={skipTooltip} arrow>
              <IconButton
                size="small"
                onClick={handleClickSkip}
                aria-label={skipTooltip}
                sx={{ color: LAUNDRY_ACCENT }}
              >
                {skipped ? <EventAvailableIcon fontSize="small" /> : <EventBusyIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
        </Box>
        {skipped ? (
          <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
            Voyage non réalisé — reporté au prochain voyage
          </Typography>
        ) : (
          <>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              divider={<Box sx={{ display: { xs: 'none', sm: 'block' }, borderLeft: '1px solid', borderColor: 'divider' }} />}
            >
              <SideBlock title="À apporter" side={data.dropOff} />
              <SideBlock title="À récupérer" side={data.pickUp} />
            </Stack>
            {isPartial && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.75, fontStyle: 'italic', color: 'text.secondary' }}>
                {leftLine
                  ? `Récupération partielle — reste à la blanchisserie : ${leftLine}`
                  : 'Récupération partielle — plus rien ne reste à la blanchisserie'}
              </Typography>
            )}
            {hasManual && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.75, fontStyle: 'italic', color: 'text.secondary' }}>
                dont ajout manuel : {[manualSheets, manualTowels].filter(Boolean).join(' · ')}
              </Typography>
            )}
            {hasWithdrawn && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.25, fontStyle: 'italic', color: 'text.secondary' }}>
                dont lavé par vos soins : {[withdrawnSheets, withdrawnTowels].filter(Boolean).join(' · ')}
              </Typography>
            )}
            {incomplete.length > 0 && (
              <Box sx={{ mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                  <WarningAmberIcon fontSize="small" sx={{ color: 'warning.main', mt: '2px' }} />
                  <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 700 }}>
                    {incomplete.length} séjour{incomplete.length > 1 ? 's' : ''} sans quantité de linge saisie — chiffre incomplet
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
                  {incomplete.map((r) => (
                    <Chip
                      key={r.id}
                      size="small"
                      variant="outlined"
                      color="warning"
                      label={[r.clientName, r.propertyName].filter(Boolean).join(' · ')}
                      onClick={typeof onOpenReservation === 'function' ? () => onOpenReservation(r.id) : undefined}
                    />
                  ))}
                </Stack>
              </Box>
            )}
            {hasInventoryLine && (
              <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Disponible après ce dépôt
                </Typography>
                <InventoryLine label="Draps :" parts={bedParts} />
                <InventoryLine label="Serviettes :" parts={towelParts} />
              </Box>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
