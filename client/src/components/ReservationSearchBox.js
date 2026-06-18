/**
 * ReservationSearchBox — generic "jump to a reservation" search
 * (specs/reservation-number-and-search.md §6).
 *
 * An async, debounced MUI Autocomplete that queries `GET /reservations/search?q=` as the operator
 * types (matching by number / name / first name / "last first" — all server-side) and calls
 * `onSelect(reservationId)` when a result is picked. Purely presentational: the server does the
 * matching, shaping and capping; this component renders the dropdown and reports the selection.
 * Reusable anywhere a reservation lookup is needed (mounted on Calendrier + Dashboard).
 *
 * Props:
 *   onSelect:    (reservationId: number) => void   — required; fired when a result is chosen
 *   placeholder: string                            — optional input placeholder
 *   sx:          object                            — optional wrapper sx (e.g. maxWidth)
 *   autoFocus:   boolean                           — optional
 */

import React, { useEffect, useRef, useState } from 'react';
import { Autocomplete, TextField, InputAdornment, CircularProgress, Box, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import api from '../api';

const DEBOUNCE_MS = 250;

function formatStayRange(startIso, endIso) {
  const fmt = (iso, opts) => {
    if (!iso) return '';
    try { return new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', opts); }
    catch { return ''; }
  };
  if (!startIso || !endIso) return fmt(startIso || endIso, { day: '2-digit', month: 'short', year: 'numeric' });
  const sameMonth = String(startIso).slice(0, 7) === String(endIso).slice(0, 7);
  const start = sameMonth ? fmt(startIso, { day: '2-digit' }) : fmt(startIso, { day: '2-digit', month: 'short', year: 'numeric' });
  const end = fmt(endIso, { day: '2-digit', month: 'short', year: 'numeric' });
  return `${start} → ${end}`;
}

export default function ReservationSearchBox({ onSelect, placeholder = 'Rechercher une réservation (n°, nom, prénom)…', sx, autoFocus = false }) {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const term = inputValue.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!term) { setOptions([]); setLoading(false); return undefined; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = (reqIdRef.current += 1);
      try {
        const rows = await api.searchReservations(term);
        // Ignore stale responses (a newer keystroke already fired).
        if (reqId === reqIdRef.current) setOptions(Array.isArray(rows) ? rows : []);
      } catch {
        if (reqId === reqIdRef.current) setOptions([]);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputValue]);

  return (
    <Autocomplete
      size="small"
      sx={sx}
      options={options}
      loading={loading}
      // Server already filtered — never re-filter client-side.
      filterOptions={(x) => x}
      inputValue={inputValue}
      onInputChange={(_e, v, reason) => { if (reason !== 'reset') setInputValue(v); }}
      // The box is an action launcher, not a value holder: clear after a pick.
      value={null}
      onChange={(_e, option) => {
        if (option && option.id != null && typeof onSelect === 'function') {
          onSelect(option.id);
          setInputValue('');
          setOptions([]);
        }
      }}
      getOptionLabel={(o) => (o && (o.reservationNumber || o.clientFullName)) || ''}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      noOptionsText={inputValue.trim() ? 'Aucune réservation' : 'Tapez un numéro ou un nom…'}
      loadingText="Recherche…"
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option.id} sx={{ display: 'block !important', py: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {option.reservationNumber ? `${option.reservationNumber} · ` : ''}{option.clientFullName || '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {[option.propertyName, formatStayRange(option.startDate, option.endDate)].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="Rechercher une réservation"
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment>
            ),
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
