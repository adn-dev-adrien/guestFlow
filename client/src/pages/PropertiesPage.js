import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Card, CardContent, CardMedia, CardActions,
  Grid
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PageHeader from '../components/PageHeader';
import FormDialog from '../components/FormDialog';
import PropertyFormFields from '../components/PropertyFormFields';
import useCrudResource from '../hooks/useCrudResource';
import api from '../api';

export default function PropertiesPage() {
  const {
    items: properties,
    reload,
    createItem,
  } = useCrudResource({
    listFn: () => api.getProperties(),
    createFn: (payload) => api.createProperty(payload),
    updateFn: (id, payload) => api.updateProperty(id, payload),
    deleteFn: (id) => api.deleteProperty(id),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', maxAdults: 2, maxChildren: 0, maxBabies: 0 });
  const [photoFile, setPhotoFile] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { reload(); }, [reload]);

  const handleSave = async () => {
    const fd = new FormData();
    fd.append('name', form.name);
    fd.append('maxAdults', form.maxAdults);
    fd.append('maxChildren', form.maxChildren);
    fd.append('maxBabies', form.maxBabies);
    if (photoFile) fd.append('photo', photoFile);
    await createItem(fd);
    setOpen(false);
    setForm({ name: '', maxAdults: 2, maxChildren: 0, maxBabies: 0 });
    setPhotoFile(null);
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

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Nouveau logement"
        onSubmit={handleSave}
        submitDisabled={!form.name}
        submitLabel="Créer"
      >
        <PropertyFormFields form={form} setForm={setForm} photoFile={photoFile} setPhotoFile={setPhotoFile} />
      </FormDialog>
    </Box>
  );
}
