import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, Table, TableHead, TableRow,
  TableCell, TableBody, Stack, Alert, Chip, CircularProgress, Link,
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

// Visual classification: client (auxiliary debit) = amber, revenue (70xxx) = green,
// VAT (44571xxx) = blue. Used to colour rows and the per-line chip in the journal preview.
const LINE_STYLES = {
  client:  { label: 'Client',  color: 'warning', bg: 'rgba(255, 152, 0, 0.08)' },
  revenue: { label: 'Produit', color: 'success', bg: 'rgba(76, 175, 80, 0.08)' },
  vat:     { label: 'TVA',     color: 'info',    bg: 'rgba(33, 150, 243, 0.08)' },
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

function formatEur(value) {
  if (value == null) return '—';
  return `${Number(value).toFixed(2).replace('.', ',')} €`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function AccountingPage() {
  const { user } = useAuth();
  // Only admins may navigate to a reservation file — the accountant role is read-only-accounting and
  // the server already 403s `/api/reservations/*` for them. The link is hidden at the UI layer too.
  const canOpenReservation = user?.role === 'admin';
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
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Détail des écritures du mois</Typography>
                <Typography variant="body2" color="text.secondary">
                  Aperçu exact du contenu du CSV : une carte par encaissement, partie double balancée.
                </Typography>
              </Box>
              {sales && sales.totals.entriesCount > 0 && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={`${sales.totals.entriesCount} encaissement${sales.totals.entriesCount > 1 ? 's' : ''}`} />
                  <Chip
                    size="small"
                    color={sales.totals.allBalanced ? 'success' : 'error'}
                    icon={sales.totals.allBalanced ? <CheckCircleIcon /> : <WarningAmberIcon />}
                    label={sales.totals.allBalanced ? 'Tout équilibré' : 'Déséquilibre détecté'}
                  />
                  <Chip size="small" variant="outlined" label={`Total débits ${formatEur(sales.totals.totalDebits)}`} />
                </Stack>
              )}
            </Stack>

            {salesLoading && (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 2 }}>
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
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Commissions plateformes</Typography>
              {preview && (
                <Typography variant="body2" color="text.secondary">
                  Total commissions du mois : <strong>{formatEur(preview.totalCommission)}</strong>
                </Typography>
              )}
            </Stack>

            {loading && <Typography variant="body2" color="text.secondary">Chargement…</Typography>}

            {!loading && preview && preview.rows.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Aucun encaissement plateforme ce mois-là.
              </Typography>
            )}

            {!loading && preview && preview.rows.length > 0 && (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Client</TableCell>
                      <TableCell>Plateforme</TableCell>
                      <TableCell>Encaissement</TableCell>
                      <TableCell>Net total séjour</TableCell>
                      <TableCell>Brut payé client</TableCell>
                      <TableCell>Commission</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.rows.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{formatDate(row.date)}</TableCell>
                        <TableCell>{row.client}</TableCell>
                        <TableCell>{row.platform}</TableCell>
                        <TableCell>{formatEur(row.encaissement)}</TableCell>
                        <TableCell>{formatEur(row.net)}</TableCell>
                        <TableCell>{formatEur(row.gross)}</TableCell>
                        <TableCell>{formatEur(row.commission)}</TableCell>
                      </TableRow>
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

// ─── JournalEntryCard ──────────────────────────────────────────────────────────────────────────
// One card per encaissement. Header shows the date, kind (acompte / solde), client, encaissement TTC,
// and the platform info if non-direct. The body is a balanced mini-journal coloured by line type.

const KIND_LABELS = { deposit: 'Acompte', balance: 'Solde', complement: 'Complément' };

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
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1.5}>
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={`${String(entry.day).padStart(2, '0')}/${String(entry.month).padStart(2, '0')}/${entry.year}`}
          />
          <Chip size="small" label={KIND_LABELS[entry.kind] || entry.kind} />
          <Stack direction="row" alignItems="center" spacing={0.75}>
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
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Stack alignItems="flex-end">
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <EuroIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {formatEur(entry.encaissementTtc)}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {Math.round((entry.fraction || 0) * 100)} % du séjour ({formatEur(entry.finalPrice)})
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
          <Stack direction="row" spacing={3} flexWrap="wrap" alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Prix payé client : <strong>{formatEur(entry.platform.gross)}</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Commission plateforme : <strong>{formatEur(entry.platform.commission)}</strong>
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
                  {line.debit != null ? formatEur(line.debit) : '—'}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: line.credit != null ? 700 : 400 }}>
                  {line.credit != null ? formatEur(line.credit) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Σ</TableCell>
            <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{formatEur(entry.sumDebits)}</TableCell>
            <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{formatEur(entry.sumCredits)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}
