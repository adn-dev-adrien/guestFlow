import React from 'react';
import {
  Box, Typography, FormControlLabel, Switch, FormControl, InputLabel, Select, MenuItem,
  TextField, FormGroup, Checkbox
} from '@mui/material';
import api from '../api';
import PricedItemsPage from '../components/PricedItemsPage';
import { alpha } from '@mui/material/styles';

const SLOT_DURATION_OPTIONS = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 heure' },
  { value: 120, label: '2 heures' },
];

const DAY_OPTIONS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Jeu' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sam' },
  { value: 0, label: 'Dim' },
];

const emptyResource = {
  name: '', quantity: 1, price: 0, priceType: 'per_stay', propertyIds: [], description: '',
  // Bilingual devis PDF (specs/devis-english-language.md §3 rule 7) — empty = fallback to FR.
  nameEn: '',
  propertyPricing: {},
  isComplex: false, slotDuration: 5, minimumUsageMinutes: 0, openTime: '08:00', closeTime: '22:00', openDays: [0, 1, 2, 3, 4, 5, 6], turnoverMinutes: 0,
  // Hourly scheduling + time-banded grid (specs/resource-hourly-scheduling.md §3.1).
  showsPlanningCard: false, hourlyEveningStart: '', hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0,
};

function ComplexResourceFields({ form, setForm, properties }) {
  const openDays = Array.isArray(form.openDays) ? form.openDays : [0, 1, 2, 3, 4, 5, 6];
  const normalizedPropertyIds = Array.isArray(form.propertyIds) ? form.propertyIds.map((id) => Number(id)) : [];
  const targetProperties = normalizedPropertyIds.length > 0
    ? (properties || []).filter((p) => normalizedPropertyIds.includes(Number(p.id)))
    : (properties || []);

  const getPropertyPricingLine = (propertyId) => {
    const raw = (form.propertyPricing || {})[String(propertyId)] || {};
    return {
      price: raw.price ?? '',
      freeMinutes: Math.max(0, Number(raw.freeMinutes || 0)),
    };
  };

  const updatePropertyPrice = (propertyId, value) => {
    const nextPricing = { ...(form.propertyPricing || {}) };
    const trimmed = String(value || '').trim();
    const existing = nextPricing[String(propertyId)] || {};
    if (trimmed === '') {
      if (Number(existing.freeMinutes || 0) > 0) {
        nextPricing[String(propertyId)] = { price: '', freeMinutes: Number(existing.freeMinutes || 0) };
      } else {
        delete nextPricing[String(propertyId)];
      }
    } else {
      const parsed = Number(trimmed);
      nextPricing[String(propertyId)] = {
        price: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
        freeMinutes: Number(existing.freeMinutes || 0),
      };
    }
    setForm({ ...form, propertyPricing: nextPricing });
  };

  const updatePropertyFirstHourFree = (propertyId, enabled) => {
    const nextPricing = { ...(form.propertyPricing || {}) };
    const existing = nextPricing[String(propertyId)] || {};
    const nextLine = {
      price: existing.price ?? '',
      freeMinutes: enabled ? 60 : 0,
    };
    if ((nextLine.price === '' || nextLine.price === null || nextLine.price === undefined) && nextLine.freeMinutes === 0) {
      delete nextPricing[String(propertyId)];
    } else {
      nextPricing[String(propertyId)] = nextLine;
    }
    setForm({ ...form, propertyPricing: nextPricing });
  };

  const toggleDay = (dayNum) => {
    const next = openDays.includes(dayNum)
      ? openDays.filter((d) => d !== dayNum)
      : [...openDays, dayNum];
    setForm({ ...form, openDays: next });
  };
  const showMinimumUsage = form.priceType === 'per_hour';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
      {showMinimumUsage && (
        <FormControl fullWidth size="small">
          <InputLabel>Temps minimum d'utilisation</InputLabel>
          <Select
            value={form.minimumUsageMinutes || 60}
            label="Temps minimum d'utilisation"
            onChange={(e) => setForm({ ...form, minimumUsageMinutes: Number(e.target.value) || 0 })}
          >
            {SLOT_DURATION_OPTIONS.map((o) => <MenuItem key={`min-${o.value}`} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        </FormControl>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2" fontWeight={600}>Prix specifique par logement (optionnel)</Typography>
        <Typography variant="caption" color="text.secondary">
          Laisse vide pour utiliser le prix general. Tu peux aussi offrir la 1ere heure.
        </Typography>
        {targetProperties.length === 0 && (
          <Typography variant="caption" color="text.secondary">Aucun logement disponible.</Typography>
        )}
        {targetProperties.map((property) => (
          <Box key={property.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
            <TextField
              label={`Prix ${property.name} (EUR/h)`}
              type="number"
              size="small"
              value={getPropertyPricingLine(property.id).price}
              onChange={(e) => updatePropertyPrice(property.id, e.target.value)}
              fullWidth
              slotProps={{
                htmlInput: { min: 0, step: '0.01' }
              }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={getPropertyPricingLine(property.id).freeMinutes >= 60}
                  onChange={(e) => updatePropertyFirstHourFree(property.id, e.target.checked)}
                />
              }
              label={<Typography variant="caption">1ere heure offerte pour {property.name}</Typography>}
              sx={{ m: 0 }}
            />
          </Box>
        ))}
      </Box>
      <FormControlLabel
        control={<Switch checked={Boolean(form.isComplex)} onChange={(e) => setForm({ ...form, isComplex: e.target.checked })} />}
        label={<Typography variant="body2" fontWeight={600}>Ressource à créneaux (bain nordique, salle…)</Typography>}
      />
      {form.isComplex && (
        <Box sx={{ pl: 2, display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '3px solid', borderColor: 'primary.light' }}>
          <FormControl fullWidth size="small">
            <InputLabel>Durée minimale</InputLabel>
            <Select
              value={form.slotDuration || 5}
              label="Durée minimale"
              onChange={(e) => setForm({ ...form, slotDuration: e.target.value })}
            >
              {SLOT_DURATION_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Heure d'ouverture"
              type="time"
              size="small"
              value={form.openTime || '08:00'}
              onChange={(e) => setForm({ ...form, openTime: e.target.value })}
              sx={{ flex: 1 }}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
            <TextField
              label="Heure de fermeture"
              type="time"
              size="small"
              value={form.closeTime || '22:00'}
              onChange={(e) => setForm({ ...form, closeTime: e.target.value })}
              sx={{ flex: 1 }}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Box>
          <TextField
            label="Temps de remise en état (min)"
            type="number"
            size="small"
            value={form.turnoverMinutes || 0}
            onChange={(e) => setForm({ ...form, turnoverMinutes: Math.max(0, Number(e.target.value) || 0) })}
            helperText="Ex: 15 min pour chauffer/remettre en état"
            fullWidth
            slotProps={{
              htmlInput: { min: 0, step: 5 }
            }}
          />
          <Box>
            <Typography variant="caption" color="text.secondary" gutterBottom display="block">Jours d'ouverture</Typography>
            <FormGroup row>
              {DAY_OPTIONS.map((d) => (
                <FormControlLabel
                  key={d.value}
                  control={<Checkbox size="small" checked={openDays.includes(d.value)} onChange={() => toggleDay(d.value)} />}
                  label={<Typography variant="caption">{d.label}</Typography>}
                  sx={{ mr: 1 }}
                />
              ))}
            </FormGroup>
          </Box>

          {/* Hourly scheduling + time-banded grid (specs/resource-hourly-scheduling.md §3.1). Only
              meaningful for a per_hour resource: the planning card + the day/evening + external grid. */}
          {form.priceType === 'per_hour' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, borderTop: '1px dashed', borderColor: 'divider', pt: 1.5 }}>
              <FormControlLabel
                control={<Switch checked={Boolean(form.showsPlanningCard)} onChange={(e) => setForm({ ...form, showsPlanningCard: e.target.checked })} />}
                label={<Typography variant="body2" fontWeight={600}>Planification par séances + tarif horaire (carte planning)</Typography>}
              />
              {form.showsPlanningCard && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Le tarif horaire de jour est le prix général ci-dessus ({form.price || 0} €/h). En soirée, le tarif soir s'applique.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                    <TextField
                      label="Heure de bascule soir"
                      type="time"
                      size="small"
                      value={form.hourlyEveningStart || ''}
                      onChange={(e) => setForm({ ...form, hourlyEveningStart: e.target.value })}
                      sx={{ flex: 1 }}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <TextField
                      label="Tarif horaire soir (€/h)"
                      type="number"
                      size="small"
                      value={form.hourlyEveningRate ?? 0}
                      onChange={(e) => setForm({ ...form, hourlyEveningRate: Math.max(0, Number(e.target.value) || 0) })}
                      sx={{ flex: 1 }}
                      slotProps={{ htmlInput: { min: 0, step: '0.5' } }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    Tarif extérieurs (sans réservation logement)
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                    <TextField
                      label="Tarif jour extérieurs (€/h)"
                      type="number"
                      size="small"
                      value={form.hourlyExternalDayRate ?? 0}
                      onChange={(e) => setForm({ ...form, hourlyExternalDayRate: Math.max(0, Number(e.target.value) || 0) })}
                      helperText="Vide / 0 = tarif invité"
                      sx={{ flex: 1 }}
                      slotProps={{ htmlInput: { min: 0, step: '0.5' } }}
                    />
                    <TextField
                      label="Tarif soir extérieurs (€/h)"
                      type="number"
                      size="small"
                      value={form.hourlyExternalEveningRate ?? 0}
                      onChange={(e) => setForm({ ...form, hourlyExternalEveningRate: Math.max(0, Number(e.target.value) || 0) })}
                      helperText="Vide / 0 = tarif invité"
                      sx={{ flex: 1 }}
                      slotProps={{ htmlInput: { min: 0, step: '0.5' } }}
                    />
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Maps the resource editor form to the API payload. Exported for the unit test — the hourly
 * scheduling fields (specs/resource-hourly-scheduling.md) must survive the save, and be cleared when
 * the resource isn't a per_hour planning resource.
 */
export function toResourcePayload(form) {
  return {
    name: form.name,
    nameEn: (form.nameEn || '').trim(),
    quantity: Number(form.quantity) || 0,
    price: form.priceType === 'free' ? 0 : Number(form.price) || 0,
    priceType: form.priceType || 'per_stay',
    propertyIds: form.propertyIds && form.propertyIds.length > 0 ? form.propertyIds : [],
    propertyPricing: Object.entries(form.propertyPricing || {})
      .reduce((acc, [propertyId, rawPrice]) => {
        const parsedPrice = Number(rawPrice?.price);
        const parsedFreeMinutes = Number(rawPrice?.freeMinutes || 0);
        const hasPrice = Number.isFinite(parsedPrice) && parsedPrice >= 0;
        const freeMinutes = Number.isFinite(parsedFreeMinutes) ? Math.max(0, Math.round(parsedFreeMinutes)) : 0;
        if (hasPrice || freeMinutes > 0) acc[String(propertyId)] = { price: hasPrice ? parsedPrice : 0, freeMinutes };
        return acc;
      }, {}),
    note: form.description || '',
    isComplex: form.isComplex ? 1 : 0,
    slotDuration: form.isComplex ? (Number(form.slotDuration) || 5) : 5,
    minimumUsageMinutes: form.priceType === 'per_hour' ? (Number(form.minimumUsageMinutes) || 60) : 0,
    openTime: form.isComplex ? (form.openTime || '08:00') : '08:00',
    closeTime: form.isComplex ? (form.closeTime || '22:00') : '22:00',
    openDays: JSON.stringify(form.isComplex ? (form.openDays || [0, 1, 2, 3, 4, 5, 6]) : [0, 1, 2, 3, 4, 5, 6]),
    turnoverMinutes: form.isComplex ? (Number(form.turnoverMinutes) || 0) : 0,
    // Hourly scheduling + time-banded grid (specs/resource-hourly-scheduling.md §3.1). Only meaningful
    // for a per_hour resource; cleared otherwise so toggling priceType away resets the planning flag.
    showsPlanningCard: form.priceType === 'per_hour' && form.showsPlanningCard ? 1 : 0,
    hourlyEveningStart: form.priceType === 'per_hour' && form.showsPlanningCard && form.hourlyEveningStart
      ? form.hourlyEveningStart : null,
    hourlyEveningRate: form.priceType === 'per_hour' && form.showsPlanningCard ? (Number(form.hourlyEveningRate) || 0) : 0,
    hourlyExternalDayRate: form.priceType === 'per_hour' && form.showsPlanningCard ? (Number(form.hourlyExternalDayRate) || 0) : 0,
    hourlyExternalEveningRate: form.priceType === 'per_hour' && form.showsPlanningCard ? (Number(form.hourlyExternalEveningRate) || 0) : 0,
  };
}

export default function ResourcesPage({ barCenter }) {
  return (
    <PricedItemsPage
      barCenter={barCenter}
      pageTitle="Ressources"
      itemLabel="ressource"
      emptyForm={emptyResource}
      loadItems={async () => {
        const [items, properties] = await Promise.all([api.getResources(), api.getProperties()]);
        return { items, properties };
      }}
      createItem={(data) => api.createResource(data)}
      updateItem={(id, data) => api.updateResource(id, data)}
      deleteItem={(id, options) => api.deleteResource(id, options)}
      getDeleteImpact={(id) => api.getResourceDeleteImpact(id)}
      fromItem={(item) => ({
        ...item,
        propertyIds: Array.isArray(item.propertyIds) ? item.propertyIds : [],
        propertyPricing: item.propertyPricing && typeof item.propertyPricing === 'object'
          ? item.propertyPricing
          : Object.entries(item.propertyPrices || {}).reduce((acc, [pid, price]) => {
            acc[String(pid)] = { price: Number(price || 0), freeMinutes: 0 };
            return acc;
          }, {}),
        description: item.note || item.description || '',
        isComplex: Boolean(item.isComplex),
        showsPlanningCard: Boolean(item.showsPlanningCard),
        hourlyEveningStart: item.hourlyEveningStart || '',
        hourlyEveningRate: Number(item.hourlyEveningRate || 0),
        hourlyExternalDayRate: Number(item.hourlyExternalDayRate || 0),
        hourlyExternalEveningRate: Number(item.hourlyExternalEveningRate || 0),
        slotDuration: item.slotDuration || 5,
        minimumUsageMinutes: Number(item.minimumUsageMinutes || 0),
        openTime: item.openTime || '08:00',
        closeTime: item.closeTime || '22:00',
        openDays: (() => {
          try {
            if (item.openDays) return JSON.parse(item.openDays);
            const closed = JSON.parse(item.closedDays || '[]');
            return [0, 1, 2, 3, 4, 5, 6].filter((d) => !closed.includes(d));
          } catch {
            return [0, 1, 2, 3, 4, 5, 6];
          }
        })(),
        turnoverMinutes: Number(item.turnoverMinutes || 0),
        // Bilingual devis PDF (specs/devis-english-language.md §3 rule 7).
        nameEn: item.nameEn || '',
      })}
      toPayload={toResourcePayload}
      formNameKey="name"
      formDescriptionKey="description"
      showQuantity={true}
      isDeleteDisabled={(item) => {
        const n = (item.name || '').toLowerCase();
        return n.includes('lit') && (n.includes('bébé') || n.includes('bebe'));
      }}
      getRowSx={(item) => (item.isComplex ? { bgcolor: (t) => alpha(t.palette.info.main, 0.05) } : {})}
      renderExtraFormFields={(form, setForm, { properties }) => (
        <>
          {/* Bilingual devis PDF (specs/devis-english-language.md §3 rule 7 + §6.3). */}
          <TextField
            label="Nom (anglais)"
            value={form.nameEn || ''}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            helperText="Utilisé sur le PDF de devis en anglais. Laisser vide → reprend le nom français."
            fullWidth
          />
          <ComplexResourceFields form={form} setForm={setForm} properties={properties} />
        </>
      )}
    />
  );
}
