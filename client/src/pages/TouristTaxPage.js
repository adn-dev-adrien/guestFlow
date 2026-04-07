import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Alert, Grid
} from '@mui/material';
import PageHeader from '../components/PageHeader';
import api from '../api';

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

export default function TouristTaxPage() {
  const [month, setMonth] = useState(getPreviousMonth);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const maxPastMonth = useMemo(() => getMaxPastMonth(), []);

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
                  <Typography variant="subtitle2">Nuits louées (mois)</Typography>
                  <Typography variant="h4">{data.totals.rentedNights}</Typography>
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
                  <Typography variant="subtitle2">Taxe totale à reverser</Typography>
                  <Typography variant="h4">{data.totals.taxAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Par logement</Typography>
              <TableContainer>
                <Table size="small" sx={{ minWidth: 860 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Nuits louées</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Adultes-nuits</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Taxe (€/adulte/nuit)</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Montant taxe séjour</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byProperty.map((row) => (
                      <TableRow key={row.propertyId}>
                        <TableCell>{row.propertyName}</TableCell>
                        <TableCell align="right">{row.rentedNights}</TableCell>
                        <TableCell align="right">{row.adultNights}</TableCell>
                        <TableCell align="right">{row.taxRate.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</TableCell>
                        <TableCell align="right">{row.taxAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</TableCell>
                      </TableRow>
                    ))}
                    {data.byProperty.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center">Aucune nuit louée sur le mois sélectionné</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
}
