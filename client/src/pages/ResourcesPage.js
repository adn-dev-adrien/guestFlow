import React from 'react';
import {
  Box, Typography, FormControlLabel, Switch, FormControl, InputLabel, Select, MenuItem,
  TextField, FormGroup, Checkbox
} from '@mui/material';
import api from '../api';
import PricedItemsPage from '../components/PricedItemsPage';

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
  isComplex: false, slotDuration: 60, openTime: '08:00', closeTime: '22:00', closedDays: [],
};

function ComplexResourceFields({ form, setForm }) {
  const closedDays = Array.isArray(form.closedDays) ? form.closedDays : [];
  const toggleDay = (dayNum) => {
    const next = closedDays.includes(dayNum)
      ? closedDays.filter((d) => d !== dayNum)
      : [...closedDays, dayNum];
    setForm({ ...form, closedDays: next });
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
      <FormControlLabel
        control={<Switch checked={Boolean(form.isComplex)} onChange={(e) => setForm({ ...form, isComplex: e.target.checked })} />}
        label={<Typography variant="body2" fontWeight={600}>Ressource à créneaux (bain nordique, salle…)</Typography>}
      />
      {form.isComplex && (
        <Box sx={{ pl: 2, display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '3px solid', borderColor: 'primary.light' }}>
          <FormControl fullWidth size="small">
            <InputLabel>Durée d'un créneau</InputLabel>
            <Select
              value={form.slotDuration || 60}
              label="Durée d'un créneau"
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
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Heure de fermeture"
              type="time"
              size="small"
              value={form.closeTime || '22:00'}
              onChange={(e) => setForm({ ...form, closeTime: e.target.value })}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" gutterBottom display="block">Jours de fermeture</Typography>
            <FormGroup row>
              {DAY_OPTIONS.map((d) => (
                <FormControlLabel
                  key={d.value}
                  control={<Checkbox size="small" checked={closedDays.includes(d.value)} onChange={() => toggleDay(d.value)} />}
                  label={<Typography variant="caption">{d.label}</Typography>}
                  sx={{ mr: 1 }}
                />
              ))}
            </FormGroup>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default function ResourcesPage() {
  return (
    <PricedItemsPage
      pageTitle="Ressources"
      itemLabel="ressource"
      emptyForm={emptyResource}
      loadItems={async () => {
        const [items, properties] = await Promise.all([api.getResources(), api.getProperties()]);
        return { items, properties };
      }}
      createItem={(data) => api.createResource(data)}
      updateItem={(id, data) => api.updateResource(id, data)}
      deleteItem={(id) => api.deleteResource(id)}
      fromItem={(item) => ({
        ...item,
        propertyIds: Array.isArray(item.propertyIds) ? item.propertyIds : [],
        description: item.note || item.description || '',
        isComplex: Boolean(item.isComplex),
        slotDuration: item.slotDuration || 60,
        openTime: item.openTime || '08:00',
        closeTime: item.closeTime || '22:00',
        closedDays: (() => { try { return JSON.parse(item.closedDays || '[]'); } catch { return []; } })(),
      })}
      toPayload={(form) => ({
        name: form.name,
        quantity: Number(form.quantity) || 0,
        price: form.priceType === 'free' ? 0 : Number(form.price) || 0,
        priceType: form.priceType || 'per_stay',
        propertyIds: form.propertyIds && form.propertyIds.length > 0 ? form.propertyIds : [],
        note: form.description || '',
        isComplex: form.isComplex ? 1 : 0,
        slotDuration: form.isComplex ? (Number(form.slotDuration) || 60) : 60,
        openTime: form.isComplex ? (form.openTime || '08:00') : '08:00',
        closeTime: form.isComplex ? (form.closeTime || '22:00') : '22:00',
        closedDays: JSON.stringify(form.isComplex ? (form.closedDays || []) : []),
      })}
      formNameKey="name"
      formDescriptionKey="description"
      showQuantity={true}
      isDeleteDisabled={(item) => {
        const n = (item.name || '').toLowerCase();
        return n.includes('lit') && (n.includes('bébé') || n.includes('bebe'));
      }}
      renderExtraFormFields={(form, setForm) => <ComplexResourceFields form={form} setForm={setForm} />}
    />
  );
}
