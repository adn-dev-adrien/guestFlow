import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, TextField, Button, Grid,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import UploadIcon from '@mui/icons-material/Upload';
import api from '../api';

export default function PropertyDetail() {
  const { id } = useParams();
  const [property, setProperty] = useState(null);
  const [allOptions, setAllOptions] = useState([]);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({});
  const [pricingForm, setPricingForm] = useState({ label: '', pricePerNight: 100, startDate: '', endDate: '', minNights: 1 });
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editRuleId, setEditRuleId] = useState(null);
  const [docType, setDocType] = useState('contract');
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState(null);

  const load = useCallback(async () => {
    const [p, opts] = await Promise.all([api.getProperty(id), api.getOptions()]);
    setProperty(p);
    setAllOptions(opts);
    setForm({
      name: p.name, maxAdults: p.maxAdults, maxChildren: p.maxChildren, maxBabies: p.maxBabies,
      depositPercent: p.depositPercent, depositDaysBefore: p.depositDaysBefore, balanceDaysBefore: p.balanceDaysBefore
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleSaveProperty = async () => {
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    await api.updateProperty(id, fd);
    setEditOpen(false);
    load();
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

  const handleOptionToggle = async (optionIds) => {
    await api.updatePropertyOptions(id, optionIds);
    load();
  };

  if (!property) return <Typography>Chargement…</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">{property.name}</Typography>
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>Modifier</Button>
      </Box>

      <Grid container spacing={3}>
        {/* Infos */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Informations</Typography>
              {property.photo && <Box component="img" src={property.photo} alt={property.name} sx={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 2, mb: 2 }} />}
              <Typography>Capacité : {property.maxAdults} adultes, {property.maxChildren} enfants, {property.maxBabies} bébés</Typography>
              <Typography>Acompte : {property.depositPercent}% — {property.depositDaysBefore}j avant le séjour</Typography>
              <Typography>Solde : {property.balanceDaysBefore}j avant le séjour</Typography>
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
                <Table size="small">
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
                        <TableCell>{r.startDate || '—'}</TableCell>
                        <TableCell>{r.endDate || '—'}</TableCell>
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

        {/* Options linkage */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Options disponibles</Typography>
              <FormControl fullWidth>
                <InputLabel>Options</InputLabel>
                <Select
                  multiple
                  value={property.optionIds || []}
                  onChange={(e) => handleOptionToggle(e.target.value)}
                  input={<OutlinedInput label="Options" />}
                  renderValue={(selected) =>
                    selected.map((sid) => allOptions.find((o) => o.id === sid)?.title || sid).join(', ')
                  }
                >
                  {allOptions.map((o) => (
                    <MenuItem key={o.id} value={o.id}>
                      <Checkbox checked={(property.optionIds || []).includes(o.id)} />
                      <ListItemText primary={o.title} secondary={`${o.price}€ / ${o.priceType.replace(/_/g, ' ')}`} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Edit property dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Modifier le logement</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Nom" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label="Max adultes" type="number" value={form.maxAdults || 0} onChange={(e) => setForm({ ...form, maxAdults: e.target.value })} fullWidth />
              <TextField label="Max enfants" type="number" value={form.maxChildren || 0} onChange={(e) => setForm({ ...form, maxChildren: e.target.value })} fullWidth />
              <TextField label="Max bébés" type="number" value={form.maxBabies || 0} onChange={(e) => setForm({ ...form, maxBabies: e.target.value })} fullWidth />
            </Box>
            <TextField label="% acompte" type="number" value={form.depositPercent || 30} onChange={(e) => setForm({ ...form, depositPercent: e.target.value })} fullWidth />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label="Acompte (jours avant)" type="number" value={form.depositDaysBefore || 30} onChange={(e) => setForm({ ...form, depositDaysBefore: e.target.value })} fullWidth />
              <TextField label="Solde (jours avant)" type="number" value={form.balanceDaysBefore || 7} onChange={(e) => setForm({ ...form, balanceDaysBefore: e.target.value })} fullWidth />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSaveProperty}>Enregistrer</Button>
        </DialogActions>
      </Dialog>

      {/* Pricing rule dialog */}
      <Dialog open={pricingOpen} onClose={() => setPricingOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editRuleId ? 'Modifier la règle' : 'Nouvelle règle de tarification'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Label" value={pricingForm.label} onChange={(e) => setPricingForm({ ...pricingForm, label: e.target.value })} fullWidth />
            <TextField label="Prix par nuit (€)" type="number" value={pricingForm.pricePerNight} onChange={(e) => setPricingForm({ ...pricingForm, pricePerNight: e.target.value })} fullWidth />
            <Box sx={{ display: 'flex', gap: 2 }}>
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
    </Box>
  );
}
