import React from 'react';
import {
  Box, Typography, FormControlLabel, TextField, Checkbox,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import api from '../api';
import PricedItemsPage, { PRICE_TYPES } from '../components/PricedItemsPage';
import { usePlugin } from '../hooks/usePlugins';
import { HOURLY_RESOURCES } from '../constants/plugins';
import { useSlot } from '../plugins/sdk';

// Without the hourly-resources plugin, nothing is sold by the hour: « À l'heure » is not offered and
// the resources that have it are hidden (specs/plugins-phase-3c-hourly-resources.md rules 18, 20).
const PRICE_TYPES_WITHOUT_HOURLY = PRICE_TYPES.filter((t) => t.value !== 'per_hour');

const emptyResource = {
  name: '', quantity: 1, price: 0, priceType: 'per_stay', propertyIds: [], description: '',
  propertyPricing: {},
  isComplex: false, slotDuration: 5, minimumUsageMinutes: 0, openTime: '08:00', closeTime: '22:00', openDays: [0, 1, 2, 3, 4, 5, 6], turnoverMinutes: 0,
  // Hourly scheduling + time-banded grid (specs/resource-hourly-scheduling.md §3.1).
  showsPlanningCard: false, hourlyEveningStart: '', hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0,
  // Thermal model (specs/hourly-resource-quantity-and-sas-scheduling.md §3.3). 0 = not applicable.
  heatUpMinutes: 0, heatRetentionMinutes: 0,
};

// The per-property price of any resource. For one sold by the hour, the price is per hour and the
// first hour can be offered.
function PropertyPricingFields({ form, setForm, properties }) {
  const hourly = form.priceType === 'per_hour';
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
      <Typography variant="body2" fontWeight={600}>Prix spécifique par logement (optionnel)</Typography>
      <Typography variant="caption" color="text.secondary">Vide : prix général.</Typography>
      {targetProperties.length === 0 && (
        <Typography variant="caption" color="text.secondary">Aucun logement disponible.</Typography>
      )}
      {targetProperties.map((property) => (
        <Box key={property.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
          <TextField
            label={`Prix ${property.name}${hourly ? ' (EUR/h)' : ''}`}
            type="number"
            size="small"
            value={getPropertyPricingLine(property.id).price}
            onChange={(e) => updatePropertyPrice(property.id, e.target.value)}
            fullWidth
            slotProps={{
              htmlInput: { min: 0, step: '0.01' }
            }}
          />
          {hourly && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={getPropertyPricingLine(property.id).freeMinutes >= 60}
                  onChange={(e) => updatePropertyFirstHourFree(property.id, e.target.checked)}
                />
              }
              label={<Typography variant="caption">1ère heure offerte pour {property.name}</Typography>}
              sx={{ m: 0 }}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}

// What plugins draw under the base fields (specs/plugins-phase-3c-hourly-resources.md rule 21): the
// hourly block of a resource sold by the hour.
function PluginResourceFields({ form, setForm }) {
  const contributions = useSlot('resources.fields').filter((c) => c.appliesTo(form));
  return contributions.map(({ key, pluginId, Component }) => (
    <React.Suspense key={`${pluginId}:${key}`} fallback={null}>
      <Component draft={form} onChange={(patch) => setForm({ ...form, ...patch })} />
    </React.Suspense>
  ));
}

const DEFAULT_HOURLY_SETTINGS = {
  isComplex: 0, slotDuration: 5, minimumUsageMinutes: 0, openTime: '08:00', closeTime: '22:00',
  openDays: JSON.stringify([0, 1, 2, 3, 4, 5, 6]), turnoverMinutes: 0, showsPlanningCard: 0,
  hourlyEveningStart: null, hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0,
  heatUpMinutes: 0, heatRetentionMinutes: 0,
};

function hourlySettings(form) {
  if (form.priceType !== 'per_hour') return DEFAULT_HOURLY_SETTINGS;
  const slotted = Boolean(form.isComplex);
  const card = Boolean(form.showsPlanningCard);
  return {
    isComplex: slotted ? 1 : 0,
    slotDuration: slotted ? (Number(form.slotDuration) || 5) : 5,
    minimumUsageMinutes: Number(form.minimumUsageMinutes) || 60,
    openTime: slotted ? (form.openTime || '08:00') : '08:00',
    closeTime: slotted ? (form.closeTime || '22:00') : '22:00',
    openDays: JSON.stringify(slotted ? (form.openDays || [0, 1, 2, 3, 4, 5, 6]) : [0, 1, 2, 3, 4, 5, 6]),
    turnoverMinutes: slotted ? (Number(form.turnoverMinutes) || 0) : 0,
    showsPlanningCard: card ? 1 : 0,
    hourlyEveningStart: card && form.hourlyEveningStart ? form.hourlyEveningStart : null,
    hourlyEveningRate: card ? (Number(form.hourlyEveningRate) || 0) : 0,
    hourlyExternalDayRate: card ? (Number(form.hourlyExternalDayRate) || 0) : 0,
    hourlyExternalEveningRate: card ? (Number(form.hourlyExternalEveningRate) || 0) : 0,
    heatUpMinutes: Math.max(0, Number(form.heatUpMinutes) || 0),
    heatRetentionMinutes: Math.max(0, Number(form.heatRetentionMinutes) || 0),
  };
}

/**
 * Maps the resource editor form to the API payload. Exported for the unit test — the hourly
 * scheduling fields (specs/resource-hourly-scheduling.md) must survive the save, and be cleared when
 * the resource isn't a per_hour planning resource.
 */
export function toResourcePayload(form) {
  return {
    name: form.name,
    quantity: Number(form.quantity) || 0,
    price: form.priceType === 'free' ? 0 : Number(form.price) || 0,
    priceType: form.priceType || 'per_stay',
    propertyIds: form.propertyIds && form.propertyIds.length > 0 ? form.propertyIds : [],
    propertyPricing: Object.entries(form.propertyPricing || {})
      .reduce((acc, [propertyId, rawPrice]) => {
        const parsedPrice = Number(rawPrice?.price);
        const parsedFreeMinutes = Number(rawPrice?.freeMinutes || 0);
        const hasPrice = Number.isFinite(parsedPrice) && parsedPrice >= 0;
        // A free hour exists only on a resource sold by the hour (rule 4).
        const freeMinutes = form.priceType === 'per_hour' && Number.isFinite(parsedFreeMinutes) ? Math.max(0, Math.round(parsedFreeMinutes)) : 0;
        if (hasPrice || freeMinutes > 0) acc[String(propertyId)] = { price: hasPrice ? parsedPrice : 0, freeMinutes };
        return acc;
      }, {}),
    note: form.description || '',
    // Hours, slots and the planning card are for a resource sold by the hour only
    // (specs/plugins-phase-3c-hourly-resources.md rule 4): cleared otherwise, so switching the price
    // type away leaves no stale setting behind.
    ...hourlySettings(form),
  };
}

export default function ResourcesPage({ barTabs }) {
  const hourlyOn = usePlugin(HOURLY_RESOURCES);
  return (
    <PricedItemsPage
      barTabs={barTabs}
      priceTypes={hourlyOn ? PRICE_TYPES : PRICE_TYPES_WITHOUT_HOURLY}
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
        heatUpMinutes: Number(item.heatUpMinutes || 0),
        heatRetentionMinutes: Number(item.heatRetentionMinutes || 0),
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
          <PropertyPricingFields form={form} setForm={setForm} properties={properties} />
          <PluginResourceFields form={form} setForm={setForm} />
        </>
      )}
    />
  );
}
