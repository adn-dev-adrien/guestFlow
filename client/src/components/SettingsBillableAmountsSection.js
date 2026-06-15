/**
 * SettingsBillableAmountsSection — « Tarifs facturables » (Réglages).
 * specs/extinguisher-seal-and-repair-amounts.md.
 *
 * Self-contained section grouping every amount the operator can bill a guest during the SAS:
 *  - « Prix du linge » — the priced-linen items (lit + serviette), GET/PUT /settings/linen-items
 *    (moved here from the linen-stock page).
 *  - « Montants de réparation » — GET/PUT /settings/repair-amounts; rows carrying a `repairKey`
 *    (e.g. the seeded « Plomb extincteur ») are price-only + non-deletable so the SAS link can't break.
 *
 * Loads its own data + has its own save actions, like SettingsPushNotificationsSection (no coupling to
 * the global settings form).
 */
import React, { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, Stack, Typography, TextField, FormHelperText, Button, IconButton, Divider, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import api from '../api';

export default function SettingsBillableAmountsSection() {
  const [linen, setLinen] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [savingLinen, setSavingLinen] = useState(false);
  const [savingRepairs, setSavingRepairs] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let on = true;
    Promise.all([
      api.getLinenItems().catch(() => []),
      api.getRepairAmounts().catch(() => []),
    ]).then(([l, r]) => {
      if (!on) return;
      setLinen(Array.isArray(l) ? l : []);
      setRepairs(Array.isArray(r) ? r : []);
    });
    return () => { on = false; };
  }, []);

  // ---- linen prices ----
  const addLinen = (category) => setLinen((l) => [...l, { label: '', price: 0, category }]);
  const updLinen = (i, f, v) => setLinen((l) => l.map((it, idx) => (idx === i ? { ...it, [f]: v } : it)));
  const delLinen = (i) => setLinen((l) => l.filter((_, idx) => idx !== i));
  const saveLinen = async () => {
    setSavingLinen(true);
    try {
      const payload = linen
        .filter((it) => String(it.label || '').trim())
        .map((it) => ({ label: String(it.label).trim(), price: Math.max(0, Number(it.price) || 0), category: it.category === 'towel' ? 'towel' : 'bed' }));
      setLinen(await api.updateLinenItems(payload));
      setMsg({ severity: 'success', text: 'Prix du linge enregistrés.' });
    } catch (e) { setMsg({ severity: 'error', text: e.message || "Échec de l'enregistrement." }); }
    finally { setSavingLinen(false); }
  };

  // ---- repair amounts ----
  const addRepair = () => setRepairs((r) => [...r, { repairKey: null, label: '', price: 0 }]);
  const updRepair = (i, f, v) => setRepairs((r) => r.map((it, idx) => (idx === i ? { ...it, [f]: v } : it)));
  const delRepair = (i) => setRepairs((r) => r.filter((_, idx) => idx !== i));
  const saveRepairs = async () => {
    setSavingRepairs(true);
    try {
      const payload = repairs
        .filter((it) => String(it.label || '').trim())
        .map((it) => ({ repairKey: it.repairKey || null, label: String(it.label).trim(), price: Math.max(0, Number(it.price) || 0) }));
      setRepairs(await api.updateRepairAmounts(payload));
      setMsg({ severity: 'success', text: 'Montants de réparation enregistrés.' });
    } catch (e) { setMsg({ severity: 'error', text: e.message || "Échec de l'enregistrement." }); }
    finally { setSavingRepairs(false); }
  };

  const renderLinenRows = (category, label) => {
    const rows = linen.map((it, i) => ({ it, i })).filter(({ it }) => (it.category === 'towel' ? 'towel' : 'bed') === category);
    return (
      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{label}</Typography>
        {rows.length === 0 && <Typography variant="caption" color="text.secondary">Aucun élément.</Typography>}
        {rows.map(({ it, i }) => (
          <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField label="Libellé" size="small" value={it.label} onChange={(e) => updLinen(i, 'label', e.target.value)} sx={{ flex: 1 }} />
            <TextField label="Prix (€)" size="small" type="number" value={it.price} onChange={(e) => updLinen(i, 'price', e.target.value)} sx={{ width: 110 }} slotProps={{ htmlInput: { min: 0, step: 0.5 } }} />
            <IconButton aria-label="Supprimer" color="error" onClick={() => delLinen(i)}><DeleteIcon fontSize="small" /></IconButton>
          </Stack>
        ))}
        <Button startIcon={<AddIcon />} size="small" onClick={() => addLinen(category)} sx={{ alignSelf: 'flex-start' }}>Ajouter</Button>
      </Stack>
    );
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReceiptLongIcon color="action" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Tarifs facturables</Typography>
          </Box>
          <FormHelperText sx={{ m: 0 }}>
            Montants pouvant être facturés au client pendant le SAS (check-in / check-out) : prix du linge
            manquant et montants de réparation.
          </FormHelperText>
          {msg && <Alert severity={msg.severity} onClose={() => setMsg(null)}>{msg.text}</Alert>}

          {/* Prix du linge (moved from the linen-stock page) */}
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Prix du linge</Typography>
          <FormHelperText sx={{ m: 0 }}>
            Tarifs proposés dans le SAS pour facturer un élément manquant. Les éléments de lit servent au
            SAS d'arrivée ; les deux catégories au SAS de départ.
          </FormHelperText>
          {renderLinenRows('bed', 'Éléments de linge de lit')}
          <Divider />
          {renderLinenRows('towel', 'Serviettes')}
          <Box><Button variant="contained" onClick={saveLinen} disabled={savingLinen}>Enregistrer le prix du linge</Button></Box>

          <Divider />

          {/* Montants de réparation */}
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Montants de réparation</Typography>
          <FormHelperText sx={{ m: 0 }}>
            Facturés en fin de séjour si une réparation est constatée. « Plomb extincteur » est le montant
            utilisé par le contrôle extincteur du SAS.
          </FormHelperText>
          {repairs.length === 0 && <Typography variant="caption" color="text.secondary">Aucun montant.</Typography>}
          {repairs.map((it, i) => {
            const locked = Boolean(it.repairKey);
            return (
              <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField label="Libellé" size="small" value={it.label} onChange={(e) => updRepair(i, 'label', e.target.value)} sx={{ flex: 1 }} disabled={locked} />
                <TextField label="Prix (€)" size="small" type="number" value={it.price} onChange={(e) => updRepair(i, 'price', e.target.value)} sx={{ width: 110 }} slotProps={{ htmlInput: { min: 0, step: 0.5 } }} />
                <IconButton aria-label="Supprimer" color="error" onClick={() => delRepair(i)} disabled={locked}><DeleteIcon fontSize="small" /></IconButton>
              </Stack>
            );
          })}
          <Button startIcon={<AddIcon />} size="small" onClick={addRepair} sx={{ alignSelf: 'flex-start' }}>Ajouter</Button>
          <Box><Button variant="contained" onClick={saveRepairs} disabled={savingRepairs}>Enregistrer les montants de réparation</Button></Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
