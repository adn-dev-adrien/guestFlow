import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Box, Typography, Card, CardContent, Grid, Stack, Checkbox, Tooltip,
  TableRow, TableCell,
} from '@mui/material';
import PageActionBar from '../components/PageActionBar';
import MonthYearPicker from '../components/MonthYearPicker';
import ResponsiveTable from '../components/ResponsiveTable';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import { useToast } from '../components/DialogProvider';
import api from '../api';
import { withFrom } from '../utils/navigation';
import { displayDate, formatCurrency, formatCurrencyRounded } from '../utils/formatters';

const TABULAR = { fontVariantNumeric: 'tabular-nums' };

function pad2(v) {
  return String(v).padStart(2, '0');
}

function getPreviousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// The current month is selectable too (the extraction shows the tax already to-collect this month).
function getMaxSelectableMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// « Dates réservation » = the reservation's stay dates (arrival → departure), like the fiche.
function formatReservationDates(startDate, endDate) {
  const start = displayDate(startDate);
  if (!endDate) return start;
  return `${start} au ${displayDate(endDate)}`;
}

// The declared marker is a SQLite datetime ("YYYY-MM-DD HH:MM:SS"); show the date only via the shared
// formatter (slice off the time first).
function formatDeclaredDate(declaredAt) {
  if (!declaredAt || declaredAt === '__pending__') return '';
  return displayDate(String(declaredAt).slice(0, 10));
}

// specs/reservation-refunds.md §3.5 — les chiffres de la ligne sont NETS des nuits dont la taxe a été
// rendue au client. La mention dit ce qui a été retiré, sinon l'écart avec la fiche est inexplicable.
function refundedTaxCaption(row) {
  const nights = Number(row.refundedTaxNights || 0);
  const amount = Number(row.refundedTaxAmount || 0);
  if (nights <= 0 && amount <= 0) return '';
  const nightsPart = nights > 0 ? `${nights} nuit${nights > 1 ? 's' : ''} remboursée${nights > 1 ? 's' : ''}` : 'taxe remboursée';
  return `dont ${nightsPart} (− ${formatCurrency(amount)})`;
}

export default function TouristTaxPage() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const [month, setMonth] = useState(getPreviousMonth);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const maxSelectableMonth = useMemo(() => getMaxSelectableMonth(), []);
  const groupedByProperty = useMemo(() => {
    const properties = data?.byProperty || [];
    const rows = data?.reservations || [];
    const rowsByPropertyId = new Map();
    rows.forEach((row) => {
      const key = Number(row.propertyId);
      if (!rowsByPropertyId.has(key)) rowsByPropertyId.set(key, []);
      rowsByPropertyId.get(key).push(row);
    });
    return properties.map((property) => ({
      ...property,
      reservations: rowsByPropertyId.get(Number(property.propertyId)) || [],
    }));
  }, [data]);

  // specs/tourist-tax-declared-checkbox.md §3 — optimistic « Déclarée » toggle; revert + toast on error.
  const patchDeclared = (reservationId, value) =>
    setData((prev) => (prev ? {
      ...prev,
      reservations: prev.reservations.map((r) =>
        r.reservationId === reservationId ? { ...r, touristTaxDeclaredAt: value } : r),
    } : prev));

  const handleToggleDeclared = async (row) => {
    const declared = !row.touristTaxDeclaredAt;
    patchDeclared(row.reservationId, declared ? '__pending__' : null);
    try {
      const res = await api.setTouristTaxDeclared(row.reservationId, declared);
      patchDeclared(row.reservationId, res.declaredAt);
    } catch (e) {
      patchDeclared(row.reservationId, row.touristTaxDeclaredAt);
      showError(e.message || 'Impossible de mettre à jour la déclaration.');
    }
  };

  useEffect(() => {
    let isMounted = true;
    setLoadError(false);
    setData(null);
    api.getTouristTaxExtraction(month)
      .then((res) => { if (isMounted) setData(res); })
      .catch(() => { if (isMounted) { setData(null); setLoadError(true); } });
    return () => { isMounted = false; };
  }, [month, reloadNonce]);

  const declaredTooltip = (row) => (row.touristTaxDeclaredAt
    ? (formatDeclaredDate(row.touristTaxDeclaredAt) ? `Déclarée le ${formatDeclaredDate(row.touristTaxDeclaredAt)}` : 'Déclarée')
    : 'Non déclarée');

  const declaredCheckbox = (row) => (
    <Tooltip title={declaredTooltip(row)}>
      <Checkbox
        size="small"
        checked={!!row.touristTaxDeclaredAt}
        onChange={() => handleToggleDeclared(row)}
        slotProps={{ input: { 'aria-label': `Déclarée — ${row.reservationName || 'Réservation'}` } }}
      />
    </Tooltip>
  );

  // KPI cards — neutral « Maison » tiles (2026-07-16 decision).
  const kpiCards = data ? [
    { label: 'Réservations directes (mois)', value: String(data.totals.reservationsCount || 0), accent: 'info.main' },
    { label: 'Adultes-nuits (mois)', value: String(data.totals.adultNights), accent: 'primary.main' },
    { label: 'Taxe de séjour totale', value: formatCurrencyRounded(data.totals.taxAmount), accent: 'warning.main' },
  ] : [];

  return (
    <Box>
      <PageActionBar title="Extraction taxe de séjour" />
      <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1240, mx: 'auto' }}>
        {(() => {
          const { month: m, year: y } = MonthYearPicker.fromYearMonth(month);
          return (
            <MonthYearPicker
              month={m}
              year={y}
              onChange={({ month: nm, year: ny }) => setMonth(MonthYearPicker.toYearMonth({ month: nm, year: ny }))}
              maxMonth={maxSelectableMonth}
              helperText="Jusqu'au mois en cours inclus."
            />
          );
        })()}
        {loadError && <ErrorAlert message="Impossible de charger l'extraction." onRetry={() => setReloadNonce((n) => n + 1)} sx={{ mb: 3 }} />}
        {!data && !loadError && <LoadingState label="Chargement de l'extraction…" />}
        {data && (
          <>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              {kpiCards.map((c) => (
                <Grid key={c.label} size={{ xs: 12, md: 4 }}>
                  <Card sx={{ height: '100%', borderLeft: '3px solid', borderColor: c.accent }}>
                    <CardContent>
                      <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>{c.label}</Typography>
                      <Typography variant="kpiValue">{c.value}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            <Card>
              <CardContent>
                <Typography variant="sectionHeader" gutterBottom>Par logement</Typography>
                {groupedByProperty.map((property) => (
                  <Box key={property.propertyId} sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                      <Typography variant="sectionHeader">{property.propertyName}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, ...TABULAR }}>
                        Taxe logement : {formatCurrency(property.taxAmount)}
                      </Typography>
                    </Box>
                    <ResponsiveTable
                      items={property.reservations}
                      getKey={(row) => row.reservationId}
                      minWidth={1080}
                      emptyText="Aucune réservation directe sur ce logement pour le mois sélectionné."
                      head={(
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }} align="center" padding="checkbox">Déclarée</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Nom réservation</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Dates réservation</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Nuits</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Adultes</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Enfants</TableCell>
                          {/* specs/tourist-tax-included-services-deduction.md rule 15 — the assiette the
                              commune's percentage form asks for, straight from the fiche's own caption. */}
                          <TableCell sx={{ fontWeight: 600 }} align="right">Nuit HT / occupant</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Taxe séjour (client)</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Montant du séjour HT</TableCell>
                        </TableRow>
                      )}
                      renderRow={(row) => (
                        <TableRow
                          key={row.reservationId}
                          hover
                          onClick={() => navigate(withFrom(`/reservations/${row.reservationId}`, '/finance/tourist-tax'))}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell padding="checkbox" align="center" onClick={(e) => e.stopPropagation()} sx={{ cursor: 'default' }}>
                            {declaredCheckbox(row)}
                          </TableCell>
                          <TableCell>
                            {row.reservationName || 'Réservation'}
                            {refundedTaxCaption(row) && (
                              <Typography variant="caption" sx={{ display: 'block', color: 'warning.main' }}>
                                {`↳ ${refundedTaxCaption(row)}`}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>{formatReservationDates(row.startDate, row.endDate)}</TableCell>
                          <TableCell align="right" sx={TABULAR}>{row.nightsCount}</TableCell>
                          <TableCell align="right" sx={TABULAR}>{row.adults}</TableCell>
                          <TableCell align="right" sx={TABULAR}>{row.children ?? 0}</TableCell>
                          <TableCell align="right" sx={TABULAR}>
                            {row.nightPricePerOccupantHt == null ? '—' : formatCurrency(row.nightPricePerOccupantHt)}
                          </TableCell>
                          <TableCell align="right" sx={TABULAR}>{formatCurrency(row.taxAmount)}</TableCell>
                          <TableCell align="right" sx={TABULAR}>{formatCurrency(row.accommodationAmount)}</TableCell>
                        </TableRow>
                      )}
                      renderMobileCard={(row) => (
                        <Stack onClick={() => navigate(withFrom(`/reservations/${row.reservationId}`, '/finance/tourist-tax'))} sx={{ cursor: 'pointer', gap: 0.5 }}>
                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.reservationName || 'Réservation'}</Typography>
                            <Box onClick={(e) => e.stopPropagation()}>{declaredCheckbox(row)}</Box>
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {formatReservationDates(row.startDate, row.endDate)} · {row.nightsCount} nuit{row.nightsCount > 1 ? 's' : ''} · {row.adults} ad. · {row.children ?? 0} enf.
                          </Typography>
                          {refundedTaxCaption(row) && (
                            <Typography variant="caption" sx={{ color: 'warning.main' }}>
                              {refundedTaxCaption(row)}
                            </Typography>
                          )}
                          {row.nightPricePerOccupantHt != null && (
                            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                              <Typography variant="caption" color="text.secondary">Nuit HT / occupant</Typography>
                              <Typography variant="body2" sx={{ ...TABULAR }}>{formatCurrency(row.nightPricePerOccupantHt)}</Typography>
                            </Stack>
                          )}
                          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="text.secondary">Taxe séjour (client)</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600, ...TABULAR }}>{formatCurrency(row.taxAmount)}</Typography>
                          </Stack>
                          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="text.secondary">Montant du séjour HT</Typography>
                            <Typography variant="body2" sx={{ ...TABULAR }}>{formatCurrency(row.accommodationAmount)}</Typography>
                          </Stack>
                        </Stack>
                      )}
                    />
                  </Box>
                ))}

                {groupedByProperty.length === 0 && (
                  <EmptyState message="Aucune réservation directe sur le mois sélectionné." py={3} />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </Box>
    </Box>
  );
}
