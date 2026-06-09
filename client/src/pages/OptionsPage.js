import React from 'react';
import {
  Box, Button, Checkbox, FormControlLabel, FormHelperText, IconButton, Stack, TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../api';
import PricedItemsPage from '../components/PricedItemsPage';
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
  // Empty = every property uses the base price.
  propertyPrices: {},
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
  // Breakfast default time (specs/breakfast-time.md). Only meaningful for the breakfast-typed
  // option; editable there. Pre-fills the desired time on each reservation that enables breakfast.
  breakfastTime: '09:00',
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

// Breakfast default time (specs/breakfast-time.md). Rendered only for the breakfast-typed option.
// The HH:MM value pre-fills the "Heure souhaitée" field on each reservation that enables breakfast,
// and drives the planning sort/display when a reservation has no per-reservation override.
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
    </Box>
  );
}

// Per-property price overrides (specs/per-property-option-prices.md). One optional price input per
// applicable property (the option's selected properties, or ALL when it's global). Blank = inherit
// the base price; an explicit 0 = free for that property. Hidden for `free` and progressive options
// (the latter keeps global tiers). The effective price is resolved server-side.
function PerPropertyPricesField({ form, setForm, properties }) {
  if (form.priceType === 'per_participant_progressive') {
    return (
      <FormHelperText sx={{ mt: 1 }}>
        Les options à tarif dégressif utilisent les mêmes paliers pour tous les logements.
      </FormHelperText>
    );
  }
  if (form.priceType === 'free') return null;

  const applicable = (form.propertyIds && form.propertyIds.length > 0)
    ? (properties || []).filter((p) => form.propertyIds.includes(p.id))
    : (properties || []);
  if (!applicable.length) return null;

  const prices = form.propertyPrices || {};
  const base = Number(form.price || 0);
  const setPrice = (pid) => (e) => {
    const next = { ...prices };
    if (e.target.value === '') delete next[pid];
    else next[pid] = e.target.value;
    setForm({ ...form, propertyPrices: next });
  };

  return (
    <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Prix par logement (optionnel)
      </Typography>
      <FormHelperText sx={{ mb: 1, mt: 0 }}>
        Laissez vide pour utiliser le prix de base ({base} €). Mettez 0 pour rendre l'option gratuite sur ce logement.
      </FormHelperText>
      <Stack spacing={1.5}>
        {applicable.map((p) => (
          <Box
            key={p.id}
            sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, gap: { xs: 0.5, sm: 2 } }}
          >
            <Typography variant="body2" sx={{ minWidth: { sm: 180 } }}>{p.name}</Typography>
            <TextField
              type="number"
              size="small"
              placeholder={`${base} (prix de base)`}
              value={prices[p.id] ?? ''}
              onChange={setPrice(p.id)}
              sx={{ width: { xs: '100%', sm: 200 } }}
              slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
            />
          </Box>
        ))}
      </Stack>
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

export default function OptionsPage() {
  return (
    <PricedItemsPage
      pageTitle="Options de sejour"
      itemLabel="option"
      emptyForm={emptyOption}
      priceTypes={OPTION_PRICE_TYPES}
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
        // Bilingual devis PDF (specs/devis-english-language.md §3 rule 6) — title only.
        titleEn: item.titleEn || '',
        // Breakfast default time (specs/breakfast-time.md) — surfaced for the breakfast option.
        breakfastTime: item.breakfastTime || '09:00',
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
        countsAsBedLinen: Boolean(form.countsAsBedLinen),
        countsAsBathroomLinen: Boolean(form.countsAsBathroomLinen),
        linenIncludesSingle: Boolean(form.linenIncludesSingle),
        linenIncludesDouble: Boolean(form.linenIncludesDouble),
        linenIncludesBaby: Boolean(form.linenIncludesBaby),
        towelLargePerPerson:  Math.max(0, Math.floor(Number(form.towelLargePerPerson)  || 0)),
        towelMediumPerPerson: Math.max(0, Math.floor(Number(form.towelMediumPerPerson) || 0)),
        towelSmallPerPerson:  Math.max(0, Math.floor(Number(form.towelSmallPerPerson)  || 0)),
        // Breakfast default time (specs/breakfast-time.md). Persisted only for the breakfast
        // option server-side; harmless for the others.
        breakfastTime: form.breakfastTime || '09:00',
      })}
      formNameKey="title"
      formDescriptionKey="description"
      showQuantity={false}
      isDeleteDisabled={(item) => Boolean(item.autoOptionType)}
      renderExtraFormFields={(form, setForm, ctx = {}) => (
        <>
          {/* Bilingual devis PDF (specs/devis-english-language.md §3 rule 6 + §6.2) — surface
              the EN title on the same form. Empty = fallback to FR in the EN PDF. */}
          <EnglishTitleField form={form} setForm={setForm} titleKey="titleEn" />
          <ProgressivePricingFields form={form} setForm={setForm} />
          {/* Per-property price overrides (specs/per-property-option-prices.md). */}
          <PerPropertyPricesField form={form} setForm={setForm} properties={ctx.properties || []} />
          {/* Breakfast default time (specs/breakfast-time.md) — only on the breakfast option. */}
          {form.autoOptionType === 'breakfast' && (
            <BreakfastTimeField form={form} setForm={setForm} />
          )}
          {/* §3.5.ter — per-type controls visible iff the flag is set. The flag itself stays
              hidden (set by the server-side seed); these controls let Adrien tune which bed
              types travel to the laundry + how many towels of each size per person. */}
          {form.countsAsBedLinen && (
            <BedLinenIncludesFields form={form} setForm={setForm} />
          )}
          {form.countsAsBathroomLinen && (
            <BathroomTowelCountsFields form={form} setForm={setForm} />
          )}
          {/* §3.7 read-only mirror — list of properties that use this option as a default. */}
          <OptionPropertyDefaultsMirror optionId={form.id} form={form} />
        </>
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

// 2026-06-02 follow-up — the `countsAsBedLinen` / `countsAsBathroomLinen` flags themselves stay
// HIDDEN in this form (no checkbox to toggle them): they're set by the server-side seeds + the
// title-alias promotion, and are silently round-tripped via fromItem / toPayload. What IS
// visible (rendered conditionally on the flag being set) is the per-type configuration block
// for that linen kind — §3.5.ter `BedLinenIncludesFields` for bed (3 type checkboxes) and
// `BathroomTowelCountsFields` for bathroom (3 per-person integer counts).
