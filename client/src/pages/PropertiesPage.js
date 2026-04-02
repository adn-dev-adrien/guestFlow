import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Card, CardContent, CardMedia, CardActions,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, TextField
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PageHeader from '../components/PageHeader';
import api from '../api';

export default function PropertiesPage() {
  const [properties, setProperties] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', maxAdults: 2, maxChildren: 0, maxBabies: 0 });
  const [photoFile, setPhotoFile] = useState(null);
  const navigate = useNavigate();

  const load = async () => setProperties(await api.getProperties());
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    const fd = new FormData();
    fd.append('name', form.name);
    fd.append('maxAdults', form.maxAdults);
    fd.append('maxChildren', form.maxChildren);
    fd.append('maxBabies', form.maxBabies);
    if (photoFile) fd.append('photo', photoFile);
    await api.createProperty(fd);
    setOpen(false);
    setForm({ name: '', maxAdults: 2, maxChildren: 0, maxBabies: 0 });
    setPhotoFile(null);
    load();
  };

  return (
    <Box>
      <PageHeader title="Logements" actionLabel="Nouveau logement" actionIcon={<AddIcon />} onAction={() => setOpen(true)} />

      <Grid container spacing={3}>
        {properties.map((p) => (
          <Grid item xs={12} sm={6} md={4} key={p.id}>
            <Card sx={{ cursor: 'pointer', '&:hover': { boxShadow: '0 4px 20px rgba(0,0,0,0.12)' } }} onClick={() => navigate(`/properties/${p.id}`)}>
              {p.photo && <CardMedia component="img" height="180" image={p.photo} alt={p.name} sx={{ objectFit: 'cover' }} />}
              <CardContent>
                <Typography variant="h6">{p.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {p.maxAdults} adultes · {p.maxChildren} enfants · {p.maxBabies} bébés
                </Typography>
              </CardContent>
              <CardActions>
                <Button size="small" onClick={(e) => { e.stopPropagation(); navigate(`/properties/${p.id}`); }}>
                  Configurer
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
        {properties.length === 0 && (
          <Grid item xs={12}>
            <Card><CardContent><Typography align="center" color="text.secondary">Aucun logement. Créez votre premier logement!</Typography></CardContent></Card>
          </Grid>
        )}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nouveau logement</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Nom du logement" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField label="Max adultes" type="number" value={form.maxAdults} onChange={(e) => setForm({ ...form, maxAdults: e.target.value })} fullWidth />
              <TextField label="Max enfants" type="number" value={form.maxChildren} onChange={(e) => setForm({ ...form, maxChildren: e.target.value })} fullWidth helperText="2 à 18 ans" />
              <TextField label="Max bébés" type="number" value={form.maxBabies} onChange={(e) => setForm({ ...form, maxBabies: e.target.value })} fullWidth helperText="0 à 2 ans" />
            </Box>
            <Button variant="outlined" component="label">
              Ajouter une photo
              <input type="file" hidden accept="image/*" onChange={(e) => setPhotoFile(e.target.files[0])} />
            </Button>
            {photoFile && <Typography variant="body2">{photoFile.name}</Typography>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.name}>Créer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
