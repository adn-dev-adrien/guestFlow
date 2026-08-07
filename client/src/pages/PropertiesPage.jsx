import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Box, Typography, Button, Card, CardContent, CardMedia, CardActions,
  Grid
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PageActionBar from '../components/PageActionBar';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import { useToast } from '../components/DialogProvider';
import useCrudResource from '../hooks/useCrudResource';
import api from '../api';
import { withFrom } from '../utils/navigation';

export default function PropertiesPage() {
  const {
    items: properties,
    loading,
    error: listError,
    reload,
  } = useCrudResource({
    listFn: () => api.getProperties(),
    createFn: (payload) => api.createProperty(payload),
    updateFn: (id, payload) => api.updateProperty(id, payload),
    deleteFn: (id) => api.deleteProperty(id),
  });
  const { showError } = useToast();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const navigate = useNavigate();

  // Error surfaced via the listError state (useCrudResource re-throws) — swallow the rejection.
  useEffect(() => { reload().catch(() => {}); }, [reload]);

  const handleDeleteProperty = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteProperty(deleteTarget.id);
      setDeleteTarget(null);
      reload();
    } catch (e) {
      showError(e.message || 'Impossible de supprimer le logement.');
    }
  };

  const createProperty = () => navigate(withFrom('/properties/new', '/properties'));

  return (
    <Box>
      <PageActionBar
        title="Logements"
        titleOnXs
        actionsBefore={[{
          node: (
            <Button key="create-property" variant="contained" size="small" startIcon={<AddIcon />} onClick={createProperty}>
              Nouveau logement
            </Button>
          ),
        }]}
      />

      {listError && <ErrorAlert message="Impossible de charger les logements." onRetry={() => reload()} sx={{ mb: 3 }} />}
      {loading && <LoadingState label="Chargement des logements…" />}

      {!loading && !listError && properties.length === 0 && (
        <EmptyState
          message="Aucun logement. Créez votre premier logement !"
          actionLabel="Nouveau logement"
          onAction={createProperty}
        />
      )}

      {!loading && !listError && properties.length > 0 && (
        <Grid container spacing={3}>
          {properties.map((p) => (
            <Grid key={p.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card
                sx={{ cursor: 'pointer', transition: 'box-shadow .1s', '&:hover': { boxShadow: 4 } }}
                onClick={() => navigate(withFrom(`/properties/${p.id}`, '/properties'))}
              >
                {p.photo && <CardMedia component="img" height="180" image={p.photo} alt={p.name} sx={{ objectFit: 'cover' }} />}
                <CardContent>
                  <Typography variant="sectionHeader">{p.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {p.maxAdults} adultes · {p.maxChildren} enfants · {p.maxBabies} bébés
                  </Typography>
                </CardContent>
                <CardActions>
                  <Button size="small" onClick={(e) => { e.stopPropagation(); navigate(withFrom(`/properties/${p.id}`, '/properties')); }}>
                    Configurer
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteIcon fontSize="small" />}
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                  >
                    Supprimer
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteProperty}
        title="Supprimer le logement"
        message={deleteTarget ? `Voulez-vous vraiment supprimer "${deleteTarget.name}" ?` : ''}
        confirmLabel="Supprimer"
      />
    </Box>
  );
}
