import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, TextField, Button, Grid,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import UploadIcon from '@mui/icons-material/Upload';
import { TIME_OPTIONS } from '../constants/timeOptions';
import { displayDate } from '../utils/formatters';
import { getFromParam, navigateBackWithFrom } from '../utils/navigation';
import ConfirmDialog from '../components/ConfirmDialog';
import api from '../api';

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = getFromParam(location.search);
  const dirtyRef = useRef(false);
  const [navGuardOpen, setNavGuardOpen] = useState(false);
  const pendingNavRef = useRef(null);
  const [property, setProperty] = useState(null);
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [originalForm, setOriginalForm] = useState({});
  const [pricingForm, setPricingForm] = useState({ label: '', pricePerNight: 100, startDate: '', endDate: '', minNights: 1 });
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editRuleId, setEditRuleId] = useState(null);
  const [docType, setDocType] = useState('contract');
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    const p = await api.getProperty(id);
    setProperty(p);
    const initial = {
      name: p.name, maxAdults: p.maxAdults, maxChildren: p.maxChildren, maxBabies: p.maxBabies,
      singleBeds: p.singleBeds ?? 0, doubleBeds: p.doubleBeds ?? 0,
      depositPercent: p.depositPercent, depositDaysBefore: p.depositDaysBefore, balanceDaysBefore: p.balanceDaysBefore,
      defaultCautionAmount: p.defaultCautionAmount ?? 500,
      defaultCheckIn: p.defaultCheckIn || '15:00', defaultCheckOut: p.defaultCheckOut || '10:00', cleaningHours: p.cleaningHours ?? 3
    };
    setForm(initial);
    setOriginalForm(initial);
    setDirty(false);
    setPhotoFile(null);
  }, [id]);

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

  const handleCancel = () => {
    setForm({ ...originalForm });
    setDirty(false);
  };

  const handleSaveProperty = async () => {
    setSaving(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (photoFile) fd.append('photo', photoFile);
    await api.updateProperty(id, fd);
    setDirty(false);
    setSaving(false);
    setPhotoFile(null);
    load();
  };

  const handleDeleteProperty = async () => {
    await api.deleteProperty(id);
    navigateBackWithFrom(navigate, from);
  };

  const handleSavePricing = async () => {
    if (editRuleId) {
      await api.updatePricingRule(id, editRuleId, pricingForm);
    } else {
      await api.addPricingRule(id, pricingForm);
    }
    setPricingOpen(false);
    setEditRuleId(null);
    setPricingForm({ label: '', pricePerNight: 100, startDate: '', endDate: '', minNights: 1 });
    load();
  };

  const handleUploadDoc = async () => {
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

  if (!property) return <Typography>Chargement…</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 3 }}>
        <Typography variant="h4">{property.name}</Typography>
        <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' }, flexDirection: { xs: 'column', sm: 'row' } }}>
          <Button variant="outlined" color="error" onClick={() => setDeleteOpen(true)} sx={{ width: { xs: '100%', sm: 'auto' } }}>Supprimer le logement</Button>
          {dirty && (
            <>
              <Button variant="outlined" onClick={handleCancel} sx={{ width: { xs: '100%', sm: 'auto' } }}>Annuler</Button>
              <Button variant="contained" onClick={handleSaveProperty} disabled={saving} sx={{ width: { xs: '100%', sm: 'auto' } }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>
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
                <TextField label="Nom du logement" value={form.name || ''} onChange={(e) => updateField('name', e.target.value)} fullWidth size="small" />
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Max adultes" type="number" value={form.maxAdults ?? 0} onChange={(e) => updateField('maxAdults', e.target.value)} fullWidth size="small" />
                  <TextField label="Max enfants" type="number" value={form.maxChildren ?? 0} onChange={(e) => updateField('maxChildren', e.target.value)} fullWidth size="small" helperText="2 à 18 ans" />
                  <TextField label="Max bébés" type="number" value={form.maxBabies ?? 0} onChange={(e) => updateField('maxBabies', e.target.value)} fullWidth size="small" helperText="0 à 2 ans" />
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Lits doubles" type="number" value={form.doubleBeds ?? 0} onChange={(e) => updateField('doubleBeds', e.target.value)} fullWidth size="small" inputProps={{ min: 0 }} />
                  <TextField label="Lits simples" type="number" value={form.singleBeds ?? 0} onChange={(e) => updateField('singleBeds', e.target.value)} fullWidth size="small" inputProps={{ min: 0 }} />
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
                <TextField label="Temps de ménage (heures)" type="number" value={form.cleaningHours ?? 3} onChange={(e) => updateField('cleaningHours', e.target.value)} fullWidth size="small" inputProps={{ min: 0, step: 0.5 }} />
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
                <TextField label="% acompte" type="number" value={form.depositPercent ?? 30} onChange={(e) => updateField('depositPercent', e.target.value)} fullWidth size="small" />
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Acompte (jours avant)" type="number" value={form.depositDaysBefore ?? 30} onChange={(e) => updateField('depositDaysBefore', e.target.value)} fullWidth size="small" />
                  <TextField label="Solde (jours avant)" type="number" value={form.balanceDaysBefore ?? 7} onChange={(e) => updateField('balanceDaysBefore', e.target.value)} fullWidth size="small" />
                </Box>
                <TextField label="Caution par défaut (€)" type="number" inputProps={{ step: 50 }} value={form.defaultCautionAmount ?? 500} onChange={(e) => updateField('defaultCautionAmount', e.target.value)} fullWidth size="small" />
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
                <Button size="small" startIcon={<AddIcon />} onClick={() => { setPricingForm({ label: '', pricePerNight: 100, startDate: '', endDate: '', minNights: 1 }); setEditRuleId(null); setPricingOpen(true); }}>
                  Ajouter
                </Button>
              </Box>
              <TableContainer>
                <Table size="small" sx={{ minWidth: 700 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Label</TableCell>
                      <TableCell>Prix/nuit</TableCell>
                      <TableCell>Début</TableCell>
                      <TableCell>Fin</TableCell>
                      <TableCell>Min nuits</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(property.pricingRules || []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell>{r.pricePerNight}€</TableCell>
                        <TableCell>{displayDate(r.startDate)}</TableCell>
                        <TableCell>{displayDate(r.endDate)}</TableCell>
                        <TableCell>{r.minNights}</TableCell>
                        <TableCell>
                          <IconButton size="small" onClick={() => { setPricingForm(r); setEditRuleId(r.id); setPricingOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                          <IconButton size="small" color="error" onClick={async () => { await api.deletePricingRule(id, r.id); load(); }}><DeleteIcon fontSize="small" /></IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!property.pricingRules || property.pricingRules.length === 0) && (
                      <TableRow><TableCell colSpan={6} align="center">Aucune règle de tarification</TableCell></TableRow>
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
                    onDelete={async () => { await api.deleteDocument(id, d.id); load(); }}
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
                <TextField size="small" label="Nom" value={docName} onChange={(e) => setDocName(e.target.value)} />
                <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
                  Fichier
                  <input type="file" hidden onChange={(e) => setDocFile(e.target.files[0])} />
                </Button>
                {docFile && <Typography variant="body2">{docFile.name}</Typography>}
                <Button variant="contained" size="small" onClick={handleUploadDoc} disabled={!docFile}>Envoyer</Button>
              </Box>
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

      {/* Pricing rule dialog */}
      <Dialog open={pricingOpen} onClose={() => setPricingOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editRuleId ? 'Modifier la règle' : 'Nouvelle règle de tarification'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Label" value={pricingForm.label} onChange={(e) => setPricingForm({ ...pricingForm, label: e.target.value })} fullWidth />
            <TextField label="Prix par nuit (€)" type="number" value={pricingForm.pricePerNight} onChange={(e) => setPricingForm({ ...pricingForm, pricePerNight: e.target.value })} fullWidth />
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField label="Date début" type="date" value={pricingForm.startDate || ''} InputLabelProps={{ shrink: true }} onChange={(e) => setPricingForm({ ...pricingForm, startDate: e.target.value })} fullWidth />
              <TextField label="Date fin" type="date" value={pricingForm.endDate || ''} InputLabelProps={{ shrink: true }} onChange={(e) => setPricingForm({ ...pricingForm, endDate: e.target.value })} fullWidth />
            </Box>
            <TextField label="Min nuits" type="number" value={pricingForm.minNights} onChange={(e) => setPricingForm({ ...pricingForm, minNights: e.target.value })} fullWidth />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPricingOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSavePricing}>Enregistrer</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteProperty}
        title="Supprimer le logement"
        message={`Voulez-vous vraiment supprimer "${property.name}" ?`}
        confirmLabel="Supprimer"
      />
    </Box>
  );
}
