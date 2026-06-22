/**
 * SettingsPaymentMethodsSection — « Moyens de paiement » card (specs/direct-payment-method-commission.md §3.1).
 *
 * Self-contained CRUD (the payment-method catalogue lives in its own /payment-methods API, not the global
 * settings form): on mount it loads every method (active + inactive). The operator edits the name, the
 * commission rate (%), the optional commission account + VAT flag, picks the single default (radio), and
 * activates/deactivates or deletes a method. Field edits persist on blur; switches/radios on change.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, CardContent, Stack, Typography, Box, Button, Alert, CircularProgress,
  TextField, Switch, Radio, IconButton, Tooltip, Divider,
} from '@mui/material';
import PaymentsIcon from '@mui/icons-material/Payments';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import api from '../api';

function MethodRow({ method, onPatch, onSetDefault, onToggleActive, onDelete }) {
  const [draft, setDraft] = useState({
    name: method.name,
    commissionPercent: String(method.commissionPercent ?? 0),
    commissionFixed: String(method.commissionFixed ?? 0),
    commissionAccountNumber: method.commissionAccountNumber || '',
  });
  // Re-sync when the upstream row changes (e.g. after a reload).
  useEffect(() => {
    setDraft({
      name: method.name,
      commissionPercent: String(method.commissionPercent ?? 0),
      commissionFixed: String(method.commissionFixed ?? 0),
      commissionAccountNumber: method.commissionAccountNumber || '',
    });
  }, [method.id, method.name, method.commissionPercent, method.commissionFixed, method.commissionAccountNumber]);

  const commit = (field, value) => {
    if (field === 'commissionPercent' && Number(value) === Number(method.commissionPercent)) return;
    if (field === 'commissionFixed' && Number(value) === Number(method.commissionFixed)) return;
    if (field === 'name' && value.trim() === method.name) return;
    if (field === 'commissionAccountNumber' && (value.trim() || null) === (method.commissionAccountNumber || null)) return;
    const numeric = field === 'commissionPercent' || field === 'commissionFixed';
    onPatch(method.id, { [field]: numeric ? Number(value || 0) : value.trim() });
  };

  const inactive = Number(method.isActive) !== 1;
  return (
    <Box sx={{ opacity: inactive ? 0.55 : 1 }}>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.3fr 0.7fr 0.7fr 1fr auto auto auto auto' },
        gap: 1, alignItems: 'center',
      }}>
        <TextField
          label="Nom" size="small" value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          onBlur={(e) => commit('name', e.target.value)}
          fullWidth
        />
        <TextField
          label="Commission %" size="small" type="number" value={draft.commissionPercent}
          onChange={(e) => setDraft((d) => ({ ...d, commissionPercent: e.target.value }))}
          onBlur={(e) => commit('commissionPercent', e.target.value)}
          slotProps={{ htmlInput: { min: 0, max: 99.99, step: 0.05 } }}
          fullWidth
        />
        <TextField
          label="Frais fixe €" size="small" type="number" value={draft.commissionFixed}
          onChange={(e) => setDraft((d) => ({ ...d, commissionFixed: e.target.value }))}
          onBlur={(e) => commit('commissionFixed', e.target.value)}
          slotProps={{ htmlInput: { min: 0, step: 0.05 } }}
          fullWidth
        />
        <TextField
          label="Compte commission" size="small" value={draft.commissionAccountNumber}
          onChange={(e) => setDraft((d) => ({ ...d, commissionAccountNumber: e.target.value }))}
          onBlur={(e) => commit('commissionAccountNumber', e.target.value)}
          placeholder="défaut"
          fullWidth
        />
        <Tooltip title="TVA déductible sur la commission">
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">TVA</Typography>
            <Switch
              size="small" checked={Number(method.hasVatOnCommission) === 1}
              onChange={(e) => onPatch(method.id, { hasVatOnCommission: e.target.checked })}
            />
          </Box>
        </Tooltip>
        <Tooltip title="Moyen de paiement par défaut">
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">Défaut</Typography>
            <Radio
              size="small" checked={Number(method.isDefault) === 1}
              onChange={() => onSetDefault(method.id)}
            />
          </Box>
        </Tooltip>
        <Tooltip title={Number(method.isDefault) === 1 ? 'Le moyen par défaut reste actif' : 'Actif'}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">Actif</Typography>
            <Switch
              size="small" checked={!inactive}
              disabled={Number(method.isDefault) === 1}
              onChange={(e) => onToggleActive(method.id, e.target.checked)}
            />
          </Box>
        </Tooltip>
        <Tooltip title={Number(method.isDefault) === 1 ? 'Le moyen par défaut ne peut pas être supprimé' : 'Supprimer'}>
          <span>
            <IconButton
              size="small" color="error"
              disabled={Number(method.isDefault) === 1}
              onClick={() => onDelete(method)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}

export default function SettingsPaymentMethodsSection() {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [newFixed, setNewFixed] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await api.getPaymentMethods(true);
      setMethods(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.message || 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const patch = async (id, body) => {
    setError('');
    try { await api.updatePaymentMethod(id, body); await refresh(); }
    catch (err) { setError(err?.message || "Échec de l'enregistrement."); }
  };
  const setDefault = async (id) => {
    setError('');
    try { await api.setPaymentMethodDefault(id); await refresh(); }
    catch (err) { setError(err?.message || 'Échec.'); }
  };
  const toggleActive = async (id, active) => {
    setError('');
    try { await api.setPaymentMethodActive(id, active); await refresh(); }
    catch (err) { setError(err?.message || 'Échec.'); }
  };
  const remove = async (method) => {
    setError('');
    try { await api.deletePaymentMethod(method.id); await refresh(); }
    catch (err) { setError(err?.message || 'Suppression impossible.'); }
  };
  const add = async () => {
    if (!newName.trim()) return;
    setError('');
    try {
      await api.createPaymentMethod({
        name: newName.trim(),
        commissionPercent: Number(newRate || 0),
        commissionFixed: Number(newFixed || 0),
      });
      setNewName(''); setNewRate(''); setNewFixed('');
      await refresh();
    } catch (err) {
      setError(err?.message === 'NAME_TAKEN' ? 'Ce nom existe déjà.' : (err?.message || "Ajout impossible."));
    }
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PaymentsIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Moyens de paiement</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Pour les réservations en direct : chaque moyen de paiement porte une commission (frais du
              prestataire CB/SumUp…). Sur la fiche réservation, le moyen choisi par échéance applique sa
              commission et calcule le net perçu.
            </Typography>
          </Box>

          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} /><Typography variant="body2" color="text.secondary">Chargement…</Typography>
            </Box>
          ) : (
            <>
              <Stack spacing={1.5} divider={<Divider flexItem />}>
                {methods.map((m) => (
                  <MethodRow
                    key={m.id} method={m}
                    onPatch={patch} onSetDefault={setDefault} onToggleActive={toggleActive} onDelete={remove}
                  />
                ))}
              </Stack>

              <Divider />
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  label="Nouveau moyen" size="small" value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  sx={{ flex: 1, minWidth: 160 }}
                />
                <TextField
                  label="Commission %" size="small" type="number" value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 99.99, step: 0.05 } }}
                  sx={{ width: 130 }}
                />
                <TextField
                  label="Frais fixe €" size="small" type="number" value={newFixed}
                  onChange={(e) => setNewFixed(e.target.value)}
                  slotProps={{ htmlInput: { min: 0, step: 0.05 } }}
                  sx={{ width: 120 }}
                />
                <Button variant="outlined" startIcon={<AddIcon />} onClick={add} disabled={!newName.trim()}>
                  Ajouter
                </Button>
              </Box>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
