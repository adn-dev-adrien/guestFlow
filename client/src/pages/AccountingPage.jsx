import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import {
  Box, Card, CardContent, Typography, Table, TableHead, TableRow,
  TableCell, TableBody, Stack, Chip, Link, Tooltip, IconButton,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PersonIcon from '@mui/icons-material/Person';
import EuroIcon from '@mui/icons-material/Euro';
import StorefrontIcon from '@mui/icons-material/Storefront';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import MonthYearPicker from '../components/MonthYearPicker';
import { useAuth } from '../hooks/useAuth';
import { userHasRole, ADMIN } from '../constants/roles';
import { formatCurrency, displayDate } from '../utils/formatters';
import { alpha } from '@mui/material/styles';
import { useToast } from '../components/DialogProvider';
import ErrorAlert from '../components/ErrorAlert';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import StatusBadge from '../components/StatusBadge';
import PlatformChip from '../components/PlatformChip';
import CancellationCompensationsSection from '../components/CancellationCompensationsSection';

// Visual classification: client (auxiliary debit) = amber, revenue (70xxx) = green,
// VAT (44571xxx) = blue, tourist-tax pass-through (46710000) = purple. Used to colour rows and
// the per-line chip in the journal preview.
const LINE_STYLES = {
  client:  { label: 'Client',  color: 'warning' },
  revenue: { label: 'Produit', color: 'success' },
  vat:     { label: 'TVA',     color: 'info' },
  tax_pass_through: { label: 'Taxe', color: 'secondary' },
  other:   { label: 'Autre',   color: 'default' },
};
// Soft tinted row background from the line's semantic color (specs/ds-sweep-finance.md §3.10).
const lineBg = (color) => (t) => (color === 'default'
  ? alpha(t.palette.grey[500], 0.08)
  : alpha(t.palette[color].main, 0.08));

/**
 * Comptabilité — read-only page for the accountant role (also accessible to admins).
 * Picks a month + year, lets the user download the monthly sales CSV, and shows a preview table of
 * the platform commissions for that month.
 *
 * Driven by:
 *   - GET /api/accounting/platforms?month=&year=  → preview JSON
 *   - GET /api/accounting/sales.csv?month=&year=  → CSV download
 */

export default function AccountingPage() {
  const { user } = useAuth();
  // Only admins may navigate to a reservation file — the accountant role is read-only-accounting and
  // the server already 403s `/api/reservations/*` for them. The link is hidden at the UI layer too.
  // Uses the central `userHasRole` helper (constants/roles.js) so this stays consistent with the
  // sidebar's gating and survives the legacy `user.role` (string) vs new `user.roles` (array)
  // shape — the helper has a back-compat shim. Direct `user.role === 'admin'` reads silently broke
  // post admin-account-management refactor (sessions carry `roles: ['admin']`, not `role: 'admin'`),
  // and that's exactly what made the client name in the journal entry cease to be a clickable link.
  // Pinned by `__tests__/AccountingPage.regression.test.js`.
  const canOpenReservation = userHasRole(user, ADMIN);
  const navigate = useNavigate();
  const today = new Date();
  // Default to the previous month — accounting work is typically retrospective.
  const defaultDate = useMemo(() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }, []);

  // Month + year are persisted in the URL (`?month=&year=`) so the back-button restores the user's
  // selection after they open a reservation file and return. Each picker change replaces the current
  // history entry (no spurious back-stack noise); navigating to a reservation pushes a new one.
  const [searchParams, setSearchParams] = useSearchParams();
  const month = (() => {
    const m = Number(searchParams.get('month'));
    return Number.isInteger(m) && m >= 1 && m <= 12 ? m : defaultDate.month;
  })();
  const year = (() => {
    const y = Number(searchParams.get('year'));
    return Number.isInteger(y) && y >= 2000 && y <= 9999 ? y : defaultDate.year;
  })();
  const setMonth = (m) => setSearchParams({ month: String(m), year: String(year) }, { replace: true });
  const setYear = (y) => setSearchParams({ month: String(month), year: String(y) }, { replace: true });
  const [preview, setPreview] = useState(null);
  const [sales, setSales] = useState(null);
  const [loading, setLoading] = useState(false);
  const [salesLoading, setSalesLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Load failures stay persistent (ErrorAlert + retry); the CSV-download failure toasts
  // (specs/ds-sweep-finance.md §3.8).
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const { showError } = useToast();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setSalesLoading(true);
    setLoadError(false);
    Promise.all([
      api.getAccountingPlatforms(month, year).then((d) => { if (mounted) setPreview(d); }),
      api.getAccountingSales(month, year).then((d) => { if (mounted) setSales(d); }),
    ])
      .catch(() => { if (mounted) setLoadError(true); })
      .finally(() => { if (mounted) { setLoading(false); setSalesLoading(false); } });
    return () => { mounted = false; };
  }, [month, year, reloadNonce]);

  // Banking or reopening a cancellation compensation adds/removes an entry in the month's journal.
  // The compensations card is self-contained, so it announces the change and the journal + CSV
  // preview reload from it — otherwise the card above would keep showing a stale écriture.
  useEffect(() => {
    const onCompensationsChanged = () => setReloadNonce((n) => n + 1);
    window.addEventListener('guestflow:compensations-changed', onCompensationsChanged);
    return () => window.removeEventListener('guestflow:compensations-changed', onCompensationsChanged);
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await api.downloadAccountingSalesCsv(month, year);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const mm = String(month).padStart(2, '0');
      a.download = `ventes-${year}-${mm}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError(err.message || 'Téléchargement impossible.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Box>
      <PageActionBar
        title="Comptabilité"
        actionsBefore={[
          {
            icon: <DescriptionIcon />,
            tooltip: 'Télécharger le CSV des ventes',
            onClick: handleDownload,
            color: 'primary',
            disabled: downloading,
            ariaLabel: 'Télécharger le CSV des ventes',
          },
        ]}
      />

      <Box sx={{ maxWidth: { xs: '100%', md: 960 }, mx: 'auto', px: { xs: 0, sm: 1 } }}>
        {loadError && (
          <ErrorAlert message="Impossible de charger l'aperçu comptable." onRetry={() => setReloadNonce((n) => n + 1)} sx={{ mb: 2 }} />
        )}

        <MonthYearPicker
          month={month}
          year={year}
          onChange={({ month: m, year: y }) => { if (m !== month) setMonth(m); if (y !== year) setYear(y); }}
          description="CSV mensuel des factures de vente (écritures comptables) + détail des commissions plateformes."
        />

        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack direction="row" sx={{ mb: 2, flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="sectionHeader">Détail des écritures du mois</Typography>
                <Typography variant="body2" color="text.secondary">
                  Aperçu exact du contenu du CSV : une carte par écriture (encaissement ou remboursement), partie double balancée.
                </Typography>
              </Box>
              {sales && sales.totals.entriesCount > 0 && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {/* « écritures » plutôt qu'« encaissements » : le journal mêle désormais les
                      encaissements et les avoirs (specs/reservation-refunds.md §3.4). */}
                  <Chip size="small" label={`${sales.totals.entriesCount} écriture${sales.totals.entriesCount > 1 ? 's' : ''}`} />
                  <StatusBadge
                    status={sales.totals.allBalanced ? 'success' : 'error'}
                    icon={sales.totals.allBalanced ? <CheckCircleIcon /> : <WarningAmberIcon />}
                    label={sales.totals.allBalanced ? 'Tout équilibré' : 'Déséquilibre détecté'}
                  />
                  <Chip size="small" variant="outlined" label={`Total débits ${formatCurrency(sales.totals.totalDebits)}`} />
                </Stack>
              )}
            </Stack>

            {salesLoading && <LoadingState label="Chargement des écritures…" py={2} />}

            {!salesLoading && sales && sales.entries.length === 0 && (
              <EmptyState message="Aucun encaissement pour ce mois — rien à exporter." py={3} />
            )}

            {!salesLoading && sales && sales.entries.length > 0 && (
              <Stack spacing={2}>
                {groupEntries(sales.entries).map((block) => (block.group ? (
                  /* specs/single-payment-at-check-in.md §3.3 rule 13 — one collection, one card. The
                     ventilation underneath is untouched: each bucket keeps its own balanced journal,
                     its own account and its own VAT. */
                  <Box key={block.key} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: { xs: 1, sm: 1.5 } }}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1 }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        Encaissé le {displayDate(block.group.at)} — {formatCurrency(block.group.total)}
                      </Typography>
                      <Chip size="small" variant="outlined" label="Paiement unique" />
                    </Stack>
                    <Stack spacing={2}>
                      {block.entries.map((entry) => (
                        <JournalEntryCard
                          key={`${entry.reservationId}-${entry.kind}-${entry.refundId ?? entry.paidDate}`}
                          entry={entry}
                          canOpenReservation={canOpenReservation}
                        />
                      ))}
                    </Stack>
                  </Box>
                ) : (
                  <JournalEntryCard
                    key={block.key}
                    entry={block.entries[0]}
                    canOpenReservation={canOpenReservation}
                  />
                )))}
              </Stack>
            )}
          </CardContent>
        </Card>

        {/* Indemnités d'annulation (specs/cancellation-compensation.md §6.3). Read-only for the
            accountant role — the server refuses their writes anyway. */}
        <CancellationCompensationsSection month={month} year={year} canEdit={canOpenReservation} />

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ mb: 2, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Typography variant="sectionHeader">Encaissements du mois</Typography>
              <Stack spacing={0.5} sx={{ alignItems: { xs: 'flex-start', sm: 'flex-end' } }}>
                {/* Inline legend for the A/S/C badges shown on each row. Discreet — small font
                    + the colour pastilles do the heavy lifting visually. */}
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  {['deposit', 'balance', 'complement'].map((kind) => (
                    <Stack key={kind} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <KindBadge kind={kind} />
                      <Typography variant="caption" color="text.secondary">{KIND_LABELS[kind]}</Typography>
                    </Stack>
                  ))}
                </Stack>
                {preview && (
                  <Typography variant="body2" color="text.secondary">
                    Total commissions plateformes : <strong>{formatCurrency(preview.totalCommission)}</strong>
                  </Typography>
                )}
              </Stack>
            </Stack>

            {loading && <LoadingState py={2} />}

            {!loading && preview && preview.rows.length === 0 && (
              <EmptyState message="Aucun encaissement ce mois-là." py={3} />
            )}

            {!loading && preview && preview.rows.length > 0 && (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Logement</TableCell>
                      <TableCell>Client</TableCell>
                      <TableCell>Plateforme</TableCell>
                      {/* Small badge column with no header label (the badges speak for themselves). */}
                      <TableCell sx={{ width: 32, p: 0.5 }} />
                      <TableCell align="right">Revenu brut</TableCell>
                      <TableCell align="right">Commission</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, bgcolor: (t) => alpha(t.palette.success.main, 0.08) }}>Net perçu (versement)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {groupPreviewRows(preview.rows).map((block, idx) => (
                      <EncaissementRow
                        key={block.group ? block.group.id : `r${idx}`}
                        block={block}
                        canOpenReservation={canOpenReservation}
                        onOpen={(id) => navigate(`/reservations/${id}`)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}

/**
 * Une ligne du tableau « Encaissements du mois » (specs/single-payment-at-check-in.md §3.3 rule 13).
 *
 * Une collecte = une ligne. Quand elle réunit plusieurs échéances, la ligne porte le TOTAL réellement
 * encaissé — le montant qu'on retrouve sur le relevé bancaire — une puce « Paiement unique », et se
 * déplie sur le détail par échéance. Sinon c'est la ligne d'avant, inchangée.
 */
function EncaissementRow({ block, canOpenReservation, onOpen }) {
  const [open, setOpen] = useState(false);
  const first = block.rows[0];
  const clickable = canOpenReservation && first.reservationId != null;
  const grouped = Boolean(block.group);
  // Sur un groupe, les colonnes d'argent somment les échéances : le mouvement bancaire est unique.
  const sum = (key) => Math.round(block.rows.reduce((t, r) => t + (Number(r[key]) || 0), 0) * 100) / 100;
  const commission = block.rows.every((r) => r.commission == null) ? null : sum('commission');
  const openFiche = clickable ? () => onOpen(first.reservationId) : undefined;

  return (
    <>
      <TableRow
        hover={clickable}
        onClick={openFiche}
        sx={clickable ? { cursor: 'pointer' } : undefined}
      >
        <TableCell>{displayDate(grouped ? block.group.at : first.date)}</TableCell>
        <TableCell>{first.propertyName || '—'}</TableCell>
        <TableCell>{first.client}</TableCell>
        <TableCell><PlatformChip platform={first.platform} /></TableCell>
        <TableCell sx={{ width: 32, p: 0.5 }}>
          {grouped ? (
            <Tooltip title={open ? 'Masquer le détail' : `Paiement unique — ${block.rows.length} échéances`}>
              {/* `stopPropagation` : déplier n'est pas ouvrir la fiche — toute la ligne y mène. */}
              <IconButton
                size="small"
                aria-label="Détail du paiement unique"
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
              >
                {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : <KindBadge kind={first.kind} />}
        </TableCell>
        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(grouped ? sum('encaissement') : first.encaissement)}
        </TableCell>
        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {commission == null ? '—' : `− ${formatCurrency(commission)}`}
        </TableCell>
        <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', bgcolor: (t) => alpha(t.palette.success.main, 0.08) }}>
          {formatCurrency(grouped ? sum('net') : first.net)}
        </TableCell>
      </TableRow>
      {/* Le détail par échéance reste atteignable : la ventilation comptable, elle, n'a pas fusionné. */}
      {grouped && open && block.rows.map((r, i) => (
        <TableRow key={`${block.group.id}-${i}`} sx={{ bgcolor: (t) => alpha(t.palette.grey[500], 0.04) }}>
          <TableCell sx={{ color: 'text.secondary', pl: 4 }}>{displayDate(r.date)}</TableCell>
          <TableCell colSpan={3} sx={{ color: 'text.secondary' }}>{KIND_LABELS[r.kind] || r.kind}</TableCell>
          <TableCell sx={{ width: 32, p: 0.5 }}><KindBadge kind={r.kind} /></TableCell>
          <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.encaissement)}</TableCell>
          <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{r.commission == null ? '—' : `− ${formatCurrency(r.commission)}`}</TableCell>
          <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.net)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ─── JournalEntryCard ──────────────────────────────────────────────────────────────────────────
// One card per encaissement. Header shows the date, kind (acompte / solde), client, encaissement TTC,
// and the platform info if non-direct. The body is a balanced mini-journal coloured by line type.

/**
 * specs/single-payment-at-check-in.md §3.3 rule 13 — fold the entries that were ONE collection into
 * one block, in place, without reordering anything else. A group of one falls back to a plain card:
 * a lone entry is an ordinary payment, and framing it would announce a grouping that isn't one.
 */
export function groupEntries(entries) {
  const blocks = [];
  const byGroup = new Map();
  for (const entry of entries) {
    const key = `${entry.reservationId}-${entry.kind}-${entry.refundId ?? entry.paidDate}`;
    const id = entry.paymentGroup?.id;
    if (!id) {
      blocks.push({ key, group: null, entries: [entry] });
      continue;
    }
    const seen = byGroup.get(id);
    if (seen) { seen.entries.push(entry); continue; }
    const block = { key: `g-${id}`, group: entry.paymentGroup, entries: [entry] };
    byGroup.set(id, block);
    blocks.push(block);
  }
  // A group that ended up with a single entry (the other bucket fell in another month, or was
  // dropped as a pure-tax entry) reads as an ordinary payment.
  return blocks.map((b) => (b.group && b.entries.length < 2 ? { ...b, group: null } : b));
}

/**
 * specs/single-payment-at-check-in.md §3.3 rule 13 — le tableau des encaissements montre UNE ligne par
 * collecte, pas une par échéance.
 *
 * Écrit dans la spec dès la v2.9.0 mais jamais construit : le tableau listait deux encaissements pour
 * un seul mouvement bancaire, pendant que la carte de journal juste au-dessus les regroupait déjà.
 * L'opérateur lisait donc deux versements là où il n'y en avait qu'un (constaté en production le
 * 2026-09-01, réservations 22281 et 12).
 *
 * Même contrat que `groupEntries` : un groupe qui ne réunit qu'une ligne redevient une ligne
 * ordinaire — nommer « paiement unique » une collecte qui ne groupe rien serait un mensonge.
 */
export function groupPreviewRows(rows) {
  const blocks = [];
  const byGroup = new Map();
  for (const row of (rows || [])) {
    const id = row.paymentGroup?.id;
    if (!id) { blocks.push({ group: null, rows: [row] }); continue; }
    const seen = byGroup.get(id);
    if (seen) { seen.rows.push(row); continue; }
    const block = { group: row.paymentGroup, rows: [row] };
    byGroup.set(id, block);
    blocks.push(block);
  }
  return blocks.map((b) => (b.group && b.rows.length < 2 ? { ...b, group: null } : b));
}

const KIND_LABELS = {
  deposit: 'Acompte', balance: 'Solde', complement: 'Complément',
  endOfStayComplement: 'Complément fin de séjour', midStayComplement: 'Prestations en séjour',
  // specs/reservation-refunds.md §3.4 rule 25 — an avoir: same journal, sides mirrored.
  refund: 'Remboursement',
  // specs/cancellation-compensation.md §6.3 — money in, but for a stay that never happened.
  compensation: "Indemnité d'annulation",
  // specs/arrival-payment-detail-and-adjustment.md §3.4 — les deux faces de « ce que le client a
  // vraiment remis » pour un paiement unique : une remise consentie à la porte, ou un pourboire.
  discount: 'Rabais accordé',
  tip: 'Pourboire',
};

// Tight single-letter badge so the encaissements table can show the kind without eating a
// full column. Same colour palette as the journal cards' kind chip (amber / blue / purple).
const KIND_BADGE_STYLES = {
  deposit:    { letter: 'A', color: 'warning.contrastText', bgcolor: 'warning.main' },
  balance:    { letter: 'S', color: 'info.contrastText',    bgcolor: 'info.main' },
  complement: { letter: 'C', color: 'secondary.contrastText', bgcolor: 'secondary.main' },
  compensation: { letter: 'I', color: 'success.contrastText', bgcolor: 'success.main' },
  discount: { letter: 'R', color: 'warning.contrastText', bgcolor: 'warning.main' },
  tip: { letter: 'P', color: 'success.contrastText', bgcolor: 'success.main' },
};

function KindBadge({ kind }) {
  const style = KIND_BADGE_STYLES[kind];
  if (!style) return null;
  return (
    <Tooltip title={KIND_LABELS[kind] || ''} arrow>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: '50%',
          fontSize: 11,
          fontWeight: 700,
          color: style.color,
          bgcolor: style.bgcolor,
          lineHeight: 1,
        }}
      >
        {style.letter}
      </Box>
    </Tooltip>
  );
}

function JournalEntryCard({ entry, canOpenReservation = false }) {
  const isPlatform = Boolean(entry.platform.platform);
  // An avoir reads « argent rendu » : warning-toned chip, an explicit minus on the amount, and no
  // « % du séjour » caption (a refund covers no share of it — the server sends `stayShare: null`).
  const isRefund = entry.direction === 'refund';
  // A compensation outlived its reservation (approving the cancellation deleted it), so the client
  // name must NOT link to a reservation page that would 404.
  const isCompensation = entry.direction === 'compensation';
  // specs/arrival-payment-detail-and-adjustment.md §3.4 — ni l'une ni l'autre ne couvre une part du
  // séjour : la remise en retire, le pourboire s'y ajoute sans rien vendre. Les deux sortent donc du
  // libellé « N % du séjour », qui n'aurait aucun sens sur elles.
  const isDiscount = entry.direction === 'discount';
  const isTip = entry.direction === 'tip';
  const isDeduction = isRefund || isDiscount;
  const clientNode = canOpenReservation && !isCompensation ? (
    <Link
      component={RouterLink}
      to={`/reservations/${entry.reservationId}`}
      underline="hover"
      sx={{ fontWeight: 600, fontSize: '0.875rem' }}
    >
      {entry.libelle}
    </Link>
  ) : (
    <Typography variant="body2" sx={{ fontWeight: 600 }}>{entry.libelle}</Typography>
  );
  return (
    <Card variant="outlined" sx={{ borderColor: entry.balanced ? 'divider' : 'error.main' }}>
      <Box
        sx={{
          px: { xs: 2, sm: 3 }, py: 1.5,
          bgcolor: 'grey.50',
          borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}>
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={`${String(entry.day).padStart(2, '0')}/${String(entry.month).padStart(2, '0')}/${entry.year}`}
          />
          <Chip
            size="small"
            color={isDeduction ? 'warning' : ((isCompensation || isTip) ? 'success' : 'default')}
            label={KIND_LABELS[entry.kind] || entry.kind}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <PersonIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            {clientNode}
          </Stack>
          {(isPlatform || (isCompensation && entry.platformName)) && (
            <Chip
              size="small"
              color="info"
              variant="outlined"
              icon={<StorefrontIcon />}
              label={isCompensation ? entry.platformName : entry.platform.platform}
            />
          )}
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Stack sx={{ alignItems: 'flex-end' }}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <EuroIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: isDeduction ? 'warning.dark' : 'inherit' }}>
                {isDeduction ? '− ' : ''}{formatCurrency(entry.encaissementTtc)}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {isRefund && (entry.refundReason || 'Remboursement au client')}
              {isCompensation && (entry.compensationStay?.startDate
                ? `Séjour annulé du ${displayDate(entry.compensationStay.startDate)} au ${displayDate(entry.compensationStay.endDate)}`
                : 'Séjour annulé')}
              {isDiscount && "Réduction accordée sur l'hébergement"}
              {isTip && 'Pourboire remis par le client'}
              {!isRefund && !isCompensation && !isDiscount && !isTip
                && `${Math.round(((entry.stayShare ?? entry.fraction) || 0) * 100)} % du séjour (${formatCurrency(entry.finalPrice)})`}
            </Typography>
          </Stack>
          <StatusBadge
            status={entry.balanced ? 'success' : 'error'}
            icon={entry.balanced ? <CheckCircleIcon /> : <WarningAmberIcon />}
            label={entry.balanced ? 'Équilibré' : 'Déséquilibré'}
          />
        </Stack>
      </Box>

      {isPlatform && (
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 1, bgcolor: (t) => alpha(t.palette.info.main, 0.04), borderBottom: '1px dashed', borderColor: 'divider' }}>
          <Stack direction="row" spacing={3} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              Revenu brut : <strong>{formatCurrency(entry.encaissementTtc)}</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Commission plateforme : <strong>− {formatCurrency(entry.platform.commission)}</strong>
            </Typography>
            <Typography variant="caption" sx={{ color: 'success.dark' }}>
              Net perçu (versement) : <strong>{formatCurrency(entry.platform.net)}</strong>
            </Typography>
          </Stack>
        </Box>
      )}

      <Table size="small" sx={{ '& td, & th': { borderColor: (t) => alpha(t.palette.common.black, 0.06) } }}>
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.50' }}>
            <TableCell sx={{ width: 80 }}>Type</TableCell>
            <TableCell sx={{ width: 170 }}>Compte</TableCell>
            <TableCell>Libellé</TableCell>
            <TableCell align="right" sx={{ width: 110 }}>Débit</TableCell>
            <TableCell align="right" sx={{ width: 110 }}>Crédit</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entry.lines.map((line, idx) => {
            const s = LINE_STYLES[line.type] || LINE_STYLES.other;
            return (
              <TableRow key={idx} sx={{ bgcolor: lineBg(s.color) }}>
                <TableCell>
                  <Chip size="small" color={s.color} variant="filled" label={s.label} sx={{ height: 22 }} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.85rem' }}>
                  <Box sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{line.compte}</Box>
                  {line.accountLabel && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
                      {line.accountLabel}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{line.libelle}</TableCell>
                <TableCell align="right" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: line.debit != null ? 700 : 400 }}>
                  {line.debit != null ? formatCurrency(line.debit) : '—'}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: line.credit != null ? 700 : 400 }}>
                  {line.credit != null ? formatCurrency(line.credit) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Σ</TableCell>
            <TableCell align="right" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(entry.sumDebits)}</TableCell>
            <TableCell align="right" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(entry.sumCredits)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}
