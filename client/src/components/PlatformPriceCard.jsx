/**
 * PlatformPriceCard — « Prix plateformes » grid on the property tarif page
 * (specs/platform-price-from-commission.md, widened by specs/tariff-recipes/spec.md §3.6 rules 31-34).
 *
 * One row per sales channel — the Direct row first (its displayed price covers the welcome pack after
 * the booking-engine fee), then the commissioned platforms — with, per tariff season, the whole-euro
 * price to configure on that channel, plus a « Personne supp. » column and, when a channel bills one, a
 * « Ménage / séjour » column (specs/tariff-recipe-platform-cleaning-fee.md). The commission % is shown
 * read-only: it is global per channel and edited on Paramètres → Plateformes
 * (specs/settings-rationalization.md rule 19). All gross math is server-side; this only renders.
 *
 * Props:
 *   propertyId  — number, required.
 *   refreshKey  — any. Change it (e.g. after editing a season's price) to re-fetch the grid.
 *   onError     — optional (err) => void.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Card, CardContent, Box, Typography, TableHead, TableBody, TableRow, TableCell, Link, Tooltip,
} from '@mui/material';
import StorefrontIcon from '@mui/icons-material/Storefront';
import api from '../api';
import TableCard from './TableCard';
import LoadingState from './LoadingState';
import EmptyState from './EmptyState';
import { formatCurrency, formatCurrencyRounded, formatPercent } from '../utils/formatters';
import { formatPlatformLabel } from '../constants/platforms';

// Whole-euro display (the server already ceils): 1075 → « 1 075 € », never « 1 075,00 € ».
const euro = (value) => (value == null ? '—' : formatCurrencyRounded(value));
// A money cell never breaks between the figure and « € » (2026-10-27 audit: « 1075 / € »).
const NOWRAP = { whiteSpace: 'nowrap' };
// The channel column stays in view while the seasons scroll sideways (a recipe with six seasons
// does not fit beside the drawer once the amounts stop wrapping).
const STICKY_FIRST = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  bgcolor: 'background.paper',
};

export default function PlatformPriceCard({ propertyId, refreshKey, onError }) {
  const [data, setData] = useState({ platforms: [], seasons: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPlatformPrices(propertyId);
      setData(res || { platforms: [], seasons: [] });
    } catch (err) {
      if (onError) onError(err); else console.error('[PlatformPriceCard]', err);
    } finally {
      setLoading(false);
    }
  }, [propertyId, onError]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // « Voir la grille » on a reservation fiche links to #prix-plateformes: scroll once the table has its height.
  const scrolledToHashRef = useRef(false);
  useEffect(() => {
    if (loading || scrolledToHashRef.current || window.location.hash !== '#prix-plateformes') return;
    scrolledToHashRef.current = true;
    document.getElementById('prix-plateformes')?.scrollIntoView({ block: 'start' });
  }, [loading]);

  const { platforms, seasons } = data;
  const hasCommissioned = platforms.some((p) => !p.isDirect);
  // specs/tariff-recipe-platform-cleaning-fee.md rule 10 — the column exists only when a channel bills one.
  const hasCleaningFee = platforms.some((p) => p.cleaningFee != null);
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
      .map((tiers) => tiers.map((t, i) => (i === 0 ? euro(t.price) : `puis ${euro(t.price)}`)).join(' ')))];
    if (tiered.length) return tiered.join(' / ');
    const values = [...new Set(seasons.map((s) => s.extraGuestByPlatform?.[platformId]).filter((v) => v != null))];
    if (values.length === 0) return '—';
    return values.map((v) => euro(v)).join(' / ');
  };

  return (
    <Card id="prix-plateformes" variant="outlined" sx={{ mt: 3, scrollMarginTop: { xs: 72, sm: 88 } }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <StorefrontIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="sectionHeader">Prix plateformes</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Prix /nuit à afficher sur chaque canal (arrondi à l'euro supérieur) pour <strong>netter</strong> la
          cible après commission. Le taux de commission est commun à tous les logements : il se règle
          dans <Link component={RouterLink} to="/settings/plateformes">Plateformes</Link>.
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
          <TableCard minWidth={480} cardSx={{ '& .MuiTableCell-root': { px: 1 }, '& .MuiTableCell-root:first-of-type': { pl: 2 } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={STICKY_FIRST}>Canal</TableCell>
                  <TableCell align="right">Commission</TableCell>
                  {seasons.map((s) => (
                    <TableCell key={s.ruleId} align="right">
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.label}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ ...NOWRAP, display: 'block' }}>
                        net {formatCurrency(s.netPerNight)}
                      </Typography>
                    </TableCell>
                  ))}
                  <TableCell align="right">{extraUnitLabel}</TableCell>
                  {hasCleaningFee && <TableCell align="right">Ménage / séjour</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {platforms.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell sx={STICKY_FIRST}>
                      <Typography variant="body2" sx={{ fontWeight: p.isDirect ? 700 : 500 }}>{formatPlatformLabel(p.name)}</Typography>
                      {p.isDirect && p.directVia?.length > 0 && (
                        <Typography variant="caption" color="text.secondary">{p.directVia.join(', ')}</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={NOWRAP} aria-label={`Commission ${formatPlatformLabel(p.name)}`}>{formatPercent(p.commissionPercent ?? 0)}</Typography>
                    </TableCell>
                    {seasons.map((s) => (
                      <TableCell key={s.ruleId} align="right" sx={{ fontWeight: 600, ...NOWRAP }}>
                        {euro(s.byPlatform?.[p.id])}
                      </TableCell>
                    ))}
                    <TableCell align="right" sx={NOWRAP}>{extraGuestCell(p.id)}</TableCell>
                    {hasCleaningFee && (
                      <TableCell align="right">
                        {p.cleaningFee == null ? '—' : (
                          <Tooltip
                            enterTouchDelay={0}
                            title={`Ménage ${formatCurrency(p.cleaningFeeDetail.cleaningNet)} + corvées ${formatCurrency(p.cleaningFeeDetail.choresNet)} = ${formatCurrency(p.cleaningFeeDetail.net)} net`}
                          >
                            <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', whiteSpace: 'nowrap' }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>{euro(p.cleaningFee)}</Typography>
                              <Typography variant="caption" color="text.secondary">net {formatCurrency(p.cleaningFeeDetail.net)}</Typography>
                            </Box>
                          </Tooltip>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
          </TableCard>
        )}
      </CardContent>
    </Card>
  );
}
