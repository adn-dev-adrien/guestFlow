/**
 * PlatformPriceCard — « Prix plateformes » grid on the property tarif page
 * (specs/platform-price-from-commission.md).
 *
 * For each non-direct platform (aggregated from the properties' iCal imports) and each tariff season,
 * shows the gross price /night to list on the platform so that, after the platform's commission %,
 * the owner nets the season price. The commission % is editable per platform (global, persisted) in
 * the column header. All gross math is server-side; this component only renders + PUTs the %.
 *
 * Props:
 *   propertyId  — number, required.
 *   refreshKey  — any. Change it (e.g. after editing a season's price) to re-fetch the grid.
 *   onError     — optional (err) => void.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card, CardContent, Box, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  TextField, InputAdornment, CircularProgress,
} from '@mui/material';
import StorefrontIcon from '@mui/icons-material/Storefront';
import api from '../api';

function euro(n) {
  if (n == null) return '—';
  return `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
}

export default function PlatformPriceCard({ propertyId, refreshKey, onError }) {
  const [data, setData] = useState({ platforms: [], seasons: [] });
  const [loading, setLoading] = useState(true);
  // Local draft of the % inputs (so typing is smooth); keyed by platformId.
  const [pctDraft, setPctDraft] = useState({});
  const debounceRef = useRef({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPlatformPrices(propertyId);
      setData(res || { platforms: [], seasons: [] });
      setPctDraft(Object.fromEntries((res?.platforms || []).map((p) => [p.id, String(p.commissionPercent ?? 0)])));
    } catch (err) {
      if (onError) onError(err); else console.error('[PlatformPriceCard]', err);
    } finally {
      setLoading(false);
    }
  }, [propertyId, onError]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const onPctChange = (platformId, raw) => {
    setPctDraft((d) => ({ ...d, [platformId]: raw }));
    clearTimeout(debounceRef.current[platformId]);
    debounceRef.current[platformId] = setTimeout(async () => {
      const value = Math.max(0, Math.min(99.99, Number(raw) || 0));
      try {
        await api.setPlatformCommission(platformId, value);
        await load();
      } catch (err) {
        if (onError) onError(err); else console.error('[PlatformPriceCard]', err);
      }
    }, 600);
  };

  const { platforms, seasons } = data;

  return (
    <Card variant="outlined" sx={{ mt: 3 }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <StorefrontIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="h6">Prix plateformes</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Prix /nuit à afficher sur chaque plateforme pour <strong>nets</strong> les tarifs ci-dessous
          après commission. Le taux de commission est commun à tous les logements.
        </Typography>

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Chargement…</Typography>
          </Box>
        )}

        {!loading && platforms.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Aucune plateforme — configurez un import iCal sur un logement pour qu'elle apparaisse ici.
          </Typography>
        )}

        {!loading && platforms.length > 0 && seasons.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Aucune saison tarifaire — ajoutez un tarif pour voir les prix plateformes.
          </Typography>
        )}

        {!loading && platforms.length > 0 && seasons.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 360 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Saison</TableCell>
                  <TableCell align="right">Net /nuit</TableCell>
                  {platforms.map((p) => (
                    <TableCell key={p.id} align="right" sx={{ minWidth: 130 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{p.name}</Typography>
                      <TextField
                        value={pctDraft[p.id] ?? ''}
                        onChange={(e) => onPctChange(p.id, e.target.value)}
                        size="small"
                        type="number"
                        label="Commission"
                        slotProps={{
                          input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                          htmlInput: { min: 0, max: 99.99, step: 0.5, 'aria-label': `Commission ${p.name}` },
                        }}
                        sx={{ mt: 0.5, width: 110 }}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {seasons.map((s) => (
                  <TableRow key={s.ruleId}>
                    <TableCell>{s.label}</TableCell>
                    <TableCell align="right">{euro(s.netPerNight)}</TableCell>
                    {platforms.map((p) => (
                      <TableCell key={p.id} align="right" sx={{ fontWeight: 600 }}>
                        {euro(s.byPlatform?.[p.id])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
