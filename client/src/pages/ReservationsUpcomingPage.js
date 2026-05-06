import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import PageHeader from '../components/PageHeader';
import api from '../api';
import { displayDate } from '../utils/formatters';
import { withFrom } from '../utils/navigation';

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export default function ReservationsUpcomingPage() {
  const navigate = useNavigate();
  const [reservations, setReservations] = useState([]);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const toStr = useMemo(() => addDays(todayStr, 30), [todayStr]);

  useEffect(() => {
    let isMounted = true;
    api.getReservations({ from: todayStr, to: toStr })
      .then((data) => {
        if (!isMounted) return;
        const sorted = [...(data || [])].sort((a, b) => {
          if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
          return (a.checkInTime || '23:59').localeCompare(b.checkInTime || '23:59');
        });
        setReservations(sorted);
      })
      .catch(() => {
        if (!isMounted) return;
        setReservations([]);
      });
    return () => {
      isMounted = false;
    };
  }, [todayStr, toStr]);

  return (
    <Box>
      <PageHeader
        title="Réservations"
        subtitle={`30 prochains jours glissants: du ${displayDate(todayStr)} au ${displayDate(toStr)}`}
      />

      <Card>
        <CardContent>
          {reservations.length === 0 ? (
            <Typography color="text.secondary">Aucune réservation sur les 30 prochains jours.</Typography>
          ) : (
            <TableContainer>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Arrivée</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Départ</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Heures</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reservations.map((r) => (
                    <TableRow
                      key={r.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(withFrom(`/reservations/${r.id}`, '/reservations/upcoming'))}
                    >
                      <TableCell>{displayDate(r.startDate)}</TableCell>
                      <TableCell>{displayDate(r.endDate)}</TableCell>
                      <TableCell>{`${r.checkInTime || '15:00'} -> ${r.checkOutTime || '10:00'}`}</TableCell>
                      <TableCell>{r.propertyName || '—'}</TableCell>
                      <TableCell>{`${r.firstName || ''} ${r.lastName || ''}`.trim() || '—'}</TableCell>
                      <TableCell>{r.platform || 'direct'}</TableCell>
                      <TableCell align="right">{Number(r.finalPrice || 0).toFixed(2)}€</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
