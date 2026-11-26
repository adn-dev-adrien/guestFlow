/**
 * Pratique — the shops, services and waste points around the estate (specs/guest-app/guest-app-local-amenities.md rules 14-16). One list for
 * every lodging, grouped by category with its count (a category with nothing published says « masquée aux clients »),
 * a publish switch per place, those not verified for 12 months first and flagged « À revérifier », and the estate's
 * position that the map and the 15 km check start from. Adding and editing go through a dialog; every refusal comes
 * from the server and is shown under its field.
 */
import { useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import ConfirmDialog from '@guestflow/components/ConfirmDialog';
import StudioPage from '../components/StudioPage';
import Section from '../components/Section';
import PlaceDialog from '../components/PlaceDialog';
import { useLoad } from '../hooks/useLoad';
import { api } from '../services/api';

const bar = <PageActionBar title="Pratique" subtitle={<Chip size="small" label="Tous les logements" />} />;

function EstatePosition({ estate, onSaved }) {
  const [value, setValue] = useState(estate.position);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ estatePosition: value });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      id="estate"
      title="Position du domaine"
      description={`Le repère de la carte, et le centre des ${estate.maxKm} km dans lesquels un lieu peut se trouver.`}
    >
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TextField
          label="Position du domaine"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={Boolean(error)}
          helperText={error || 'Latitude et longitude, ou un lien Google Maps qui les contient.'}
          sx={{ minWidth: 260, flex: 1 }}
        />
        <Button variant="outlined" onClick={save} disabled={busy || value === estate.position} sx={{ minHeight: 56 }}>Enregistrer la position</Button>
      </Box>
    </Section>
  );
}

function PlaceRow({ place, onEdit, onDelete, onPublish }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 1, alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{place.nameFr}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{place.commune} · {place.driveLabel} · {place.verifiedLabel}</Typography>
        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
          {place.needsReview ? <Chip size="small" color="warning" label="À revérifier" /> : null}
          {!place.published ? <Chip size="small" label="Masqué" /> : null}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Tooltip title={place.published ? 'Publié' : 'Masqué aux clients'}>
          <Switch checked={place.published} onChange={(e) => onPublish(place, e.target.checked)} slotProps={{ input: { 'aria-label': `Publier ${place.nameFr}` } }} />
        </Tooltip>
        <Tooltip title="Modifier">
          <IconButton aria-label={`Modifier ${place.nameFr}`} onClick={() => onEdit(place)} sx={{ width: 44, height: 44 }}><EditOutlinedIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Supprimer">
          <IconButton aria-label={`Supprimer ${place.nameFr}`} onClick={() => onDelete(place)} sx={{ width: 44, height: 44 }}><DeleteOutlineIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

export default function PlacesPage() {
  const list = useLoad(() => api.places(), []);
  const [editing, setEditing] = useState(undefined);
  const [removing, setRemoving] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  if (!list.data) {
    return <StudioPage bar={bar}>{list.error ? <ErrorAlert message={list.error.message} onRetry={list.reload} /> : <LoadingState />}</StudioPage>;
  }
  const {
    groups, estate, categories, wasteKinds, accepts, energies, reviewCount,
  } = list.data;

  const save = async (body) => {
    if (editing) await api.savePlace(editing.id, body);
    else await api.createPlace(body);
    setEditing(undefined);
    setNotice('Enregistré.');
    await list.reload();
  };
  const publish = async (place, published) => {
    setError(null);
    try {
      await api.savePlace(place.id, { published });
      await list.reload();
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async () => {
    const place = removing;
    setRemoving(null);
    setError(null);
    try {
      await api.deletePlace(place.id);
      setNotice('Lieu supprimé.');
      await list.reload();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <StudioPage bar={bar}>
      {error ? <ErrorAlert message={error} /> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert> : null}
      <EstatePosition key={estate.position} estate={estate} onSaved={() => { setNotice('Position enregistrée.'); list.reload(); }} />
      <Section
        id="places"
        title="Lieux autour du domaine"
        description="Une seule liste pour tous les logements. Une catégorie sans lieu publié n’apparaît pas chez les clients."
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)} sx={{ minHeight: 44 }}>Ajouter un lieu</Button>}
      >
        {reviewCount ? <Alert severity="warning">{reviewCount > 1 ? `${reviewCount} lieux n’ont pas été vérifiés depuis 12 mois` : '1 lieu n’a pas été vérifié depuis 12 mois'} : ils sont en tête de leur catégorie. Enregistrer un lieu le marque vérifié aujourd’hui.</Alert> : null}
        {groups.map((g) => (
          <Box key={g.key} role="group" aria-label={g.label}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', pt: 1 }}>
              <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>{g.label}</Typography>
              <Chip size="small" variant="outlined" label={g.count} aria-label={`${g.count} lieu${g.count > 1 ? 'x' : ''}`} />
              {g.hiddenFromGuests ? <Chip size="small" color="warning" variant="outlined" label="masquée aux clients" /> : null}
            </Box>
            {g.places.map((p) => <PlaceRow key={p.id} place={p} onEdit={setEditing} onDelete={setRemoving} onPublish={publish} />)}
          </Box>
        ))}
      </Section>
      <PlaceDialog
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        place={editing || null}
        categories={categories}
        wasteKinds={wasteKinds}
        accepts={accepts}
        energies={energies}
        communes={estate.communes}
        onSave={save}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Supprimer ce lieu ?"
        message={removing ? `« ${removing.nameFr} » disparaît de la carte des clients.` : ''}
        confirmLabel="Supprimer"
      />
    </StudioPage>
  );
}
