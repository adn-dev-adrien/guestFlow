import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Alert, Grid, Checkbox, Tooltip
} from '@mui/material';
import PageHeader from '../components/PageHeader';
import MonthYearPicker from '../components/MonthYearPicker';
import api from '../api';
import { withFrom } from '../utils/navigation';

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

function formatDateFr(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

// « Dates réservation » = the reservation's stay dates (arrival → departure), exactly like the fiche
// réservation. specs/tourist-tax-declared-checkbox.md §3 rule 1 — no day is subtracted (a 1-night stay
// 20/06 → 21/06 shows « 20/06 au 21/06 »).
function formatReservationDates(startDate, endDate) {
  const start = formatDateFr(startDate);
  if (!endDate) return start;
  return `${start} au ${formatDateFr(endDate)}`;
}

// The declared marker is stored as a SQLite datetime string ("YYYY-MM-DD HH:MM:SS"); show the date only.
function formatDeclaredDate(declaredAt) {
  const m = String(declaredAt || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export default function TouristTaxPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(getPreviousMonth);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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

  // specs/tourist-tax-declared-checkbox.md §3 — tick / untick « Déclarée » for one reservation. Optimistic:
  // reflect the toggle immediately, then reconcile with the server-authoritative declaredAt; revert on error.
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
      setError(e.message || "Impossible de mettre à jour la déclaration");
    }
  };

  useEffect(() => {
    let isMounted = true;
    setError('');
    api.getTouristTaxExtraction(month)
      .then((res) => {
        if (isMounted) setData(res);
      })
      .catch((e) => {
        if (!isMounted) return;
        setData(null);
        setError(e.message || "Impossible de charger l'extraction");
      });

    return () => {
      isMounted = false;
    };
  }, [month]);

  return (
    <Box>
      <PageHeader title="Extraction taxe de séjour" />
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
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
      {data && (
        <>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid
              size={{
                xs: 12,
                md: 4
              }}>
              <Card sx={{ bgcolor: 'primary.main', color: 'white' }}>
                <CardContent>
                  <Typography variant="subtitle2">Réservations directes (mois)</Typography>
                  <Typography variant="h4">{data.totals.reservationsCount || 0}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid
              size={{
                xs: 12,
                md: 4
              }}>
              <Card sx={{ bgcolor: '#00897b', color: 'white' }}>
                <CardContent>
                  <Typography variant="subtitle2">Adultes-nuits (mois)</Typography>
                  <Typography variant="h4">{data.totals.adultNights}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid
              size={{
                xs: 12,
                md: 4
              }}>
              <Card sx={{ bgcolor: '#ef6c00', color: 'white' }}>
                <CardContent>
                  <Typography variant="subtitle2">Taxe de séjour totale</Typography>
                  <Typography variant="h4">{Number(data.totals.taxAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Par logement</Typography>
              {groupedByProperty.map((property) => (
                <Box key={property.propertyId} sx={{ mb: 2.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{property.propertyName}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Taxe logement: {Number(property.taxAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                    </Typography>
                  </Box>
                  <TableContainer>
                    <Table size="small" sx={{ minWidth: 980 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }} align="center" padding="checkbox">Déclarée</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Nom réservation</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Dates réservation</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Nuits</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Adultes</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Enfants</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Taxe séjour (client)</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Montant hébergement HT</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {property.reservations.map((row) => (
                          <TableRow
                            key={row.reservationId}
                            hover
                            onClick={() => navigate(withFrom(`/reservations/${row.reservationId}`, '/finance/tourist-tax'))}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell
                              padding="checkbox"
                              align="center"
                              onClick={(e) => e.stopPropagation()}
                              sx={{ cursor: 'default' }}
                            >
                              <Tooltip title={row.touristTaxDeclaredAt
                                ? (formatDeclaredDate(row.touristTaxDeclaredAt) ? `Déclarée le ${formatDeclaredDate(row.touristTaxDeclaredAt)}` : 'Déclarée')
                                : 'Non déclarée'}>
                                <Checkbox
                                  size="small"
                                  checked={!!row.touristTaxDeclaredAt}
                                  onChange={() => handleToggleDeclared(row)}
                                  slotProps={{ input: { 'aria-label': `Déclarée — ${row.reservationName || 'Réservation'}` } }}
                                />
                              </Tooltip>
                            </TableCell>
                            <TableCell>{row.reservationName || 'Réservation'}</TableCell>
                            <TableCell>{formatReservationDates(row.startDate, row.endDate)}</TableCell>
                            <TableCell align="right">{row.nightsCount}</TableCell>
                            <TableCell align="right">{row.adults}</TableCell>
                            <TableCell align="right">{row.children ?? 0}</TableCell>
                            <TableCell align="right">{Number(row.taxAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</TableCell>
                            <TableCell align="right">{Number(row.accommodationAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</TableCell>
                          </TableRow>
                        ))}
                        {property.reservations.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={8} align="center">Aucune réservation directe sur ce logement pour le mois sélectionné</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ))}

              {groupedByProperty.length === 0 && (
                <Typography color="text.secondary">Aucune réservation directe sur le mois sélectionné.</Typography>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
}
