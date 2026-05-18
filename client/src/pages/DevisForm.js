import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Box, Button, Card, CardContent, Stack, TextField, Typography, 
  Autocomplete, FormControl, InputLabel, Select, MenuItem, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip, IconButton
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ClientFormFields from '../components/ClientFormFields';
import FormDialog from '../components/FormDialog';
import FormRow from '../components/FormRow';
import MiniPlanningStrip from '../components/MiniPlanningStrip';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';

const EMPTY_CLIENT = {
  lastName: '', firstName: '', streetNumber: '', street: '', postalCode: '',
  city: '', address: '', phone: '', phoneNumbers: [''], email: '', notes: '',
};

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00`);
  return isNaN(date.getTime()) ? null : date;
}

function diffDays(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return 0;
  return Math.round((end - start) / 86400000);
}

function addDays(dateStr, days) {
  const date = parseDate(dateStr);
  if (!date) return '';
  date.setDate(date.getDate() + days);
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'sent', label: 'Envoyé' },
  { value: 'accepted', label: 'Accepté' },
];

export default function DevisForm({ devisId, onBack, onSaved }) {
  const { confirm, alert } = useAppDialogs();
  const [miniCalendarStart, setMiniCalendarStart] = useState(() => {
    const now = new Date();
    return formatDate(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [miniSelectionAnchor, setMiniSelectionAnchor] = useState('');
  const miniVisibleDays = 7;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [properties, setProperties] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [newClient, setNewClient] = useState(EMPTY_CLIENT);
  const [newClientCityOptions, setNewClientCityOptions] = useState([]);
  const [propertyOptions, setPropertyOptions] = useState([]);
  const [availableResources, setAvailableResources] = useState([]);
  const [pricingQuote, setPricingQuote] = useState(null);
  const [nightlyBreakdown, setNightlyBreakdown] = useState([]);
  const [showNightlyBreakdown, setShowNightlyBreakdown] = useState(false);

  const [form, setForm] = useState({
    clientId: null,
    propertyId: null,
    startDate: '',
    endDate: '',
    adults: 1,
    children: 0,
    teens: 0,
    babies: 0,
    singleBeds: '',
    doubleBeds: '',
    babyBeds: '',
    customPrice: '',
    discountPercent: 0,
    depositAmount: 0,
    depositDueDate: '',
    balanceAmount: 0,
    balanceDueDate: '',
    cautionAmount: 0,
    status: 'draft',
    validUntil: '',
    notes: '',
    selectedOptions: [],
    selectedResources: [],
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [propsData, clientsData] = await Promise.all([
          api.getProperties(),
          api.getClients(),
        ]);
        setProperties(propsData || []);
        setClients(clientsData || []);

        if (devisId) {
          const devis = await api.getDevisById(devisId);
          setForm({
            clientId: devis.clientId,
            propertyId: devis.propertyId,
            startDate: devis.startDate,
            endDate: devis.endDate,
            adults: devis.adults || 1,
            children: devis.children || 0,
            teens: devis.teens || 0,
            babies: devis.babies || 0,
            singleBeds: devis.singleBeds || '',
            doubleBeds: devis.doubleBeds || '',
            babyBeds: devis.babyBeds || '',
            customPrice: devis.customPrice || '',
            discountPercent: devis.discountPercent || 0,
            depositAmount: devis.depositAmount || 0,
            depositDueDate: devis.depositDueDate || '',
            balanceAmount: devis.balanceAmount || 0,
            balanceDueDate: devis.balanceDueDate || '',
            cautionAmount: devis.cautionAmount || 0,
            status: devis.status || 'draft',
            validUntil: devis.validUntil || '',
            notes: devis.notes || '',
            selectedOptions: devis.devis_options || [],
            selectedResources: devis.devis_resources || [],
          });
        }
      } catch (error) {
        alert({ title: 'Erreur', message: error.message || 'Impossible de charger les données.' });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [devisId, alert]);

  const handleLoadPropertyOptions = useCallback(async (propId) => {
    if (!propId) return;
    try {
      const prop = await api.getPropertyById(propId);
      setPropertyOptions(prop.options || []);
      setAvailableResources(prop.resources || []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const handlePropertyChange = (e) => {
    const propId = e.target.value ? Number(e.target.value) : null;
    setForm((prev) => ({ ...prev, propertyId: propId }));
    if (propId) {
      handleLoadPropertyOptions(propId);
    }
  };

  const handleMiniDateClick = useCallback((dateStr) => {
    if (!dateStr) return;

    if (!miniSelectionAnchor || miniSelectionAnchor === dateStr) {
      setMiniSelectionAnchor(dateStr);
      setForm((prev) => ({
        ...prev,
        startDate: dateStr,
        endDate: addDays(dateStr, 1),
      }));
      return;
    }

    const earlier = dateStr < miniSelectionAnchor ? dateStr : miniSelectionAnchor;
    const later = dateStr < miniSelectionAnchor ? miniSelectionAnchor : dateStr;
    setForm((prev) => ({
      ...prev,
      startDate: earlier,
      endDate: addDays(later, 1),
    }));
    setMiniSelectionAnchor('');
  }, [miniSelectionAnchor]);

  const handleMiniRecenter = useCallback(() => {
    if (!form.startDate) return;
    setMiniCalendarStart(addDays(form.startDate, -Math.floor(miniVisibleDays / 2)));
  }, [form.startDate]);

  const handleSave = async () => {
    if (!form.clientId || !form.propertyId || !form.startDate || !form.endDate) {
      alert({ title: 'Erreur', message: 'Veuillez remplir les champs obligatoires.' });
      return;
    }

    setSaving(true);
    try {
      const data = {
        clientId: form.clientId,
        propertyId: form.propertyId,
        startDate: form.startDate,
        endDate: form.endDate,
        adults: Number(form.adults || 1),
        children: Number(form.children || 0),
        teens: Number(form.teens || 0),
        babies: Number(form.babies || 0),
        singleBeds: form.singleBeds,
        doubleBeds: form.doubleBeds,
        babyBeds: form.babyBeds,
        customPrice: form.customPrice ? Number(form.customPrice) : null,
        discountPercent: Number(form.discountPercent || 0),
        depositAmount: Number(form.depositAmount || 0),
        depositDueDate: form.depositDueDate,
        balanceAmount: Number(form.balanceAmount || 0),
        balanceDueDate: form.balanceDueDate,
        cautionAmount: Number(form.cautionAmount || 0),
        status: form.status,
        validUntil: form.validUntil,
        notes: form.notes,
        selectedOptions: form.selectedOptions,
        selectedResources: form.selectedResources,
      };

      if (devisId) {
        await api.updateDevis(devisId, data);
      } else {
        await api.createDevis(data);
      }

      if (onSaved) onSaved();
    } catch (error) {
      alert({ title: 'Erreur', message: error.message || 'Impossible d\'enregistrer le devis.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!devisId) return;
    const ok = await confirm({
      title: 'Supprimer',
      message: 'Êtes-vous sûr ?',
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;

    try {
      await api.deleteDevis(devisId);
      if (onBack) onBack();
    } catch (error) {
      alert({ title: 'Erreur', message: error.message });
    }
  };

  const handleOpenPdf = () => {
    if (!devisId) return;
    window.open(api.getDevisPdfUrl(devisId), '_blank');
  };

  const selectedPropertyObj = properties.find((p) => p.id === form.propertyId);
  const selectedClient = clients.find((c) => c.id === form.clientId);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <IconButton onClick={onBack}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {devisId ? 'Éditer le devis' : 'Nouveau devis'}
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2.5}>
            {/* Client */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Client</Typography>
              <Autocomplete
                options={clients}
                getOptionLabel={(c) => `${c.firstName} ${c.lastName}`}
                value={selectedClient || null}
                onChange={(e, value) => setForm((p) => ({ ...p, clientId: value?.id || null }))}
                disabled={saving}
                renderInput={(params) => <TextField {...params} label="Sélectionner un client" size="small" />}
              />
            </Box>

            {/* Property, Dates */}
            <FormRow label="Logement & Dates" spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Logement</InputLabel>
                <Select
                  value={form.propertyId || ''}
                  label="Logement"
                  onChange={handlePropertyChange}
                  disabled={saving}
                >
                  <MenuItem value="">— Sélectionner —</MenuItem>
                  {properties.map((p) => (
                    <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <MiniPlanningStrip
                miniCalendarStart={miniCalendarStart}
                setMiniCalendarStart={setMiniCalendarStart}
                miniVisibleDays={miniVisibleDays}
                reservations={[]}
                selectedPropertyId={form.propertyId}
                currentReservation={form}
                currentReservationId={null}
                onDateClick={handleMiniDateClick}
                onRecenter={handleMiniRecenter}
                isLocked={saving}
              />
            </FormRow>

            {/* Guests */}
            <FormRow label="Hôtes" spacing={2}>
              {['adults', 'children', 'teens', 'babies'].map((key) => (
                <TextField
                  key={key}
                  label={key === 'adults' ? 'Adultes' : key === 'children' ? 'Enfants' : key === 'teens' ? 'Ados' : 'Bébés'}
                  type="number"
                  value={form[key]}
                  onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                  inputProps={{ min: 0 }}
                  size="small"
                  disabled={saving}
                />
              ))}
            </FormRow>

            {/* Pricing */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Tarification</Typography>
              <FormRow spacing={2}>
                <TextField
                  label="Prix custom (optionnel)"
                  type="number"
                  value={form.customPrice}
                  onChange={(e) => setForm((p) => ({ ...p, customPrice: e.target.value }))}
                  size="small"
                  disabled={saving}
                />
                <TextField
                  label="Réduction %"
                  type="number"
                  value={form.discountPercent}
                  onChange={(e) => setForm((p) => ({ ...p, discountPercent: e.target.value }))}
                  size="small"
                  disabled={saving}
                />
              </FormRow>
            </Box>

            {/* Payment schedule */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Calendrier de paiement</Typography>
              <FormRow spacing={2}>
                <TextField
                  label="Acompte €"
                  type="number"
                  value={form.depositAmount}
                  onChange={(e) => setForm((p) => ({ ...p, depositAmount: e.target.value }))}
                  size="small"
                  disabled={saving}
                />
                <TextField
                  label="Date"
                  type="date"
                  value={form.depositDueDate}
                  onChange={(e) => setForm((p) => ({ ...p, depositDueDate: e.target.value }))}
                  size="small"
                  disabled={saving}
                  InputLabelProps={{ shrink: true }}
                />
              </FormRow>
              <FormRow spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Solde €"
                  type="number"
                  value={form.balanceAmount}
                  onChange={(e) => setForm((p) => ({ ...p, balanceAmount: e.target.value }))}
                  size="small"
                  disabled={saving}
                />
                <TextField
                  label="Date"
                  type="date"
                  value={form.balanceDueDate}
                  onChange={(e) => setForm((p) => ({ ...p, balanceDueDate: e.target.value }))}
                  size="small"
                  disabled={saving}
                  InputLabelProps={{ shrink: true }}
                />
              </FormRow>
              <TextField
                label="Caution €"
                type="number"
                value={form.cautionAmount}
                onChange={(e) => setForm((p) => ({ ...p, cautionAmount: e.target.value }))}
                size="small"
                disabled={saving}
                sx={{ mt: 1 }}
                fullWidth
              />
            </Box>

            {/* Status & Validity */}
            <FormRow spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Statut</InputLabel>
                <Select
                  value={form.status}
                  label="Statut"
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                  disabled={saving}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Valide jusqu'au"
                type="date"
                value={form.validUntil}
                onChange={(e) => setForm((p) => ({ ...p, validUntil: e.target.value }))}
                size="small"
                disabled={saving}
                InputLabelProps={{ shrink: true }}
              />
            </FormRow>

            {/* Notes */}
            <TextField
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              fullWidth
              multiline
              minRows={3}
              disabled={saving}
            />

            {/* Actions */}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={onBack} disabled={saving}>Annuler</Button>
              {devisId && (
                <>
                  <Button
                    startIcon={<PictureAsPdfIcon />}
                    onClick={handleOpenPdf}
                    disabled={saving}
                  >
                    PDF
                  </Button>
                  <Button
                    startIcon={<DeleteIcon />}
                    color="error"
                    onClick={handleDelete}
                    disabled={saving}
                  >
                    Supprimer
                  </Button>
                </>
              )}
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
