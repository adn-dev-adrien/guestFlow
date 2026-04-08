import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, TextField, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Alert, Grid
} from '@mui/material';
import PageHeader from '../components/PageHeader';
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

function getMaxPastMonth() {
  return getPreviousMonth();
}

function formatDateFr(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function formatReservationDates(startDate, endDateExclusive) {
  const start = formatDateFr(startDate);
  if (!endDateExclusive) return start;
  const endDate = new Date(`${endDateExclusive}T00:00:00`);
  endDate.setDate(endDate.getDate() - 1);
  const y = endDate.getFullYear();
  const m = String(endDate.getMonth() + 1).padStart(2, '0');
  const d = String(endDate.getDate()).padStart(2, '0');
  return `${start} au ${formatDateFr(`${y}-${m}-${d}`)}`;
}

export default function TouristTaxPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(getPreviousMonth);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const maxPastMonth = useMemo(() => getMaxPastMonth(), []);
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

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' } }}>
          <TextField
            label="Mois à extraire"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ max: maxPastMonth }}
            helperText="Uniquement les mois déjà passés"
          />
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {data && (
        <>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={4}>
              <Card sx={{ bgcolor: 'primary.main', color: 'white' }}>
                <CardContent>
                  <Typography variant="subtitle2">Réservations directes (mois)</Typography>
                  <Typography variant="h4">{data.totals.reservationsCount || 0}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card sx={{ bgcolor: '#00897b', color: 'white' }}>
                <CardContent>
                  <Typography variant="subtitle2">Adultes-nuits (mois)</Typography>
                  <Typography variant="h4">{data.totals.adultNights}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
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
                          <TableCell sx={{ fontWeight: 600 }}>Nom réservation</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Dates réservation</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Nuits</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Adultes</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Taxe séjour (client)</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} align="right">Montant séjour (hébergement)</TableCell>
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
                            <TableCell>{row.reservationName || 'Réservation'}</TableCell>
                            <TableCell>{formatReservationDates(row.startDate, row.endDate)}</TableCell>
                            <TableCell align="right">{row.nightsCount}</TableCell>
                            <TableCell align="right">{row.adults}</TableCell>
                            <TableCell align="right">{Number(row.taxAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</TableCell>
                            <TableCell align="right">{Number(row.accommodationAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</TableCell>
                          </TableRow>
                        ))}
                        {property.reservations.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} align="center">Aucune réservation directe sur ce logement pour le mois sélectionné</TableCell>
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
