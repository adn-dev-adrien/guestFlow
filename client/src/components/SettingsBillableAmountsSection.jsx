/**
 * SettingsBillableAmountsSection — « Tarifs facturables » form (Réglages → Tarifs).
 * specs/extinguisher-seal-and-repair-amounts.md; presentational since the phase-3 sweep
 * (specs/ds-sweep-settings.md §3.1 rule 1): BillableAmountsPage owns load/save/dirty/guard and the
 * canonical bar-level « Enregistrer » — this section only renders the two editable lists.
 *
 * Props:
 *   linen:    array   priced-linen items ({ label, price, category: 'bed'|'towel' })
 *   setLinen: (updater) => void
 *   repairs:  array   repair amounts ({ repairKey|null, label, price }) — repairKey rows are locked
 *   setRepairs: (updater) => void
 *   disabled?: bool
 */
import React from 'react';
import {
  Box, Card, CardContent, Stack, Typography, TextField, FormHelperText, Button, IconButton, Divider, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';

export default function SettingsBillableAmountsSection({ linen, setLinen, repairs, setRepairs, disabled = false }) {
  const addLinen = (category) => setLinen((l) => [...l, { label: '', price: 0, category }]);
  const updLinen = (i, f, v) => setLinen((l) => l.map((it, idx) => (idx === i ? { ...it, [f]: v } : it)));
  const delLinen = (i) => setLinen((l) => l.filter((_, idx) => idx !== i));

  const addRepair = () => setRepairs((r) => [...r, { repairKey: null, label: '', price: 0 }]);
  const updRepair = (i, f, v) => setRepairs((r) => r.map((it, idx) => (idx === i ? { ...it, [f]: v } : it)));
  const delRepair = (i) => setRepairs((r) => r.filter((_, idx) => idx !== i));

  const renderLinenRows = (category, label) => {
    const rows = linen.map((it, i) => ({ it, i })).filter(({ it }) => (it.category === 'towel' ? 'towel' : 'bed') === category);
    return (
      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{label}</Typography>
        {rows.length === 0 && <Typography variant="caption" color="text.secondary">Aucun élément.</Typography>}
        {rows.map(({ it, i }) => (
          <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField label="Libellé" size="small" value={it.label} onChange={(e) => updLinen(i, 'label', e.target.value)} sx={{ flex: 1 }} disabled={disabled} />
            <TextField label="Prix (€)" size="small" type="number" value={it.price} onChange={(e) => updLinen(i, 'price', e.target.value)} sx={{ width: 110 }} slotProps={{ htmlInput: { min: 0, step: 0.5 } }} disabled={disabled} />
            <Tooltip title="Supprimer">
              <span>
                <IconButton aria-label="Supprimer" color="error" onClick={() => delLinen(i)} disabled={disabled}><DeleteIcon fontSize="small" /></IconButton>
              </span>
            </Tooltip>
          </Stack>
        ))}
        <Button startIcon={<AddIcon />} size="small" onClick={() => addLinen(category)} disabled={disabled} sx={{ alignSelf: 'flex-start' }}>Ajouter</Button>
      </Stack>
    );
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReceiptLongIcon color="action" />
            <Typography variant="sectionHeader">Tarifs facturables</Typography>
          </Box>
          <FormHelperText sx={{ m: 0 }}>
            Montants pouvant être facturés au client pendant le SAS (check-in / check-out) : prix du linge
            manquant et montants de réparation. Enregistrement via la barre d'actions en haut de page.
          </FormHelperText>

          {/* Prix du linge (moved from the linen-stock page) */}
          <Typography variant="sectionHeader">Prix du linge</Typography>
          <FormHelperText sx={{ m: 0 }}>
            Tarifs proposés dans le SAS pour facturer un élément manquant. Les éléments de lit servent au
            SAS d'arrivée ; les deux catégories au SAS de départ.
          </FormHelperText>
          {renderLinenRows('bed', 'Éléments de linge de lit')}
          <Divider />
          {renderLinenRows('towel', 'Serviettes')}

          <Divider />

          {/* Montants de réparation */}
          <Typography variant="sectionHeader">Montants de réparation</Typography>
          <FormHelperText sx={{ m: 0 }}>
            Facturés en fin de séjour si une réparation est constatée. « Plomb extincteur » est le montant
            utilisé par le contrôle extincteur du SAS.
          </FormHelperText>
          {repairs.length === 0 && <Typography variant="caption" color="text.secondary">Aucun montant.</Typography>}
          {repairs.map((it, i) => {
            const locked = Boolean(it.repairKey);
            return (
              <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField label="Libellé" size="small" value={it.label} onChange={(e) => updRepair(i, 'label', e.target.value)} sx={{ flex: 1 }} disabled={disabled || locked} />
                <TextField label="Prix (€)" size="small" type="number" value={it.price} onChange={(e) => updRepair(i, 'price', e.target.value)} sx={{ width: 110 }} slotProps={{ htmlInput: { min: 0, step: 0.5 } }} disabled={disabled} />
                <Tooltip title="Supprimer">
                  <span>
                    <IconButton aria-label="Supprimer" color="error" onClick={() => delRepair(i)} disabled={disabled || locked}><DeleteIcon fontSize="small" /></IconButton>
                  </span>
                </Tooltip>
              </Stack>
            );
          })}
          <Button startIcon={<AddIcon />} size="small" onClick={addRepair} disabled={disabled} sx={{ alignSelf: 'flex-start' }}>Ajouter</Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
