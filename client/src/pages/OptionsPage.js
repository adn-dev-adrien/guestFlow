import React from 'react';
import { Box, Button, IconButton, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../api';
import PricedItemsPage from '../components/PricedItemsPage';

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
  priceType: 'per_stay',
  price: 0,
  propertyIds: [],
  optionProgressiveTiers: [],
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
            inputProps={{ min: 1, step: 1 }}
            size="small"
            sx={{ width: 160 }}
          />
          <TextField
            label="Prix unitaire (EUR)"
            type="number"
            value={line.unitPrice}
            onChange={(e) => updateTier(line.participantNumber, { unitPrice: Number(e.target.value || 0) })}
            inputProps={{ min: 0, step: 0.01 }}
            size="small"
            sx={{ width: 190 }}
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
        optionProgressiveTiers: normalizeProgressiveTiers(item.optionProgressiveTiers),
      })}
      toPayload={(form) => ({
        title: form.title,
        description: form.description || '',
        price: form.priceType === 'free' ? 0 : Number(form.price) || 0,
        priceType: form.priceType || 'per_stay',
        optionProgressiveTiers: normalizeProgressiveTiers(form.optionProgressiveTiers),
        propertyIds: form.propertyIds && form.propertyIds.length > 0 ? form.propertyIds : [],
      })}
      formNameKey="title"
      formDescriptionKey="description"
      showQuantity={false}
      isDeleteDisabled={(item) => Boolean(item.autoOptionType)}
      renderExtraFormFields={(form, setForm) => (
        <ProgressivePricingFields form={form} setForm={setForm} />
      )}
    />
  );
}
