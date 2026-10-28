/**
 * The type-specific blocks of the option editor, moved unchanged from the former OptionsPage
 * (specs/options-resources-ux.md §4.2): the breakfast time and notice, the planning card, the bed-linen
 * and towel settings of the linen plugin, the bath-mat quantities, the progressive tiers.
 * Each takes `{ form, setForm }` (and `properties` where it lists them); module-level so inputs keep focus.
 */
import React from 'react';
import {
  Box, Button, Checkbox, FormControl, FormControlLabel, FormHelperText, IconButton, InputLabel, MenuItem,
  Select, Stack, Switch, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

export function normalizeProgressiveTiers(raw) {
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


// Breakfast default time (specs/breakfast-time.md) + push notice (specs/sas-breakfast-bread-and-
// push.md rule 7). Rendered only for the breakfast-typed option. The HH:MM value pre-fills the
// "Heure souhaitée" field on each reservation that enables breakfast, and drives the planning
// sort/display when a reservation has no per-reservation override.
export function BreakfastTimeField({ form, setForm }) {
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
export function PlanningCardSection({ form, setForm }) {
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


export function ProgressivePricingFields({ form, setForm }) {
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


// Bed-linen per-type checkboxes (specs/weekly-bed-linen-tracking.md §3.5.ter). Rendered
// exclusively when editing an option that carries `countsAsBedLinen = 1` — i.e. the seeded
// "Linge de lit" by default. Each unchecked type is excluded from the LaundryDayCard counter
// (the SQL aggregates with CASE WHEN includes_<type> = 1 …).
export function BedLinenIncludesFields({ form, setForm }) {
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
export function BathroomTowelCountsFields({ form, setForm }) {
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
export function BathMatPerPropertyField({ form, setForm, properties }) {
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

