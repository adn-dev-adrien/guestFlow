import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, Table, TableHead, TableRow,
  TableCell, TableBody, Stack, Alert, Chip, CircularProgress, Link, Tooltip,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PersonIcon from '@mui/icons-material/Person';
import EuroIcon from '@mui/icons-material/Euro';
import StorefrontIcon from '@mui/icons-material/Storefront';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import MonthYearPicker from '../components/MonthYearPicker';
import { useAuth } from '../hooks/useAuth';
import { userHasRole, ADMIN } from '../constants/roles';
import { formatCurrency, displayDate } from '../utils/formatters';

// Visual classification: client (auxiliary debit) = amber, revenue (70xxx) = green,
// VAT (44571xxx) = blue, tourist-tax pass-through (46710000) = purple. Used to colour rows and
// the per-line chip in the journal preview.
const LINE_STYLES = {
  client:  { label: 'Client',  color: 'warning', bg: 'rgba(255, 152, 0, 0.08)' },
  revenue: { label: 'Produit', color: 'success', bg: 'rgba(76, 175, 80, 0.08)' },
  vat:     { label: 'TVA',     color: 'info',    bg: 'rgba(33, 150, 243, 0.08)' },
  tax_pass_through: { label: 'Taxe', color: 'secondary', bg: 'rgba(156, 39, 176, 0.08)' },
  other:   { label: 'Autre',   color: 'default', bg: 'rgba(0, 0, 0, 0.04)' },
};

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
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setSalesLoading(true);
    setError(null);
    Promise.all([
      api.getAccountingPlatforms(month, year).then((d) => { if (mounted) setPreview(d); }),
      api.getAccountingSales(month, year).then((d) => { if (mounted) setSales(d); }),
    ])
      .catch((err) => { if (mounted) setError(err.message || 'Impossible de charger l’aperçu.'); })
      .finally(() => { if (mounted) { setLoading(false); setSalesLoading(false); } });
    return () => { mounted = false; };
  }, [month, year]);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
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
      setError(err.message || 'Téléchargement impossible.');
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
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
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
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Détail des écritures du mois</Typography>
                <Typography variant="body2" color="text.secondary">
                  Aperçu exact du contenu du CSV : une carte par encaissement, partie double balancée.
                </Typography>
              </Box>
              {sales && sales.totals.entriesCount > 0 && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip size="small" label={`${sales.totals.entriesCount} encaissement${sales.totals.entriesCount > 1 ? 's' : ''}`} />
                  <Chip
                    size="small"
                    color={sales.totals.allBalanced ? 'success' : 'error'}
                    icon={sales.totals.allBalanced ? <CheckCircleIcon /> : <WarningAmberIcon />}
                    label={sales.totals.allBalanced ? 'Tout équilibré' : 'Déséquilibre détecté'}
                  />
                  <Chip size="small" variant="outlined" label={`Total débits ${formatCurrency(sales.totals.totalDebits)}`} />
                </Stack>
              )}
            </Stack>

            {salesLoading && (
              <Stack direction="row" spacing={1} sx={{ py: 2, alignItems: 'center' }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">Chargement des écritures…</Typography>
              </Stack>
            )}

            {!salesLoading && sales && sales.entries.length === 0 && (
              <Box sx={{ py: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Aucun encaissement pour ce mois — rien à exporter.
                </Typography>
              </Box>
            )}

            {!salesLoading && sales && sales.entries.length > 0 && (
              <Stack spacing={2}>
                {sales.entries.map((entry) => (
                  <JournalEntryCard
                    key={`${entry.reservationId}-${entry.kind}`}
                    entry={entry}
                    canOpenReservation={canOpenReservation}
                  />
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ mb: 2, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Encaissements du mois</Typography>
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

            {loading && <Typography variant="body2" color="text.secondary">Chargement…</Typography>}

            {!loading && preview && preview.rows.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Aucun encaissement ce mois-là.
              </Typography>
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
                      <TableCell>Revenu brut</TableCell>
                      <TableCell>Commission</TableCell>
                      <TableCell sx={{ fontWeight: 700, bgcolor: 'rgba(46,125,50,0.08)' }}>Net perçu (versement)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.rows.map((row, idx) => {
                      // Row → reservation file, admin only. The accountant role is read-only
                      // accounting and the server 403s `/api/reservations/*` for them, so the
                      // link stays hidden at the UI layer too. `userHasRole(user, ADMIN)` is the
                      // single gate (same helper as the sidebar + journal cards).
                      const clickable = canOpenReservation && row.reservationId != null;
                      return (
                        <TableRow
                          key={idx}
                          hover={clickable}
                          onClick={clickable ? () => navigate(`/reservations/${row.reservationId}`) : undefined}
                          sx={clickable ? { cursor: 'pointer' } : undefined}
                        >
                          <TableCell>{displayDate(row.date)}</TableCell>
                          <TableCell>{row.propertyName || '—'}</TableCell>
                          <TableCell>{row.client}</TableCell>
                          <TableCell>{row.platform}</TableCell>
                          <TableCell sx={{ width: 32, p: 0.5 }}>
                            <KindBadge kind={row.kind} />
                          </TableCell>
                          {/* Revenu brut (CA) = what the guest paid the platform. */}
                          <TableCell>{formatCurrency(row.encaissement)}</TableCell>
                          <TableCell>{row.commission == null ? '—' : `− ${formatCurrency(row.commission)}`}</TableCell>
                          {/* Net perçu (versement) — highlighted: it's the figure the operator reconciles
                              against the platform's bank transfer. */}
                          <TableCell sx={{ fontWeight: 700, bgcolor: 'rgba(46,125,50,0.08)' }}>
                            {formatCurrency(row.net)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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

// ─── JournalEntryCard ──────────────────────────────────────────────────────────────────────────
// One card per encaissement. Header shows the date, kind (acompte / solde), client, encaissement TTC,
// and the platform info if non-direct. The body is a balanced mini-journal coloured by line type.

const KIND_LABELS = { deposit: 'Acompte', balance: 'Solde', complement: 'Complément' };

// Tight single-letter badge so the encaissements table can show the kind without eating a
// full column. Same colour palette as the journal cards' kind chip (amber / blue / purple).
const KIND_BADGE_STYLES = {
  deposit:    { letter: 'A', color: 'warning.contrastText', bgcolor: 'warning.main' },
  balance:    { letter: 'S', color: 'info.contrastText',    bgcolor: 'info.main' },
  complement: { letter: 'C', color: 'secondary.contrastText', bgcolor: 'secondary.main' },
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
  const clientNode = canOpenReservation ? (
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
          px: { xs: 2, sm: 2.5 }, py: 1.5,
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
          <Chip size="small" label={KIND_LABELS[entry.kind] || entry.kind} />
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <PersonIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            {clientNode}
          </Stack>
          {isPlatform && (
            <Chip
              size="small"
              color="info"
              variant="outlined"
              icon={<StorefrontIcon />}
              label={entry.platform.platform}
            />
          )}
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Stack sx={{ alignItems: 'flex-end' }}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <EuroIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {formatCurrency(entry.encaissementTtc)}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {Math.round((entry.fraction || 0) * 100)} % du séjour ({formatCurrency(entry.finalPrice)})
            </Typography>
          </Stack>
          <Chip
            size="small"
            color={entry.balanced ? 'success' : 'error'}
            icon={entry.balanced ? <CheckCircleIcon /> : <WarningAmberIcon />}
            label={entry.balanced ? 'Équilibré' : 'Déséquilibré'}
            sx={{ fontWeight: 600 }}
          />
        </Stack>
      </Box>

      {isPlatform && (
        <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 1, bgcolor: 'rgba(33, 150, 243, 0.04)', borderBottom: '1px dashed', borderColor: 'divider' }}>
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

      <Table size="small" sx={{ '& td, & th': { borderColor: 'rgba(0,0,0,0.06)' } }}>
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
              <TableRow key={idx} sx={{ bgcolor: s.bg }}>
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
                <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: line.debit != null ? 700 : 400 }}>
                  {line.debit != null ? formatCurrency(line.debit) : '—'}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: line.credit != null ? 700 : 400 }}>
                  {line.credit != null ? formatCurrency(line.credit) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Σ</TableCell>
            <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{formatCurrency(entry.sumDebits)}</TableCell>
            <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{formatCurrency(entry.sumCredits)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}
