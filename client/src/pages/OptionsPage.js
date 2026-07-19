import React from 'react';
import {
  Box, Button, Checkbox, FormControl, FormControlLabel, FormHelperText, IconButton, InputLabel,
  MenuItem, Select, Stack, Switch, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../api';
import PricedItemsPage from '../components/PricedItemsPage';
import { formatCurrency } from '../utils/formatters';
import PropertiesMultiSelect from '../components/PropertiesMultiSelect';
import OptionPropertyDefaultsMirror from '../components/OptionPropertyDefaultsMirror';

const OPTION_PRICE_TYPES = [
  { value: 'per_stay', label: 'Prix fixe' },
  { value: 'per_person', label: 'Par personne' },
  { value: 'per_night', label: 'Par jour' },
  { value: 'per_person_per_night', label: 'Par personne / jour' },
  { value: 'per_participant_progressive', label: 'Degressif participants' },
  { value: 'free', label: 'Gratuit' },
];

const emptyOption = {
  title: '',
  description: '',
  // Bilingual devis PDF (specs/devis-english-language.md §3 rule 6) — empty = fallback to FR
  // `title`. Only the title is translated: the option description isn't printed in the PDF.
  titleEn: '',
  priceType: 'per_stay',
  price: 0,
  propertyIds: [],
  // Per-property price overrides (specs/per-property-option-prices.md): { [propertyId]: price }.
  // Empty = every property uses the base price. `perPropertyPricing` is a UI-only toggle (derived
  // on load from whether overrides exist): ON replaces the single price with one line per property.
  perPropertyPricing: false,
  propertyPrices: {},
  // Per-property « inclus par défaut » (specs/per-property-default-options.md):
  // { [propertyId]: { default: bool, offered: bool } }. Auto-added to new reservations of that property.
  propertyDefaults: {},
  optionProgressiveTiers: [],
  // Linen flags (specs/weekly-bed-linen-tracking.md). The flag itself stays hidden in the UI —
  // it's set by the server-side seeds and round-tripped silently. But when the form is editing
  // an option that DOES carry the flag (the typed seed), the per-type controls below ARE
  // visible (§3.5.ter): bed-linen checkboxes (which bed types travel to the laundry) + bathroom
  // per-person multipliers (large / medium / small).
  countsAsBedLinen: false,
  countsAsBathroomLinen: false,
  linenIncludesSingle: true,
  linenIncludesDouble: true,
  linenIncludesBaby: true,
  towelLargePerPerson: 1,
  towelMediumPerPerson: 0,
  towelSmallPerPerson: 1,
  // Bath-mat option (specs/laundry-bath-mat.md). Like the linen flags, `countsAsBathMat` stays
  // hidden (seed-managed, round-tripped). When set, the per-property quantity editor below shows.
  // `propertyBathMats` = { [propertyId]: quantity } — flat number of bath mats per stay for that property.
  countsAsBathMat: false,
  propertyBathMats: {},
  // Client-visibility toggle (specs/laundry-bath-mat.md §3 rule 11). ON = shown on fiches + emails
  // + devis + public (default). OFF = internal-only (laundry cards + stock only). Bath mat ships OFF.
  displayToClient: true,
  // Breakfast default time (specs/breakfast-time.md). Only meaningful for the breakfast-typed
  // option; editable there. Pre-fills the desired time on each reservation that enables breakfast.
  breakfastTime: '09:00',
  // Breakfast push notice, minutes before serving time (specs/sas-breakfast-bread-and-push.md rule 7).
  breakfastNotifyLeadMinutes: 30,
  // Option-driven planning cards (specs/option-planning-card.md §3.1). When ON, a reservation
  // carrying this option shows a card on the Planning for each stay day. `cardRepeat` = 'once_per_day'
  // (one slot/day, a single editable heure) or 'multiple_per_day' (N slots/day, a list of heures).
  // `planningCardTimes` holds the slot(s) (length 1 for once_per_day, N for multiple_per_day).
  showsPlanningCard: false,
  cardRepeat: 'once_per_day',
  planningCardDate: '',
  planningCardTimes: ['09:00'],
};

function normalizeProgressiveTiers(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const byParticipant = new Map();
  source.forEach((line) => {
    const participantNumber = Math.max(1, Math.floor(Number(line?.participantNumber || 0)));
    const unitPrice = Math.max(0, Number(line?.unitPrice || 0));
    if (!Number.isFinite(participantNumber) || !Number.isFinite(unitPrice)) return;
    byParticipant.set(participantNumber, {
      participantNumber,
      unitPrice,
    });
  });
  return Array.from(byParticipant.values()).sort((a, b) => a.participantNumber - b.participantNumber);
}

// Bilingual devis PDF (specs/devis-english-language.md §3 rule 6 + §6.2). Single EN title
// field — the description has no EN counterpart because the option's description isn't
// printed in the devis PDF.
function EnglishTitleField({ form, setForm, titleKey, titleLabel }) {
  return (
    <TextField
      label={titleLabel || 'Titre (anglais)'}
      value={form[titleKey] || ''}
      onChange={(e) => setForm({ ...form, [titleKey]: e.target.value })}
      helperText="Utilisé sur le PDF de devis en anglais. Laisser vide → reprend le titre français."
      fullWidth
    />
  );
}

// Breakfast default time (specs/breakfast-time.md) + push notice (specs/sas-breakfast-bread-and-
// push.md rule 7). Rendered only for the breakfast-typed option. The HH:MM value pre-fills the
// "Heure souhaitée" field on each reservation that enables breakfast, and drives the planning
// sort/display when a reservation has no per-reservation override.
function BreakfastTimeField({ form, setForm }) {
  return (
    <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Heure du petit-déjeuner (par défaut)
      </Typography>
      <FormHelperText sx={{ mb: 1, mt: 0 }}>
        Heure proposée par défaut sur chaque réservation ; modifiable par réservation. Sert au tri du planning.
      </FormHelperText>
      <TextField
        label="Heure"
        type="time"
        size="small"
        value={form.breakfastTime || '09:00'}
        onChange={(e) => setForm({ ...form, breakfastTime: e.target.value })}
        sx={{ width: { xs: '100%', sm: 160 } }}
      />
      <FormHelperText sx={{ mt: 2, mb: 1 }}>
        La notification push « Petit déjeuner » part ce nombre de minutes avant l'heure de service (30 min par défaut).
      </FormHelperText>
      <TextField
        label="Préavis de notification (minutes)"
        type="number"
        size="small"
        value={form.breakfastNotifyLeadMinutes ?? 30}
        onChange={(e) => setForm({ ...form, breakfastNotifyLeadMinutes: e.target.value })}
        slotProps={{ htmlInput: { min: 0, max: 240, step: 5 } }}
        sx={{ width: { xs: '100%', sm: 220 } }}
      />
    </Box>
  );
}

// Option-driven planning cards (specs/option-planning-card.md §3.1 + §6). A toggle reveals the
// repetition mode: « Une fois » (a single default date + one time) or « Chaque jour du séjour »
// (a list of time slots — the slot count is the number of cards per day). All values are defaults,
// editable per reservation on the fiche. Module-level so the inputs keep focus across renders.
function PlanningCardSection({ form, setForm }) {
  const on = Boolean(form.showsPlanningCard);
  const repeat = form.cardRepeat === 'multiple_per_day' ? 'multiple_per_day' : 'once_per_day';
  const times = Array.isArray(form.planningCardTimes) ? form.planningCardTimes : [];
  const setTime = (idx, value) => {
    const next = [...times];
    next[idx] = value;
    setForm({ ...form, planningCardTimes: next });
  };
  const addSlot = () => setForm({ ...form, planningCardTimes: [...times, '09:00'] });
  const removeSlot = (idx) => setForm({ ...form, planningCardTimes: times.filter((_, i) => i !== idx) });
  // Switching to « une fois par jour » keeps a single slot; « plusieurs fois » keeps at least one.
  const onRepeatChange = (value) => {
    if (value === 'once_per_day') {
      setForm({ ...form, cardRepeat: 'once_per_day', planningCardTimes: [times[0] || '09:00'] });
    } else {
      setForm({ ...form, cardRepeat: 'multiple_per_day', planningCardTimes: times.length > 0 ? times : ['09:00'] });
    }
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <FormControlLabel
        control={(
          <Switch
            checked={on}
            onChange={(e) => setForm({ ...form, showsPlanningCard: e.target.checked })}
          />
        )}
        label="Afficher une carte dans le planning"
      />
      {on && (
        <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormHelperText sx={{ m: 0 }}>
            Une carte apparaît dans le planning pour chaque jour du séjour. Les heures sont des valeurs par
            défaut, modifiables sur chaque réservation (où l'on choisit aussi les jours concernés).
          </FormHelperText>
          <FormControl size="small" sx={{ width: { xs: '100%', sm: 280 } }}>
            <InputLabel>Répétition</InputLabel>
            <Select
              value={repeat}
              label="Répétition"
              onChange={(e) => onRepeatChange(e.target.value)}
            >
              <MenuItem value="once_per_day">Une fois par jour</MenuItem>
              <MenuItem value="multiple_per_day">Plusieurs fois par jour</MenuItem>
            </Select>
          </FormControl>
          {repeat === 'once_per_day' ? (
            <TextField
              label="Heure (par défaut)"
              type="time"
              size="small"
              value={times[0] || ''}
              onChange={(e) => setForm({ ...form, planningCardTimes: [e.target.value] })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 160 } }}
            />
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <FormHelperText sx={{ m: 0 }}>
                Un créneau = une carte par jour. Ajoutez plusieurs créneaux pour les repas (ex. 08:00 · 12:30 · 19:30).
              </FormHelperText>
              {times.map((t, idx) => (
                // eslint-disable-next-line react/no-array-index-key
                <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    label={`Créneau ${idx + 1}`}
                    type="time"
                    size="small"
                    value={t || ''}
                    onChange={(e) => setTime(idx, e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                    sx={{ width: { xs: '100%', sm: 160 } }}
                  />
                  <IconButton size="small" color="error" onClick={() => removeSlot(idx)} aria-label="Supprimer le créneau" disabled={times.length <= 1}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Box>
                <Button size="small" startIcon={<AddIcon />} onClick={addSlot}>Ajouter un créneau</Button>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// One price row — the SAME presentation for the single price ("Tous les logements") and each
// per-property line: a label + a "Prix (EUR)" input. Module-level so the input keeps focus while
// typing (a component defined inside a render would remount on every keystroke).
function PriceInputRow({ label, value, placeholder, onChange }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, gap: { xs: 0.5, sm: 2 } }}>
      <Typography variant="body2" sx={{ minWidth: { sm: 200 } }}>{label}</Typography>
      <TextField
        label="Prix (EUR)"
        type="number"
        size="small"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        sx={{ width: { xs: '100%', sm: 240 } }}
        slotProps={{ htmlInput: { min: 0, step: '0.5' } }}
      />
    </Box>
  );
}

// Price section (specs/per-property-option-prices.md). A Switch (same control family as the
// reservation page option toggles) flips between a single price ("Tous les logements") and one price
// per applicable property — BOTH rendered with the same row presentation inside one box. Blank in a
// per-property line = inherit the base price; explicit 0 = free. Hidden for `free`; progressive keeps
// global tiers. The effective price is resolved server-side.
function OptionPriceSection({ form, setForm, properties }) {
  if (form.priceType === 'free') return null;
  if (form.priceType === 'per_participant_progressive') {
    return <ProgressivePricingFields form={form} setForm={setForm} />;
  }

  const on = Boolean(form.perPropertyPricing);
  // specs/option-property-scope.md: the applicable properties are exactly the selected ones (no
  // empty → all fallback). « Tous » stores every id, so this still covers all when « Tous » is picked.
  const applicable = (properties || []).filter((p) => (form.propertyIds || []).includes(p.id));
  const prices = form.propertyPrices || {};
  const base = Number(form.price || 0);

  const onToggle = (e) => {
    const next = e.target.checked;
    // OFF clears overrides (back to the single base price); ON keeps any existing.
    setForm({ ...form, perPropertyPricing: next, propertyPrices: next ? prices : {} });
  };
  const setPropPrice = (pid) => (e) => {
    const next = { ...prices };
    if (e.target.value === '') delete next[pid];
    else next[pid] = e.target.value;
    setForm({ ...form, propertyPrices: next });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <FormControlLabel
        control={<Switch checked={on} onChange={onToggle} />}
        label="Prix différent selon le logement"
      />
      <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
        {!on ? (
          <Stack spacing={1.5}>
            <PriceInputRow
              label="Tous les logements"
              value={form.price ?? ''}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Stack>
        ) : applicable.length === 0 ? (
          <FormHelperText sx={{ m: 0 }}>Sélectionnez au moins un logement pour définir un prix par logement.</FormHelperText>
        ) : (
          <>
            <FormHelperText sx={{ mt: 0, mb: 1 }}>
              Laissez vide pour reprendre le prix de base ({base} €) ; mettez 0 pour le rendre gratuit.
            </FormHelperText>
            <Stack spacing={1.5}>
              {applicable.map((p) => (
                <PriceInputRow
                  key={p.id}
                  label={p.name}
                  placeholder={`${base} (prix de base)`}
                  value={prices[p.id] ?? ''}
                  onChange={setPropPrice(p.id)}
                />
              ))}
            </Stack>
          </>
        )}
      </Box>
    </Box>
  );
}

// Per-property « inclus par défaut » section (specs/per-property-default-options.md). Beside the
// per-property price: for each property the option applies to, an « Inclus par défaut » switch + an
// « Offert » switch (offered = included free). Hidden for auto-timed options (engine-derived).
// Module-level so the switches keep focus across renders.
function OptionDefaultsSection({ form, setForm, properties }) {
  if (Number(form.autoEnabled) === 1) return null;
  // specs/option-property-scope.md: only the selected properties (no empty → all fallback).
  const applicable = (properties || []).filter((p) => (form.propertyIds || []).includes(p.id));
  const defaults = form.propertyDefaults || {};
  const setDefault = (pid, on) => {
    const next = { ...defaults };
    if (on) next[pid] = { default: true, offered: Boolean(next[pid] && next[pid].offered) };
    else delete next[pid];
    setForm({ ...form, propertyDefaults: next });
  };
  const setOffered = (pid, on) => {
    setForm({ ...form, propertyDefaults: { ...defaults, [pid]: { default: true, offered: on } } });
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="subtitle2">Inclus par défaut (par logement)</Typography>
      <FormHelperText sx={{ m: 0 }}>
        Auto-ajouté aux nouvelles réservations du logement. « Offert » = inclus gratuitement (0 €).
      </FormHelperText>
      <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
        {applicable.length === 0 ? (
          <FormHelperText sx={{ m: 0 }}>Sélectionnez au moins un logement.</FormHelperText>
        ) : (
          <Stack spacing={1}>
            {applicable.map((p) => {
              const d = defaults[p.id];
              const isDefault = Boolean(d && d.default);
              return (
                <Box key={p.id} sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, gap: { xs: 0.5, sm: 2 } }}>
                  <Typography variant="body2" sx={{ minWidth: { sm: 200 } }}>{p.name}</Typography>
                  <FormControlLabel
                    control={<Switch checked={isDefault} onChange={(e) => setDefault(p.id, e.target.checked)} />}
                    label="Inclus par défaut"
                  />
                  <FormControlLabel
                    control={<Switch checked={Boolean(d && d.offered)} disabled={!isDefault} onChange={(e) => setOffered(p.id, e.target.checked)} />}
                    label="Offert"
                  />
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

function ProgressivePricingFields({ form, setForm }) {
  if (form.priceType !== 'per_participant_progressive') return null;

  const tiers = normalizeProgressiveTiers(form.optionProgressiveTiers);
  const updateTier = (participantNumber, updates) => {
    const next = normalizeProgressiveTiers(
      tiers.map((line) => (
        line.participantNumber === participantNumber
          ? { ...line, ...updates }
          : line
      ))
    );
    setForm({ ...form, optionProgressiveTiers: next });
  };

  const removeTier = (participantNumber) => {
    const next = tiers.filter((line) => line.participantNumber !== participantNumber);
    setForm({ ...form, optionProgressiveTiers: next });
  };

  const addTier = () => {
    const nextNumber = tiers.length > 0
      ? Math.max(...tiers.map((line) => Number(line.participantNumber || 0))) + 1
      : 1;
    const next = normalizeProgressiveTiers([
      ...tiers,
      { participantNumber: nextNumber, unitPrice: Number(form.price || 0) || 0 },
    ]);
    setForm({ ...form, optionProgressiveTiers: next });
  };

  return (
    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        Tableau tarif degressif (ordre des participants)
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Exemple: 1=20, 2=20, 3=5 applique 20EUR aux deux premiers, puis 5EUR pour les suivants.
      </Typography>
      {tiers.map((line) => (
        <Box key={line.participantNumber} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            label="Participant n"
            type="number"
            value={line.participantNumber}
            onChange={(e) => {
              const updatedParticipant = Math.max(1, Math.floor(Number(e.target.value || 1)));
              const next = tiers.map((entry) => (
                entry.participantNumber === line.participantNumber
                  ? { ...entry, participantNumber: updatedParticipant }
                  : entry
              ));
              setForm({ ...form, optionProgressiveTiers: normalizeProgressiveTiers(next) });
            }}
            size="small"
            sx={{ width: 160 }}
            slotProps={{
              htmlInput: { min: 1, step: 1 }
            }}
          />
          <TextField
            label="Prix unitaire (EUR)"
            type="number"
            value={line.unitPrice}
            onChange={(e) => updateTier(line.participantNumber, { unitPrice: Number(e.target.value || 0) })}
            size="small"
            sx={{ width: 190 }}
            slotProps={{
              htmlInput: { min: 0, step: 0.01 }
            }}
          />
          <IconButton
            size="small"
            color="error"
            onClick={() => removeTier(line.participantNumber)}
            aria-label="Supprimer palier"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Box>
        <Button size="small" startIcon={<AddIcon />} onClick={addTier}>Ajouter un palier</Button>
      </Box>
    </Box>
  );
}

export default function OptionsPage({ barCenter }) {
  return (
    <PricedItemsPage
      barCenter={barCenter}
      pageTitle="Options de sejour"
      itemLabel="option"
      emptyForm={emptyOption}
      priceTypes={OPTION_PRICE_TYPES}
      explicitPropertyScope
      // specs/per-property-option-prices.md — surface the per-property price overrides in the list:
      // the base price, then one line per property that overrides it (« Logement : X € »).
      renderPriceCell={(item, properties) => {
        if (item.priceType === 'free') return 'Gratuit';
        const overrides = Object.entries(item.propertyPrices || {})
          .filter(([, v]) => v !== null && v !== undefined && v !== '');
        if (overrides.length === 0) return formatCurrency(item.price);
        return (
          <Box>
            <Typography variant="body2" sx={{ lineHeight: 1.35 }}>
              {formatCurrency(item.price)} <Typography component="span" variant="caption" color="text.secondary">(base)</Typography>
            </Typography>
            {overrides.map(([pid, price]) => (
              <Typography key={pid} variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
                {(properties.find((p) => Number(p.id) === Number(pid))?.name) || `#${pid}`} : {formatCurrency(price)}
              </Typography>
            ))}
          </Box>
        );
      }}
      loadItems={async () => {
        const [items, properties] = await Promise.all([api.getOptions(), api.getProperties()]);
        return { items, properties };
      }}
      createItem={(data) => api.createOption(data)}
      updateItem={(id, data) => api.updateOption(id, data)}
      deleteItem={(id) => api.deleteOption(id)}
      fromItem={(item) => ({
        ...item,
        propertyIds: Array.isArray(item.propertyIds) ? item.propertyIds : [],
        propertyPrices: (item.propertyPrices && typeof item.propertyPrices === 'object') ? item.propertyPrices : {},
        // Toggle is ON when the option already has at least one per-property override.
        perPropertyPricing: Boolean(item.propertyPrices && Object.keys(item.propertyPrices).length > 0),
        // Server returns only the properties where this option IS a default ({ [pid]: { offered } }).
        // In the form, each becomes { default: true, offered } so the toggles render.
        propertyDefaults: Object.fromEntries(
          Object.entries(item.propertyDefaults || {}).map(([pid, v]) => [pid, { default: true, offered: Boolean(v && v.offered) }]),
        ),
        optionProgressiveTiers: normalizeProgressiveTiers(item.optionProgressiveTiers),
        // The countsAs… flags are hidden in the UI (round-tripped silently); the per-type
        // controls below ARE visible when the flag is set. SQLite stores ints, normalise.
        countsAsBedLinen: Boolean(item.countsAsBedLinen),
        countsAsBathroomLinen: Boolean(item.countsAsBathroomLinen),
        linenIncludesSingle: item.linenIncludesSingle == null ? true : Boolean(item.linenIncludesSingle),
        linenIncludesDouble: item.linenIncludesDouble == null ? true : Boolean(item.linenIncludesDouble),
        linenIncludesBaby:   item.linenIncludesBaby   == null ? true : Boolean(item.linenIncludesBaby),
        towelLargePerPerson:  item.towelLargePerPerson  == null ? 1 : Number(item.towelLargePerPerson),
        towelMediumPerPerson: item.towelMediumPerPerson == null ? 0 : Number(item.towelMediumPerPerson),
        towelSmallPerPerson:  item.towelSmallPerPerson  == null ? 1 : Number(item.towelSmallPerPerson),
        // Bath-mat option (specs/laundry-bath-mat.md) — hidden flag + per-property quantity map.
        countsAsBathMat: Boolean(item.countsAsBathMat),
        propertyBathMats: (item.propertyBathMats && typeof item.propertyBathMats === 'object') ? item.propertyBathMats : {},
        // Client-visibility (default true when the column/flag is absent — back-compat).
        displayToClient: item.displayToClient == null ? true : Boolean(item.displayToClient),
        // Bilingual devis PDF (specs/devis-english-language.md §3 rule 6) — title only.
        titleEn: item.titleEn || '',
        // Breakfast default time (specs/breakfast-time.md) — surfaced for the breakfast option.
        breakfastTime: item.breakfastTime || '09:00',
        breakfastNotifyLeadMinutes: item.breakfastNotifyLeadMinutes == null ? 30 : Number(item.breakfastNotifyLeadMinutes),
        // Option-driven planning cards (specs/option-planning-card.md §3.1). SQLite stores an int +
        // a JSON string; normalise to a boolean + an array for the form.
        showsPlanningCard: Boolean(item.showsPlanningCard),
        // Legacy 'daily' rows map to « plusieurs fois par jour »; anything else to « une fois par jour ».
        cardRepeat: item.cardRepeat === 'multiple_per_day' || item.cardRepeat === 'daily' ? 'multiple_per_day' : 'once_per_day',
        planningCardDate: '',
        planningCardTimes: Array.isArray(item.planningCardTimes) && item.planningCardTimes.length > 0
          ? item.planningCardTimes
          : ['09:00'],
      })}
      toPayload={(form) => ({
        title: form.title,
        description: form.description || '',
        // Bilingual devis PDF — empty string when the operator leaves it blank.
        titleEn: (form.titleEn || '').trim(),
        price: form.priceType === 'free' ? 0 : Number(form.price) || 0,
        priceType: form.priceType || 'per_stay',
        optionProgressiveTiers: normalizeProgressiveTiers(form.optionProgressiveTiers),
        propertyIds: form.propertyIds && form.propertyIds.length > 0 ? form.propertyIds : [],
        // Per-property price overrides (specs/per-property-option-prices.md). None for free /
        // progressive options. For property-restricted options, drop overrides for properties the
        // option no longer applies to (the global case keeps all keys — every property is valid).
        propertyPrices: (() => {
          if (!form.perPropertyPricing) return {};
          if (form.priceType === 'free' || form.priceType === 'per_participant_progressive') return {};
          const src = form.propertyPrices || {};
          const restricted = form.propertyIds && form.propertyIds.length > 0
            ? new Set(form.propertyIds.map(Number))
            : null;
          const out = {};
          Object.entries(src).forEach(([pid, val]) => {
            if (val === '' || val === null || val === undefined) return;
            if (restricted && !restricted.has(Number(pid))) return;
            out[pid] = Number(val);
          });
          return out;
        })(),
        // Per-property « inclus par défaut » map (specs/per-property-default-options.md). Server
        // persists only the properties marked default, scoped to the option's applicable properties.
        propertyDefaults: form.propertyDefaults || {},
        countsAsBedLinen: Boolean(form.countsAsBedLinen),
        countsAsBathroomLinen: Boolean(form.countsAsBathroomLinen),
        linenIncludesSingle: Boolean(form.linenIncludesSingle),
        linenIncludesDouble: Boolean(form.linenIncludesDouble),
        linenIncludesBaby: Boolean(form.linenIncludesBaby),
        towelLargePerPerson:  Math.max(0, Math.floor(Number(form.towelLargePerPerson)  || 0)),
        towelMediumPerPerson: Math.max(0, Math.floor(Number(form.towelMediumPerPerson) || 0)),
        towelSmallPerPerson:  Math.max(0, Math.floor(Number(form.towelSmallPerPerson)  || 0)),
        // Bath-mat option (specs/laundry-bath-mat.md): hidden flag + per-property quantity map.
        // Drop quantities for properties the option no longer applies to (mirror of propertyPrices).
        countsAsBathMat: Boolean(form.countsAsBathMat),
        propertyBathMats: (() => {
          const src = form.propertyBathMats || {};
          const restricted = form.propertyIds && form.propertyIds.length > 0
            ? new Set(form.propertyIds.map(Number))
            : null;
          const out = {};
          Object.entries(src).forEach(([pid, val]) => {
            if (val === '' || val === null || val === undefined) return;
            if (restricted && !restricted.has(Number(pid))) return;
            const n = Math.max(0, Math.floor(Number(val) || 0));
            if (n > 0) out[pid] = n;
          });
          return out;
        })(),
        // Client-visibility toggle (specs/laundry-bath-mat.md §3 rule 11).
        displayToClient: Boolean(form.displayToClient),
        // Breakfast default time (specs/breakfast-time.md). Persisted only for the breakfast
        // option server-side; harmless for the others.
        breakfastTime: form.breakfastTime || '09:00',
        // Push notice before serving time (specs/sas-breakfast-bread-and-push.md rule 7).
        breakfastNotifyLeadMinutes: form.breakfastNotifyLeadMinutes,
        // Option-driven planning cards (specs/option-planning-card.md §3.1). The server normalises
        // the slots (clamps to 1 for « une fois par jour »); we pass the form state through.
        showsPlanningCard: Boolean(form.showsPlanningCard),
        cardRepeat: form.cardRepeat === 'multiple_per_day' ? 'multiple_per_day' : 'once_per_day',
        planningCardTimes: Array.isArray(form.planningCardTimes) ? form.planningCardTimes.filter(Boolean) : [],
      })}
      formNameKey="title"
      formDescriptionKey="description"
      showQuantity={false}
      isDeleteDisabled={(item) => Boolean(item.autoOptionType)}
      // Bespoke form layout (specs/per-property-option-prices.md §6): explicit field order —
      // Nom, Titre (anglais), Description, Logements, Type de prix, prix (unique OU par logement
      // via le Switch), puis les options spécifiques (petit-déjeuner, linge, défauts).
      renderForm={({ form, setForm, properties, priceTypes }) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Nom"
            value={form.title || ''}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            fullWidth
            required
          />
          <EnglishTitleField form={form} setForm={setForm} titleKey="titleEn" />
          <TextField
            label="Description"
            value={form.description || ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            fullWidth
            multiline
            rows={2}
          />
          <PropertiesMultiSelect
            properties={properties}
            value={form.propertyIds}
            onChange={(ids) => setForm({ ...form, propertyIds: ids })}
            emptyMeansNone
          />
          <FormControl fullWidth>
            <InputLabel>Type de prix</InputLabel>
            <Select
              value={form.priceType || 'per_stay'}
              label="Type de prix"
              onChange={(e) => setForm({ ...form, priceType: e.target.value })}
            >
              {priceTypes.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </Select>
          </FormControl>
          {/* Prix unique (Switch OFF) ou prix par logement (Switch ON) — même présentation. */}
          <OptionPriceSection form={form} setForm={setForm} properties={properties} />
          {/* Per-property « inclus par défaut » (specs/per-property-default-options.md) — beside the price. */}
          <OptionDefaultsSection form={form} setForm={setForm} properties={properties} />
          {/* Breakfast default time (specs/breakfast-time.md) — only on the breakfast option. */}
          {form.autoOptionType === 'breakfast' && (
            <BreakfastTimeField form={form} setForm={setForm} />
          )}
          {/* Option-driven planning card (specs/option-planning-card.md §3.1) — manual options only. */}
          {!form.autoOptionType && (
            <PlanningCardSection form={form} setForm={setForm} />
          )}
          {/* §3.5.ter — per-type linen controls visible iff the (hidden) flag is set. */}
          {form.countsAsBedLinen && (
            <BedLinenIncludesFields form={form} setForm={setForm} />
          )}
          {form.countsAsBathroomLinen && (
            <BathroomTowelCountsFields form={form} setForm={setForm} />
          )}
          {form.countsAsBathMat && (
            <BathMatPerPropertyField form={form} setForm={setForm} properties={properties} />
          )}
          {/* Client-visibility toggle (specs/laundry-bath-mat.md §3 rule 11) — generic to every
              option. OFF = hidden from the client surfaces; what the option keeps doing internally
              depends on its type (laundry card for linen, planning card for the others). */}
          <Box sx={{ mt: 1, p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
            <FormControlLabel
              control={(
                <Switch
                  checked={Boolean(form.displayToClient)}
                  onChange={(e) => setForm({ ...form, displayToClient: e.target.checked })}
                />
              )}
              label="Afficher côté client (fiches & emails)"
            />
            <FormHelperText sx={{ mt: 0 }}>
              {(() => {
                const masque = 'masquée des fiches de réservation, des emails clients, du devis et de la réservation en ligne';
                if (form.countsAsBedLinen || form.countsAsBathroomLinen || form.countsAsBathMat) {
                  return `Désactivé : usage interne — l'option reste comptée dans les cartes blanchisserie et le stock, mais ${masque}.`;
                }
                if (form.showsPlanningCard || form.autoOptionType === 'breakfast') {
                  return `Désactivé : usage interne — l'option reste affichée comme carte de préparation dans le planning, mais ${masque}.`;
                }
                return `Désactivé : usage interne — l'option est ${masque}.`;
              })()}
            </FormHelperText>
          </Box>
          {/* §3.7 read-only mirror — list of properties that use this option as a default. */}
          <OptionPropertyDefaultsMirror optionId={form.id} form={form} />
        </Box>
      )}
    />
  );
}

// Bed-linen per-type checkboxes (specs/weekly-bed-linen-tracking.md §3.5.ter). Rendered
// exclusively when editing an option that carries `countsAsBedLinen = 1` — i.e. the seeded
// "Linge de lit" by default. Each unchecked type is excluded from the LaundryDayCard counter
// (the SQL aggregates with CASE WHEN includes_<type> = 1 …).
function BedLinenIncludesFields({ form, setForm }) {
  const toggle = (key) => (e) => setForm({ ...form, [key]: e.target.checked });
  return (
    <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Types de draps emmenés à la blanchisserie
      </Typography>
      <FormHelperText sx={{ mb: 1, mt: 0 }}>
        Décochez un type pour qu'il ne soit pas compté dans la carte blanchisserie du planning.
      </FormHelperText>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }}>
        <FormControlLabel
          control={<Checkbox checked={Boolean(form.linenIncludesDouble)} onChange={toggle('linenIncludesDouble')} />}
          label="Drap double"
        />
        <FormControlLabel
          control={<Checkbox checked={Boolean(form.linenIncludesSingle)} onChange={toggle('linenIncludesSingle')} />}
          label="Drap simple"
        />
        <FormControlLabel
          control={<Checkbox checked={Boolean(form.linenIncludesBaby)} onChange={toggle('linenIncludesBaby')} />}
          label="Drap bébé"
        />
      </Stack>
    </Box>
  );
}

// Bathroom-linen per-person multipliers (specs/weekly-bed-linen-tracking.md §3.5.ter). Three
// non-negative integers: how many of each towel size are provided per person. A zero hides that
// size from the LaundryDayCard line at render time (rule 13.bis).
function BathroomTowelCountsFields({ form, setForm }) {
  const setKey = (key) => (e) => {
    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
    setForm({ ...form, [key]: n });
  };
  return (
    <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Nombre de serviettes par personne
      </Typography>
      <FormHelperText sx={{ mb: 1, mt: 0 }}>
        Adultes, ados et enfants — bébés exclus. Mettez 0 pour qu'un type ne soit pas compté dans la carte blanchisserie.
      </FormHelperText>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          label="Grandes"
          type="number"
          size="small"
          value={Number(form.towelLargePerPerson) || 0}
          onChange={setKey('towelLargePerPerson')}
          sx={{ width: { xs: '100%', sm: 140 } }}
          slotProps={{
            htmlInput: { min: 0, step: 1 }
          }}
        />
        <TextField
          label="Moyennes"
          type="number"
          size="small"
          value={Number(form.towelMediumPerPerson) || 0}
          onChange={setKey('towelMediumPerPerson')}
          sx={{ width: { xs: '100%', sm: 140 } }}
          slotProps={{
            htmlInput: { min: 0, step: 1 }
          }}
        />
        <TextField
          label="Petites"
          type="number"
          size="small"
          value={Number(form.towelSmallPerPerson) || 0}
          onChange={setKey('towelSmallPerPerson')}
          sx={{ width: { xs: '100%', sm: 140 } }}
          slotProps={{
            htmlInput: { min: 0, step: 1 }
          }}
        />
      </Stack>
    </Box>
  );
}

// Bath-mat per-property quantity (specs/laundry-bath-mat.md §6). One integer field per applicable
// property: how many bath mats one stay of that property sends to the laundry. Flat per stay (not
// per person), counted when the "Tapis de bain" option is active on the reservation. Rendered only
// when editing the option that carries `countsAsBathMat = 1` (the typed seed). Mirrors the
// per-property price section's layout.
function BathMatPerPropertyField({ form, setForm, properties }) {
  const applicable = (properties || []).filter((p) => (form.propertyIds || []).includes(p.id));
  const quantities = form.propertyBathMats || {};
  const setQty = (pid) => (e) => {
    const next = { ...quantities };
    if (e.target.value === '') delete next[pid];
    else next[pid] = e.target.value;
    setForm({ ...form, propertyBathMats: next });
  };
  return (
    <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Nombre de tapis de bain par logement
      </Typography>
      <FormHelperText sx={{ mb: 1, mt: 0 }}>
        Nombre de tapis emmenés à la blanchisserie pour une location. Indiquez 0 si ce logement ne fournit pas de tapis de bain.
      </FormHelperText>
      {applicable.length === 0 ? (
        <FormHelperText sx={{ m: 0 }}>Sélectionnez au moins un logement pour définir une quantité.</FormHelperText>
      ) : (
        <Stack spacing={1.5}>
          {applicable.map((p) => (
            <TextField
              key={p.id}
              label={p.name}
              type="number"
              size="small"
              value={quantities[p.id] ?? ''}
              onChange={setQty(p.id)}
              placeholder="0"
              sx={{ maxWidth: { xs: '100%', sm: 260 } }}
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

// 2026-06-02 follow-up — the `countsAsBedLinen` / `countsAsBathroomLinen` flags themselves stay
// HIDDEN in this form (no checkbox to toggle them): they're set by the server-side seeds + the
// title-alias promotion, and are silently round-tripped via fromItem / toPayload. What IS
// visible (rendered conditionally on the flag being set) is the per-type configuration block
// for that linen kind — §3.5.ter `BedLinenIncludesFields` for bed (3 type checkboxes) and
// `BathroomTowelCountsFields` for bathroom (3 per-person integer counts). The bath-mat option
// (specs/laundry-bath-mat.md) follows the same pattern with `BathMatPerPropertyField`.
