import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, TextField, Button, Grid,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import UploadIcon from '@mui/icons-material/Upload';
import SyncIcon from '@mui/icons-material/Sync';
import AddIcon from '@mui/icons-material/Add';
import { TIME_OPTIONS } from '../constants/timeOptions';
import { PLATFORMS, PLATFORM_COLORS } from '../constants/platforms';
import { displayDate } from '../utils/formatters';
import { getFromParam, navigateBackWithFrom, withFrom } from '../utils/navigation';
import ConfirmDialog from '../components/ConfirmDialog';
import api from '../api';

const NEW_DEFAULTS = {
  name: '', maxAdults: 2, maxChildren: 0, maxBabies: 0,
  singleBeds: 0, doubleBeds: 0,
  depositPercent: 30, depositDaysBefore: 30, balanceDaysBefore: 7,
  defaultCautionAmount: 500,
  touristTaxPerDayPerPerson: 0,
  defaultCheckIn: '15:00', defaultCheckOut: '10:00', cleaningHours: 3,
};

const DEFAULT_ICAL_COLOR = '#757575';

const ICAL_PLATFORM_OPTIONS = [
  ...PLATFORMS.map((platform) => ({ value: platform, label: platform, known: true })),
  { value: 'other', label: 'autre', known: false },
];

const EMPTY_ICAL_FORM = {
  id: null,
  url: '',
  platformOption: 'airbnb',
  platformKey: '',
  platformLabel: '',
  platformColor: PLATFORM_COLORS.airbnb || DEFAULT_ICAL_COLOR,
  isActive: true,
};

function getSortedSeasonRanges(rule) {
  const ranges = Array.isArray(rule?.dateRanges) ? rule.dateRanges : [];
  if (ranges.length > 0) {
    return ranges
      .filter((range) => range.startDate && range.endDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  return [{ startDate: rule?.startDate, endDate: rule?.endDate }].filter((range) => range.startDate && range.endDate);
}

export default function PropertyDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const canManageExtras = !isNew;
  const navigate = useNavigate();
  const location = useLocation();
  const from = getFromParam(location.search);
  const dirtyRef = useRef(false);
  const [navGuardOpen, setNavGuardOpen] = useState(false);
  const pendingNavRef = useRef(null);
  const [property, setProperty] = useState(isNew ? { name: 'Nouveau logement', pricingRules: [], documents: [] } : null);
  const [form, setForm] = useState(isNew ? NEW_DEFAULTS : {});
  const [dirty, setDirty] = useState(isNew);
  const [isNameEditing, setIsNameEditing] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [originalForm, setOriginalForm] = useState(isNew ? NEW_DEFAULTS : {});
  const [docType, setDocType] = useState('contract');
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [icalForm, setIcalForm] = useState(EMPTY_ICAL_FORM);
  const [icalSaving, setIcalSaving] = useState(false);
  const [syncingSourceId, setSyncingSourceId] = useState(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const load = useCallback(async () => {
    if (isNew) return;
    const p = await api.getProperty(id);
    setProperty(p);
    const initial = {
      name: p.name, maxAdults: p.maxAdults, maxChildren: p.maxChildren, maxBabies: p.maxBabies,
      singleBeds: p.singleBeds ?? 0, doubleBeds: p.doubleBeds ?? 0,
      depositPercent: p.depositPercent, depositDaysBefore: p.depositDaysBefore, balanceDaysBefore: p.balanceDaysBefore,
      defaultCautionAmount: p.defaultCautionAmount ?? 500,
      touristTaxPerDayPerPerson: p.touristTaxPerDayPerPerson ?? 0,
      defaultCheckIn: p.defaultCheckIn || '15:00', defaultCheckOut: p.defaultCheckOut || '10:00', cleaningHours: p.cleaningHours ?? 3
    };
    setForm(initial);
    setOriginalForm(initial);
    setDirty(false);
    setPhotoFile(null);
  }, [id, isNew]);

  useEffect(() => { load(); }, [load]);

  // Warn on browser close/refresh
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Keep dirtyRef in sync
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Intercept clicks on <a> links to block navigation when dirty
  useEffect(() => {
    const handler = (e) => {
      if (!dirtyRef.current) return;
      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('blob:')) return;
      e.preventDefault();
      e.stopPropagation();
      pendingNavRef.current = href;
      setNavGuardOpen(true);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  // Intercept browser back/forward
  useEffect(() => {
    if (!dirty) return;
    const handler = () => {
      pendingNavRef.current = null;
      setNavGuardOpen(true);
      // push current location back to cancel the pop
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [dirty, location]);

  const handleNavGuardLeave = () => {
    setNavGuardOpen(false);
    const dest = pendingNavRef.current;
    pendingNavRef.current = null;
    dirtyRef.current = false;
    setDirty(false);
    if (dest) navigate(dest);
    else navigateBackWithFrom(navigate, from);
  };

  const handleNavGuardSave = async () => {
    await handleSaveProperty();
    setNavGuardOpen(false);
    const dest = pendingNavRef.current;
    pendingNavRef.current = null;
    if (dest) navigate(dest);
    else navigateBackWithFrom(navigate, from);
  };

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const handleZeroFocus = (e) => {
    if (Number(e.target.value) === 0) {
      requestAnimationFrame(() => e.target.select());
    }
  };

  const handleCancel = () => {
    setForm({ ...originalForm });
    setDirty(false);
  };

  const handleSaveProperty = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (photoFile) fd.append('photo', photoFile);
    if (isNew) {
      const result = await api.createProperty(fd);
      setSaving(false);
      navigate(`/properties/${result.id}`, { replace: true });
    } else {
      await api.updateProperty(id, fd);
      setDirty(false);
      setSaving(false);
      setPhotoFile(null);
      load();
    }
  };

  const handleDeleteProperty = async () => {
    await api.deleteProperty(id);
    navigateBackWithFrom(navigate, from);
  };

  const handleUploadDoc = async () => {
    if (!canManageExtras) return;
    if (!docFile) return;
    const fd = new FormData();
    fd.append('file', docFile);
    fd.append('type', docType);
    fd.append('name', docName || docFile.name);
    await api.uploadDocument(id, fd);
    setDocFile(null);
    setDocName('');
    load();
  };

  const setIcalField = (field, value) => {
    setIcalForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetIcalForm = () => {
    setIcalForm(EMPTY_ICAL_FORM);
  };

  const startEditIcalSource = (source) => {
    const isKnown = Boolean(PLATFORM_COLORS[source.platformKey]);
    setIcalForm({
      id: source.id,
      url: source.url || '',
      platformOption: isKnown ? source.platformKey : 'other',
      platformKey: isKnown ? '' : (source.platformKey || ''),
      platformLabel: source.platformLabel || source.platformKey || '',
      platformColor: source.platformColor || PLATFORM_COLORS[source.platformKey] || DEFAULT_ICAL_COLOR,
      isActive: source.isActive !== 0,
    });
  };

  const handleSaveIcalSource = async () => {
    if (!canManageExtras) return;
    if (!icalForm.url.trim()) return;
    const isOther = icalForm.platformOption === 'other';
    const payload = {
      url: icalForm.url.trim(),
      platformKey: isOther ? icalForm.platformKey.trim() : icalForm.platformOption,
      platformLabel: isOther ? (icalForm.platformLabel.trim() || icalForm.platformKey.trim()) : icalForm.platformOption,
      platformColor: isOther ? (icalForm.platformColor || DEFAULT_ICAL_COLOR) : (PLATFORM_COLORS[icalForm.platformOption] || DEFAULT_ICAL_COLOR),
      isActive: Boolean(icalForm.isActive),
    };
    if (!payload.platformKey) return;

    setIcalSaving(true);
    try {
      if (icalForm.id) {
        await api.updatePropertyIcalSource(id, icalForm.id, payload);
      } else {
        await api.createPropertyIcalSource(id, payload);
      }
      resetIcalForm();
      await load();
    } finally {
      setIcalSaving(false);
    }
  };

  const handleDeleteIcalSource = async (sourceId) => {
    if (!canManageExtras) return;
    await api.deletePropertyIcalSource(id, sourceId);
    if (icalForm.id === sourceId) resetIcalForm();
    await load();
  };

  const handleSyncIcalSource = async (sourceId) => {
    if (!canManageExtras) return;
    setSyncingSourceId(sourceId);
    try {
      await api.syncPropertyIcalSource(id, sourceId);
      await load();
    } finally {
      setSyncingSourceId(null);
    }
  };

  const handleSyncAllIcalSources = async () => {
    if (!canManageExtras) return;
    setSyncingAll(true);
    try {
      await api.syncAllPropertyIcalSources(id);
      await load();
    } finally {
      setSyncingAll(false);
    }
  };

  if (!property) return <Typography>Chargement…</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {isNameEditing ? (
            <TextField
              label="Nom du logement"
              value={form.name || ''}
              onChange={(e) => updateField('name', e.target.value)}
              size="small"
              autoFocus
              sx={{ minWidth: { xs: '100%', sm: 320 } }}
            />
          ) : (
            <Typography variant="h4">{form.name?.trim() || 'Nouveau logement'}</Typography>
          )}
          <IconButton
            size="small"
            onClick={() => setIsNameEditing((prev) => !prev)}
            aria-label={isNameEditing ? 'Valider le nom' : 'Modifier le nom'}
          >
            {isNameEditing ? <CheckIcon fontSize="small" /> : <EditIcon fontSize="small" />}
          </IconButton>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' }, flexDirection: { xs: 'column', sm: 'row' } }}>
          {!isNew && <Button variant="outlined" color="error" onClick={() => setDeleteOpen(true)} sx={{ width: { xs: '100%', sm: 'auto' } }}>Supprimer le logement</Button>}
          {(isNew || dirty) && (
            <>
              {!isNew && <Button variant="outlined" onClick={handleCancel} sx={{ width: { xs: '100%', sm: 'auto' } }}>Annuler</Button>}
              {isNew && <Button variant="outlined" onClick={() => navigateBackWithFrom(navigate, from)} sx={{ width: { xs: '100%', sm: 'auto' } }}>Annuler</Button>}
              <Button variant="contained" onClick={handleSaveProperty} disabled={saving || !form.name?.trim()} sx={{ width: { xs: '100%', sm: 'auto' } }}>{saving ? 'Enregistrement…' : isNew ? 'Créer le logement' : 'Enregistrer'}</Button>
            </>
          )}
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Infos */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Informations</Typography>
              {property.photo && <Box component="img" src={property.photo} alt={property.name} sx={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 2, mb: 2 }} />}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
                    {property.photo ? 'Changer la photo' : 'Ajouter une photo'}
                    <input type="file" hidden accept="image/*" onChange={(e) => { const next = e.target.files?.[0] || null; setPhotoFile(next); if (next) setDirty(true); }} />
                  </Button>
                  {photoFile && <Typography variant="body2" sx={{ mt: 1 }}>{photoFile.name}</Typography>}
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Max adultes" type="number" value={form.maxAdults ?? 0} onChange={(e) => updateField('maxAdults', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
                  <TextField label="Max enfants" type="number" value={form.maxChildren ?? 0} onChange={(e) => updateField('maxChildren', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" helperText="2 à 18 ans" />
                  <TextField label="Max bébés" type="number" value={form.maxBabies ?? 0} onChange={(e) => updateField('maxBabies', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" helperText="0 à 2 ans" />
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Lits doubles" type="number" value={form.doubleBeds ?? 0} onChange={(e) => updateField('doubleBeds', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" inputProps={{ min: 0 }} />
                  <TextField label="Lits simples" type="number" value={form.singleBeds ?? 0} onChange={(e) => updateField('singleBeds', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" inputProps={{ min: 0 }} />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Horaires & Ménage */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Horaires & Ménage</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Heure d'arrivée</InputLabel>
                    <Select value={form.defaultCheckIn || '15:00'} label="Heure d'arrivée" onChange={(e) => updateField('defaultCheckIn', e.target.value)}>
                      {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small">
                    <InputLabel>Heure de départ</InputLabel>
                    <Select value={form.defaultCheckOut || '10:00'} label="Heure de départ" onChange={(e) => updateField('defaultCheckOut', e.target.value)}>
                      {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Box>
                <TextField label="Temps de ménage (heures)" type="number" value={form.cleaningHours ?? 3} onChange={(e) => updateField('cleaningHours', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" inputProps={{ min: 0, step: 0.5 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Acompte & Solde */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Acompte & Solde</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField label="% acompte" type="number" value={form.depositPercent ?? 30} onChange={(e) => updateField('depositPercent', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Acompte (jours avant)" type="number" value={form.depositDaysBefore ?? 30} onChange={(e) => updateField('depositDaysBefore', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
                  <TextField label="Solde (jours avant)" type="number" value={form.balanceDaysBefore ?? 7} onChange={(e) => updateField('balanceDaysBefore', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
                </Box>
                <TextField label="Caution par défaut (€)" type="number" inputProps={{ step: 50 }} value={form.defaultCautionAmount ?? 500} onChange={(e) => updateField('defaultCautionAmount', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Pricing */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Tarification</Typography>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!canManageExtras}
                  onClick={() => navigate(withFrom(`/properties/${id}/pricing-seasons`, `/properties/${id}`))}
                >
                  Gérer les saisons
                </Button>
              </Box>
              <TextField
                label="Taxe de séjour (€/jour/personne)"
                type="number"
                value={form.touristTaxPerDayPerPerson ?? 0}
                onChange={(e) => updateField('touristTaxPerDayPerPerson', e.target.value)}
                onFocus={handleZeroFocus}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.1 }}
                sx={{ mb: 2 }}
              />
              <TableContainer>
                <Table size="small" sx={{ minWidth: 700 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Saison</TableCell>
                      <TableCell>Dates</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Tarif base</TableCell>
                      <TableCell>Min nuits</TableCell>
                      <TableCell>Couleur</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...(property.pricingRules || [])]
                      .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
                      .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                            {getSortedSeasonRanges(r).map((range, index) => (
                              <Typography key={`${r.id}-range-${index}`} variant="body2" sx={{ lineHeight: 1.25 }}>
                                {displayDate(range.startDate)} → {displayDate(range.endDate)}
                              </Typography>
                            ))}
                          </Box>
                        </TableCell>
                        <TableCell>{(r.pricingMode || 'fixed') === 'progressive' ? 'Dégressif' : 'Fixe'}</TableCell>
                        <TableCell>{Number(r.pricePerNight || 0).toFixed(2)}€</TableCell>
                        <TableCell>{r.minNights}</TableCell>
                        <TableCell>
                          <Box sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: r.color || '#1976d2' }} />
                        </TableCell>
                        <TableCell>
                          <Button size="small" onClick={() => navigate(withFrom(`/properties/${id}/pricing-seasons`, `/properties/${id}`))}>
                            Modifier
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!property.pricingRules || property.pricingRules.length === 0) && (
                      <TableRow><TableCell colSpan={7} align="center">Aucune saison tarifaire</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Documents */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Documents</Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {(property.documents || []).map((d) => (
                  <Chip
                    key={d.id}
                    label={`${d.name} (${d.type})`}
                    onDelete={canManageExtras ? async () => { await api.deleteDocument(id, d.id); load(); } : undefined}
                    component="a" href={d.filePath} target="_blank" clickable
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Type</InputLabel>
                  <Select value={docType} label="Type" onChange={(e) => setDocType(e.target.value)}>
                    <MenuItem value="contract">Contrat</MenuItem>
                    <MenuItem value="rules">Règlement</MenuItem>
                    <MenuItem value="other">Autre</MenuItem>
                  </Select>
                </FormControl>
                <TextField size="small" label="Nom" value={docName} onChange={(e) => setDocName(e.target.value)} disabled={!canManageExtras} />
                <Button variant="outlined" component="label" startIcon={<UploadIcon />} disabled={!canManageExtras}>
                  Fichier
                  <input type="file" hidden onChange={(e) => setDocFile(e.target.files[0])} />
                </Button>
                {docFile && <Typography variant="body2">{docFile.name}</Typography>}
                <Button variant="contained" size="small" onClick={handleUploadDoc} disabled={!canManageExtras || !docFile}>Envoyer</Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* iCal Sync */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Typography variant="h6">Connexions iCal</Typography>
                <Button
                  variant="outlined"
                  startIcon={<SyncIcon />}
                  onClick={handleSyncAllIcalSources}
                  disabled={!canManageExtras || syncingAll || !(property.icalSources || []).length}
                >
                  {syncingAll ? 'Synchronisation…' : 'Synchroniser tout'}
                </Button>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 0.7fr 1.8fr auto' }, gap: 1, mb: 1.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Plateforme</InputLabel>
                  <Select
                    value={icalForm.platformOption}
                    label="Plateforme"
                    onChange={(e) => {
                      const next = e.target.value;
                      setIcalField('platformOption', next);
                      if (next !== 'other') {
                        setIcalField('platformColor', PLATFORM_COLORS[next] || DEFAULT_ICAL_COLOR);
                        setIcalField('platformLabel', next);
                      }
                    }}
                    disabled={!canManageExtras}
                  >
                    {ICAL_PLATFORM_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {icalForm.platformOption === 'other' ? (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                      size="small"
                      label="Code plateforme"
                      value={icalForm.platformKey}
                      onChange={(e) => setIcalField('platformKey', e.target.value)}
                      disabled={!canManageExtras}
                      placeholder="ex: vrbo-fr"
                      fullWidth
                    />
                    <TextField
                      type="color"
                      size="small"
                      value={icalForm.platformColor || DEFAULT_ICAL_COLOR}
                      onChange={(e) => setIcalField('platformColor', e.target.value)}
                      disabled={!canManageExtras}
                      sx={{ width: 58 }}
                    />
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="body2" color="text.secondary">Couleur auto</Typography>
                  </Box>
                )}
                <TextField
                  size="small"
                  label="URL iCal"
                  value={icalForm.url}
                  onChange={(e) => setIcalField('url', e.target.value)}
                  disabled={!canManageExtras}
                  placeholder="https://.../calendar.ics"
                />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={handleSaveIcalSource}
                    disabled={!canManageExtras || icalSaving || !icalForm.url.trim()}
                  >
                    {icalSaving ? 'Enregistrement…' : (icalForm.id ? 'Mettre à jour' : 'Ajouter')}
                  </Button>
                  {icalForm.id && (
                    <Button variant="text" onClick={resetIcalForm} disabled={!canManageExtras}>Annuler</Button>
                  )}
                </Box>
              </Box>

              <TableContainer>
                <Table size="small" sx={{ minWidth: 900 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Plateforme</TableCell>
                      <TableCell>URL</TableCell>
                      <TableCell>Dernière synchro</TableCell>
                      <TableCell>État</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(property.icalSources || []).map((source) => {
                      const sourceColor = source.platformColor || PLATFORM_COLORS[source.platformKey] || DEFAULT_ICAL_COLOR;
                      return (
                        <TableRow key={source.id}>
                          <TableCell>
                            <Chip label={source.platformLabel || source.platformKey} size="small" sx={{ bgcolor: sourceColor, color: 'white' }} />
                          </TableCell>
                          <TableCell sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={source.url}>{source.url}</TableCell>
                          <TableCell>{source.lastSyncAt ? displayDate(source.lastSyncAt.slice(0, 10)) : '-'}</TableCell>
                          <TableCell>
                            <Typography variant="caption" color={source.lastSyncStatus === 'error' ? 'error.main' : 'text.secondary'}>
                              {source.lastSyncStatus === 'error' ? (source.lastSyncMessage || 'Erreur') : (source.lastSyncMessage || 'Jamais synchronisé')}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              startIcon={<SyncIcon />}
                              onClick={() => handleSyncIcalSource(source.id)}
                              disabled={!canManageExtras || syncingSourceId === source.id}
                            >
                              {syncingSourceId === source.id ? 'Sync…' : 'Sync'}
                            </Button>
                            <IconButton size="small" onClick={() => startEditIcalSource(source)} disabled={!canManageExtras}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" color="error" onClick={() => handleDeleteIcalSource(source.id)} disabled={!canManageExtras}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(!property.icalSources || property.icalSources.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} align="center">Aucune connexion iCal configurée.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

      </Grid>

      {/* Unsaved changes dialog */}
      <Dialog open={navGuardOpen} onClose={() => setNavGuardOpen(false)}>
        <DialogTitle>Modifications non sauvegardées</DialogTitle>
        <DialogContent>
          <Typography>Vous avez des modifications non sauvegardées. Voulez-vous les sauvegarder avant de quitter ?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleNavGuardLeave} color="error">Quitter sans sauvegarder</Button>
          <Button onClick={() => setNavGuardOpen(false)}>Rester sur la page</Button>
          <Button variant="contained" onClick={handleNavGuardSave}>Sauvegarder et quitter</Button>
        </DialogActions>
      </Dialog>

      {!isNew && <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteProperty}
        title="Supprimer le logement"
        message={`Voulez-vous vraiment supprimer "${property.name}" ?`}
        confirmLabel="Supprimer"
      />}
    </Box>
  );
}
