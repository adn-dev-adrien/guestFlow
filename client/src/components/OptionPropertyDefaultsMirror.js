/**
 * OptionPropertyDefaultsMirror — read-only mirror of `property_option_defaults` for the option
 * being edited (specs/weekly-bed-linen-tracking.md §3.7).
 *
 * Pure renderer: hits `GET /api/options/:id/property-defaults` once on mount + when the option id
 * changes. Displays the list of properties that have this option as a default + the offered flag.
 * No write affordance — defaults are edited from the per-property grid on the Options page
 * (OptionDefaultsSection); this is just the read-only mirror beside it.
 *
 * Hidden entirely when the option has neither linen flag set (no point in showing a mirror for
 * a non-linen option) and when the option is brand-new (no id yet → nothing to fetch).
 *
 * Props:
 *   optionId — number; required for the fetch.
 *   form     — the form state (used only to read countsAsBedLinen / countsAsBathroomLinen).
 */
import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Stack, Chip, CircularProgress, FormHelperText, Table, TableBody,
  TableCell, TableHead, TableRow,
} from '@mui/material';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import api from '../api';

export default function OptionPropertyDefaultsMirror({ optionId, form }) {
  const isLinen = Boolean(
    form && (Boolean(form.countsAsBedLinen) || Boolean(form.countsAsBathroomLinen))
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!optionId || !isLinen) {
      setRows([]);
      return undefined;
    }
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const data = await api.getOptionPropertyDefaults(optionId);
        if (mounted) setRows(Array.isArray(data) ? data : []);
      } catch (_) {
        // Soft-fail: an empty list is the safest fallback. The canonical edit lives on the
        // property page, so the user has no immediate action loss.
        if (mounted) setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [optionId, isLinen]);

  // Don't render anything for non-linen options.
  if (!isLinen || !optionId) return null;

  return (
    <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <HomeWorkIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Logements par défaut
        </Typography>
      </Box>
      <FormHelperText sx={{ mb: 1, mt: 0 }}>
        Liste des logements qui ajoutent cette option par défaut sur leurs nouvelles
        réservations. Modifiable depuis la fiche de chaque logement.
      </FormHelperText>

      {loading && (
        <Stack direction="row" spacing={1} sx={{ py: 1, alignItems: 'center' }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">Chargement…</Typography>
        </Stack>
      )}

      {!loading && rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Aucun logement n'utilise cette option par défaut pour le moment.
        </Typography>
      )}

      {!loading && rows.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Logement</TableCell>
              <TableCell align="center">Offert</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.propertyId}>
                <TableCell>{row.propertyName}</TableCell>
                <TableCell align="center">
                  {row.offered
                    ? <Chip size="small" color="success" label="Oui" />
                    : <Chip size="small" variant="outlined" label="Non" />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}
