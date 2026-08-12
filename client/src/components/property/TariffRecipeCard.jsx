/**
 * TariffRecipeCard — the property's active tariff recipe on its tarif page
 * (specs/tariff-recipes/spec.md §3.2 rules 7-8, §3.5 rule 29).
 *
 * Shows the active recipe + the applied version, warns when the recipe file has moved on, lets the
 * operator pick a recipe and APPLY it — always through the preview dialog: the server-computed diff
 * (seasons created / updated / removed, ranges added and dropped, closures, warnings) is shown and
 * nothing is written until « Appliquer ». A vanished recipe offers a detach.
 *
 * Props:
 *   propertyId       — number, required.
 *   activeRecipeId   — string ('' = manual).
 *   appliedVersion   — string.
 *   onApplied        — () => void  (reload seasons after an apply / detach).
 *   onError          — optional (message: string) => void.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, CardContent, Box, Typography, Chip, Button, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, AlertTitle, List, ListItem,
  useMediaQuery, useTheme,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import api from '../../api';
import LoadingState from '../LoadingState';

const ACTION_LABELS = {
  create: { label: 'sera créée', color: 'success' },
  update: { label: 'sera modifiée', color: 'info' },
  remove: { label: 'sera supprimée', color: 'error' },
  unchanged: { label: 'inchangée', color: 'default' },
};

const WEEKDAY_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const eur = (v) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
// ISO → « 8 juin 2026 », for the event windows.
const frDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

/**
 * Every particularity of the applied recipe, in plain French — the page where the operator answers
 * « what exactly did I promise on this property? ». Derived from the recipe document plus the
 * property-level inclusions the recipe deliberately does not own (spec §3.1 rule 6), so the two
 * halves of the deal read in one place instead of being spread across three screens.
 */
function recipeHighlights(recipe, rateInclusions, missingEvents) {
  if (!recipe) return [];
  const out = [];
  const seasons = recipe.seasons || [];

  const prices = seasons.map((s) => `${s.label} ${eur(s.pricePerNight)}`).join(' · ');
  if (prices) out.push({ label: 'Saisons', value: prices });

  const nets = seasons.filter((s) => s.netTargetPerNight != null);
  if (nets.length) {
    out.push({
      label: 'Cible nette / nuit',
      value: `${nets.map((s) => `${s.label} ${eur(s.netTargetPerNight)}`).join(' · ')} — les prix affichés par canal en découlent`,
    });
  }

  const table = recipe.lengthOfStayDiscounts || [];
  if (table.length) {
    out.push({
      label: 'Dégressivité',
      value: `${table.map((r) => `${r.nights} nuits −${r.discountPct} %`).join(' · ')}. Au-delà, le prix de la dernière nuit déclarée se prolonge.`,
    });
  }

  const eg = recipe.extraGuest || {};
  const egSeason = seasons.find((s) => s.extraGuestPrice != null);
  const egTiers = eg.perNightTiers || [];
  if (egTiers.length || egSeason || eg.appliesAbove != null) {
    const bits = [];
    // A tier table is its own degressivity, so it replaces both the single price and the mention of
    // the discount curve (specs/tariff-events-and-extra-guest-tiers §3.1 rule 2).
    if (egTiers.length) {
      bits.push(egTiers.map((t, i) => (
        i === egTiers.length - 1
          ? `puis ${eur(t.price)}/nuit`
          : `${eur(t.price)} la ${t.fromNight === 1 ? '1ʳᵉ' : `${t.fromNight}ᵉ`} nuit`
      )).join(', '));
    } else if (egSeason) {
      bits.push(eur(egSeason.extraGuestPrice));
    }
    if (!egTiers.length && eg.unit === 'per_night') bits.push('par nuit et par personne');
    if (eg.appliesAbove != null) bits.push(`au-delà de ${eg.appliesAbove} personnes`);
    out.push({
      label: 'Personne supplémentaire',
      value: `${bits.join(', ')}${!egTiers.length && eg.followsDiscount ? ' — soumise à la même dégressivité que la nuit' : ''}`,
    });
  }

  const minmax = seasons.map((s) => `${s.minNights || 1}${s.maxNights ? `–${s.maxNights}` : ''}`);
  if (minmax.length && new Set(minmax).size === 1) {
    const [only] = minmax;
    const max = seasons[0].maxNights;
    out.push({ label: 'Durée de séjour', value: max ? `de ${seasons[0].minNights || 1} à ${max} nuits` : `minimum ${only} nuit(s)` });
  } else if (minmax.length) {
    out.push({ label: 'Durée de séjour', value: seasons.map((s, i) => `${s.label} ${minmax[i]}`).join(' · ') });
  }

  const changeovers = seasons.filter((s) => s.changeover && (s.changeover.arrival != null || s.changeover.departure != null));
  if (changeovers.length) {
    out.push({
      label: 'Jour de changement',
      value: changeovers.map((s) => {
        const parts = [];
        if (s.changeover.arrival != null) parts.push(`arrivée ${WEEKDAY_FR[s.changeover.arrival]}`);
        if (s.changeover.departure != null) parts.push(`départ ${WEEKDAY_FR[s.changeover.departure]}`);
        return `${s.label} : ${parts.join(', ')}`;
      }).join(' · '),
    });
  }

  const holiday = (recipe.calendar?.modifiers || []).find((m) => m.type === 'public_holiday_bridge');
  if (holiday) {
    const bits = [`week-end férié monté de ${holiday.amount || 1} cran`];
    if (holiday.minNights === 'block') bits.push('minimum de séjour égal à la longueur du pont (2 ou 3 nuits)');
    else if (Number.isInteger(holiday.minNights)) bits.push(`minimum ${holiday.minNights} nuits`);
    out.push({ label: 'Jours fériés', value: bits.join(', ') });
  }

  // Events: the declared years, then the ones still unknown — the « mécanisme pour consulter les
  // dates » (specs/tariff-events-and-extra-guest-tiers §3.3 rules 15-16).
  for (const event of recipe.calendar?.events || []) {
    const years = Object.keys(event.dates || {}).sort();
    const bits = [];
    const season = seasons.find((s) => s.key === event.season);
    if (season) bits.push(season.label.toLowerCase());
    if (event.minNights) bits.push(`${event.minNights} nuit${event.minNights > 1 ? 's' : ''} minimum`);
    const windows = years.map((y) => {
      const w = event.dates[y];
      return `${frDate(w.from)}→${frDate(w.to)}`;
    });
    out.push({
      label: event.label,
      value: `${bits.join(', ')} : ${windows.join(' · ')}`,
      sourceUrl: event.sourceUrl || null,
    });
    const missing = (missingEvents || []).filter((m) => m.key === event.key);
    if (missing.length) {
      out.push({
        label: event.label,
        value: `dates ${missing.map((m) => m.year).join(', ')} pas encore connues — à compléter dès leur publication`,
        warning: true,
        sourceUrl: event.sourceUrl || null,
      });
    }
  }

  for (const closure of recipe.closures || []) {
    const fr = (md) => md.split('-').reverse().join('/');
    out.push({ label: 'Fermeture', value: `${closure.label} : ${fr(closure.from)} → ${fr(closure.to)}, chaque année` });
  }

  out.push({ label: 'Horizon', value: `${recipe.horizonYears || 2} ans, étendu automatiquement` });

  // Property-level inclusions — outside the recipe's scope, but part of the same promise.
  const included = (rateInclusions || []).filter((r) => Number(r.offered) === 1);
  if (included.length) {
    out.push({
      label: 'Compris dans le tarif',
      value: `${included.map((r) => `${r.title} (${eur(r.unitPrice)})`).join(' · ')} — facturés 0, montant barré sur le devis`,
    });
  }
  const freebies = (rateInclusions || []).filter((r) => Number(r.freeUnits) > 0);
  for (const f of freebies) {
    out.push({
      label: 'Offert en direct',
      value: `${f.title} : ${f.freeUnits === 1 ? 'le premier offert' : `les ${f.freeUnits} premiers offerts`} (${eur(f.unitPrice)} l'unité). Au-delà, facturés normalement — réservations directes et Lodgify uniquement.`,
    });
  }

  return out;
}

function frRange(range) {
  const fr = (iso) => iso.split('-').reverse().join('/');
  const extras = [];
  if (range.minNights != null) extras.push(`min ${range.minNights} nuits`);
  return `${fr(range.startDate)} → ${fr(range.endDate)}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

export default function TariffRecipeCard({ propertyId, activeRecipeId, appliedVersion, rateInclusions = [], onApplied, onError }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [recipes, setRecipes] = useState(null);
  const [selectedId, setSelectedId] = useState(activeRecipeId || '');
  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeDocument, setActiveDocument] = useState(null);
  const [missingEvents, setMissingEvents] = useState([]);

  useEffect(() => { setSelectedId(activeRecipeId || ''); }, [activeRecipeId]);

  // The applied recipe's own document — the source for the particularities panel below.
  useEffect(() => {
    let cancelled = false;
    if (!activeRecipeId) { setActiveDocument(null); return undefined; }
    api.getTariffRecipe(activeRecipeId)
      .then((res) => {
        if (cancelled) return;
        setActiveDocument(res?.recipe || null);
        // Server-computed (spec §3.3): the property card and the Dashboard alert must not disagree
        // about which years are missing, so neither of them derives it.
        setMissingEvents(res?.missingEvents || []);
      })
      .catch(() => { if (!cancelled) { setActiveDocument(null); setMissingEvents([]); } });
    return () => { cancelled = true; };
  }, [activeRecipeId]);

  const highlights = useMemo(
    () => recipeHighlights(activeDocument, rateInclusions, missingEvents),
    [activeDocument, rateInclusions, missingEvents]
  );

  const load = useCallback(async () => {
    try {
      const res = await api.getTariffRecipes();
      setRecipes(res?.recipes || []);
    } catch { setRecipes([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const activeRecipe = useMemo(
    () => (recipes || []).find((r) => r.id === activeRecipeId) || null,
    [recipes, activeRecipeId]
  );
  const recipeVanished = Boolean(activeRecipeId) && recipes !== null && !activeRecipe;
  const newerVersion = activeRecipe && appliedVersion && activeRecipe.version !== appliedVersion
    ? activeRecipe.version : null;

  const openPreview = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      setPreview(await api.previewTariffRecipe(propertyId, selectedId));
      setPreviewOpen(true);
    } catch (err) {
      if (onError) onError(err.message || 'Aperçu impossible.');
    } finally { setBusy(false); }
  };

  const applyRecipe = async () => {
    setBusy(true);
    try {
      await api.applyTariffRecipe(propertyId, selectedId);
      setPreviewOpen(false);
      setPreview(null);
      if (onApplied) onApplied();
    } catch (err) {
      if (onError) onError(err.message || "Impossible d'appliquer la recette.");
    } finally { setBusy(false); }
  };

  const detach = async () => {
    setBusy(true);
    try {
      await api.detachTariffRecipe(propertyId);
      if (onApplied) onApplied();
    } catch (err) {
      if (onError) onError(err.message || 'Impossible de détacher la recette.');
    } finally { setBusy(false); }
  };

  const changedSeasons = (preview?.seasons || []).filter((s) => s.action !== 'unchanged');

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <AutoAwesomeIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="sectionHeader">Recette tarifaire</Typography>
          {activeRecipeId && !recipeVanished && (
            <Chip size="small" color="success" variant="outlined" label={`v${appliedVersion || '?'} appliquée`} />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Les saisons sont calculées à partir du calendrier — jours fériés compris. Appliquer une
          recette remplace les saisons qu'elle gère ; les saisons manuelles ne sont jamais touchées.
        </Typography>

        {recipes === null && <LoadingState py={1} label="Chargement…" />}

        {recipeVanished && (
          <Alert
            severity="warning" sx={{ mb: 2 }}
            action={<Button color="inherit" size="small" onClick={detach} disabled={busy}>Détacher</Button>}
          >
            Recette introuvable ({activeRecipeId}) — les saisons restent en l'état, mais le calendrier
            ne sera plus étendu.
          </Alert>
        )}
        {newerVersion && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Version {newerVersion} disponible (v{appliedVersion} appliquée) — relancer « Appliquer »
            pour la prendre en compte.
          </Alert>
        )}

        {/* Every particularity of what is applied on this property, in one readable block. */}
        {highlights.length > 0 && (
          <Box sx={{ mb: 2, p: { xs: 1.5, sm: 2 }, bgcolor: 'action.hover', borderRadius: 1 }}>
            {highlights.map((h, index) => (
              <Box key={index} sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' }, mb: 0.75 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, minWidth: { sm: 168 }, flexShrink: 0 }}>
                  {h.label}
                </Typography>
                <Typography variant="caption" color={h.warning ? 'warning.main' : 'text.secondary'}>
                  {h.value}
                  {h.sourceUrl && (
                    <>
                      {' '}
                      <Typography
                        component="a"
                        variant="caption"
                        href={h.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ color: 'primary.main' }}
                      >
                        (voir le site)
                      </Typography>
                    </>
                  )}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {recipes !== null && (
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' } }}>
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 320 } }}>
              <InputLabel id="tariff-recipe-select-label">Recette</InputLabel>
              <Select
                labelId="tariff-recipe-select-label"
                label="Recette"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <MenuItem value="">Aucune (saisons manuelles)</MenuItem>
                {recipes.map((r) => (
                  <MenuItem key={r.id} value={r.id}>{r.label} — v{r.version}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedId ? (
              <Button variant="contained" onClick={openPreview} disabled={busy} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                Appliquer la recette…
              </Button>
            ) : (activeRecipeId && !recipeVanished && (
              <Button variant="outlined" color="warning" onClick={detach} disabled={busy} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                Détacher la recette
              </Button>
            ))}
          </Box>
        )}
      </CardContent>

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="md" fullWidth fullScreen={fullScreen}>
        <DialogTitle>Aperçu des modifications</DialogTitle>
        <DialogContent dividers>
          {preview && (
            <>
              {preview.horizon && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {preview.recipe.label} — v{preview.recipe.version} · horizon {preview.horizon.fromYear} → {preview.horizon.toYear}
                </Typography>
              )}
              {/* Dates the recipe could NOT write, listed explicitly (spec §3.2 rule 9ter): a
                  warning paragraph is easy to skim past, a dated list is not. */}
              {(preview.conflicts || []).length > 0 && (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                  <AlertTitle sx={{ fontWeight: 700 }}>
                    {preview.conflicts.length} période{preview.conflicts.length > 1 ? 's' : ''} ne peut pas être écrite
                  </AlertTitle>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Ces dates appartiennent à une saison créée à la main que la recette ne gère pas.
                    Renommez-la comme la saison de la recette pour qu'elle soit adoptée, ou supprimez-la.
                  </Typography>
                  {preview.conflicts.map((conflict, index) => (
                    <Box key={index} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                      <Chip size="small" color="error" variant="outlined" label={frRange(conflict)} />
                      <Typography variant="caption" color="text.secondary">
                        {conflict.seasonLabel} — bloquée par « {conflict.blockedByLabel} »
                        {conflict.blockedByRange ? ` (${frRange(conflict.blockedByRange)})` : ''}
                      </Typography>
                    </Box>
                  ))}
                </Alert>
              )}
              {(preview.warnings || [])
                // Each conflict already has its own line above; don't say it twice.
                .filter((w) => !(preview.conflicts || []).length || !w.includes('chevauche la saison manuelle'))
                .map((warning, index) => (
                  <Alert key={index} severity={preview.blocking ? 'error' : 'warning'} sx={{ mb: 1 }}>{warning}</Alert>
                ))}
              {changedSeasons.length === 0 && (preview.closures?.added || []).length === 0 && !preview.blocking && (
                <Alert severity="success">Rien à modifier — les saisons sont déjà conformes à la recette.</Alert>
              )}
              <List dense disablePadding>
                {(preview.seasons || []).filter((s) => s.action !== 'unchanged').map((season) => (
                  <ListItem key={season.seasonKey} alignItems="flex-start" disableGutters
                    sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1, mb: 1, display: 'block' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle2">{season.label}</Typography>
                      <Chip size="small" variant="outlined"
                        color={ACTION_LABELS[season.action]?.color || 'default'}
                        label={ACTION_LABELS[season.action]?.label || season.action} />
                      {/* spec §3.2 rule 9bis — a hand-painted season taken over by the recipe. */}
                      {season.adopted && (
                        <Chip size="small" variant="outlined" color="warning" label="saison manuelle adoptée" />
                      )}
                    </Box>
                    {(season.fieldChanges || []).length > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {season.fieldChanges.map((c) => `${c.field} : ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' · ')}
                      </Typography>
                    )}
                    {(season.rangesAdded || []).map((range) => (
                      <Typography key={`a-${range.startDate}`} variant="caption" sx={{ display: 'block', color: 'success.main' }}>
                        + {frRange(range)}
                      </Typography>
                    ))}
                    {(season.rangesRemoved || []).map((range) => (
                      <Typography key={`r-${range.startDate}`} variant="caption" sx={{ display: 'block', color: 'error.main', textDecoration: 'line-through' }}>
                        − {frRange(range)}
                      </Typography>
                    ))}
                  </ListItem>
                ))}
                {(preview.closures?.added || []).length > 0 && (
                  <ListItem disableGutters sx={{ display: 'block' }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Fermetures</Typography>
                    {preview.closures.added.map((closure) => (
                      <Typography key={closure.startDate} variant="caption" sx={{ display: 'block', color: 'success.main' }}>
                        + {closure.label} : {frRange(closure)}
                      </Typography>
                    ))}
                  </ListItem>
                )}
              </List>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={applyRecipe} disabled={busy || !preview || preview.blocking}>
            Appliquer
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
