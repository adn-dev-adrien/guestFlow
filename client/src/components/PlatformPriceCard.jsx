/**
 * PlatformPriceCard — « Prix plateformes » grid on the property tarif page
 * (specs/platform-price-from-commission.md, widened by specs/tariff-recipes/spec.md §3.6 rules 31-34).
 *
 * One row per sales channel — the Direct row first (its displayed price covers the welcome pack after
 * the booking-engine fee), then the commissioned platforms — with, per tariff season, the whole-euro
 * price to configure on that channel, plus a « Personne supp. » column. The commission % is editable
 * per channel (global, persisted). All gross math is server-side; this component only renders + PUTs
 * the %.
 *
 * Props:
 *   propertyId  — number, required.
 *   refreshKey  — any. Change it (e.g. after editing a season's price) to re-fetch the grid.
 *   onError     — optional (err) => void.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card, CardContent, Box, Typography, TableHead, TableBody, TableRow, TableCell,
  TextField, InputAdornment,
} from '@mui/material';
import StorefrontIcon from '@mui/icons-material/Storefront';
import api from '../api';
import TableCard from './TableCard';
import LoadingState from './LoadingState';
import EmptyState from './EmptyState';
import { formatCurrency } from '../utils/formatters';

// Whole-euro display (the server already ceils): 190 → « 190 € », never « 190,00 € ».
const euro = (value) => (value == null ? '—' : `${value} €`);

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
  const hasCommissioned = platforms.some((p) => !p.isDirect);
  const extraUnitLabel = seasons[0]?.extraGuestPriceUnit === 'per_night' ? 'Personne supp. / nuit' : 'Personne supp. / séjour';

  // The extra-guest price is per channel; when the seasons disagree (distinct per-season net
  // targets), every distinct value is shown — purely presentational, the values come computed.
  const extraGuestCell = (platformId) => {
    // A tiered supplement (« 17 € puis 9 € ») wins over the single price: showing one number no
    // night actually costs would be worse than showing none
    // (specs/tariff-events-and-extra-guest-tiers §3.1 rule 6).
    const tiered = [...new Set(seasons
      .map((s) => s.extraGuestTiersByPlatform?.[platformId])
      .filter(Boolean)
      .map((tiers) => tiers.map((t, i) => (i === 0 ? `${t.price} €` : `puis ${t.price} €`)).join(' ')))];
    if (tiered.length) return tiered.join(' / ');
    const values = [...new Set(seasons.map((s) => s.extraGuestByPlatform?.[platformId]).filter((v) => v != null))];
    if (values.length === 0) return '—';
    return values.map((v) => `${v} €`).join(' / ');
  };

  return (
    <Card variant="outlined" sx={{ mt: 3 }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <StorefrontIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="sectionHeader">Prix plateformes</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Prix /nuit à afficher sur chaque canal (arrondi à l'euro supérieur) pour <strong>netter</strong> la
          cible après commission. Le taux de commission est commun à tous les logements.
        </Typography>

        {loading && <LoadingState py={2} label="Chargement…" />}

        {!loading && !hasCommissioned && (
          <EmptyState
            py={3}
            message="Aucune plateforme — configurez un import iCal sur un logement pour qu'elle apparaisse ici."
          />
        )}

        {!loading && hasCommissioned && seasons.length === 0 && (
          <EmptyState
            py={3}
            message="Aucune saison tarifaire — ajoutez un tarif pour voir les prix plateformes."
          />
        )}

        {!loading && hasCommissioned && seasons.length > 0 && (
          <TableCard minWidth={480}>
              <TableHead>
                <TableRow>
                  <TableCell>Canal</TableCell>
                  <TableCell align="right" sx={{ width: 120 }}>Commission</TableCell>
                  {seasons.map((s) => (
                    <TableCell key={s.ruleId} align="right">
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        net {formatCurrency(s.netPerNight)}
                      </Typography>
                    </TableCell>
                  ))}
                  <TableCell align="right">{extraUnitLabel}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {platforms.map((p) => (
                  <TableRow
                    key={p.id}
                    sx={p.isDirect ? { '& td': { borderBottomWidth: 2, borderBottomColor: 'divider' } } : undefined}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: p.isDirect ? 700 : 500 }}>{p.name}</Typography>
                      {p.isDirect && (
                        <Typography variant="caption" color="text.secondary">moteur Lodgify</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        value={pctDraft[p.id] ?? ''}
                        onChange={(e) => onPctChange(p.id, e.target.value)}
                        size="small"
                        type="number"
                        disabled={typeof p.id !== 'number'}
                        slotProps={{
                          input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                          htmlInput: { min: 0, max: 99.99, step: 0.5, 'aria-label': `Commission ${p.name}` },
                        }}
                        sx={{ width: 100 }}
                      />
                    </TableCell>
                    {seasons.map((s) => (
                      <TableCell key={s.ruleId} align="right" sx={{ fontWeight: 600 }}>
                        {euro(s.byPlatform?.[p.id])}
                      </TableCell>
                    ))}
                    <TableCell align="right">{extraGuestCell(p.id)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
          </TableCard>
        )}
      </CardContent>
    </Card>
  );
}
