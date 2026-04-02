import React, { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, Button, Card, CardContent, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, InputAdornment, Chip, Autocomplete
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import PageHeader from '../components/PageHeader';
import TableCard from '../components/TableCard';
import FormDialog from '../components/FormDialog';
import FormRow from '../components/FormRow';
import { useAppDialogs } from '../components/DialogProvider';
import useCrudResource from '../hooks/useCrudResource';
import api from '../api';

const emptyClient = {
  lastName: '',
  firstName: '',
  streetNumber: '',
  street: '',
  postalCode: '',
  city: '',
  address: '',
  phone: '',
  phoneNumbers: [''],
  email: '',
  notes: ''
};

export default function ClientsPage() {
  const { confirm } = useAppDialogs();
  const {
    items: clients,
    reload,
    createItem,
    updateItem,
    removeItem,
  } = useCrudResource({
    listFn: (q) => api.getClients(q),
    createFn: (payload) => api.createClient(payload),
    updateFn: (id, payload) => api.updateClient(id, payload),
    deleteFn: (id) => api.deleteClient(id),
  });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyClient);
  const [editId, setEditId] = useState(null);
  const [cityOptions, setCityOptions] = useState([]);

  useEffect(() => { reload(search); }, [search, reload]);

  const handleOpen = (client) => {
    if (client) {
      const phones = Array.isArray(client.phoneNumbers) && client.phoneNumbers.length > 0
        ? client.phoneNumbers
        : (client.phone ? [client.phone] : ['']);
      setForm({ ...emptyClient, ...client, phoneNumbers: phones });
      setEditId(client.id);
    } else {
      setForm({ ...emptyClient });
      setEditId(null);
    }
    setOpen(true);
  };

  const handleSave = async () => {
    const normalizedPhones = (form.phoneNumbers || [])
      .map((p) => String(p || '').trim())
      .filter((p) => p !== '');
    const payload = {
      ...form,
      address: [form.streetNumber, form.street].filter(Boolean).join(' ').trim(),
      phoneNumbers: normalizedPhones,
      phone: normalizedPhones[0] || '',
    };
    if (editId) {
      await updateItem(editId, payload, search);
    } else {
      await createItem(payload, search);
    }
    setOpen(false);
  };

  useEffect(() => {
    const cp = (form.postalCode || '').trim();
    if (cp.length < 2) {
      setCityOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const cityQuery = (form.city || '').trim();
        const params = new URLSearchParams({
          codePostal: cp,
          fields: 'nom,code,codesPostaux',
          limit: '20',
        });
        if (cityQuery) params.set('nom', cityQuery);
        const res = await fetch(`https://geo.api.gouv.fr/communes?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        const options = Array.from(new Set((data || []).map((c) => c.nom).filter(Boolean)));
        setCityOptions(options);
      } catch (e) {
        if (e.name !== 'AbortError') setCityOptions([]);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.postalCode, form.city]);

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: 'Supprimer ce client ?'
    });
    if (!ok) return;
    await removeItem(id, search);
  };

  return (
    <Box>
      <PageHeader title="Clients" actionLabel="Nouveau client" actionIcon={<AddIcon />} onAction={() => handleOpen(null)} />

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ py: 1.5 }}>
          <TextField
            fullWidth placeholder="Rechercher un client (nom, email, téléphone…)"
            value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
            size="small" variant="outlined"
          />
        </CardContent>
      </Card>

      <TableCard minWidth={860}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Nom</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Prénom</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Téléphone</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Ville</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Notes</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => handleOpen(c)}>
                  <TableCell>{c.lastName}</TableCell>
                  <TableCell>{c.firstName}</TableCell>
                  <TableCell>{c.email}</TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell>{c.city || '—'}</TableCell>
                  <TableCell>
                    {c.notes && <Chip label={c.notes.substring(0, 30)} size="small" variant="outlined" />}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpen(c); }}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {clients.length === 0 && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>Aucun client trouvé</TableCell></TableRow>
              )}
            </TableBody>
      </TableCard>

      {/* Dialog */}
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? 'Modifier le client' : 'Nouveau client'}
        onSubmit={handleSave}
        submitDisabled={!form.lastName || !form.firstName}
        submitLabel="Enregistrer"
      >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormRow>
              <TextField label="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} fullWidth required />
              <TextField label="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} fullWidth required />
            </FormRow>

            <FormRow>
              <TextField
                label="N°"
                value={form.streetNumber}
                onChange={(e) => setForm({ ...form, streetNumber: e.target.value })}
                sx={{ width: { xs: '100%', sm: 120 } }}
              />
              <TextField
                label="Rue / voie"
                value={form.street}
                onChange={(e) => setForm({ ...form, street: e.target.value })}
                fullWidth
              />
            </FormRow>

            <FormRow>
              <TextField
                label="Code postal"
                value={form.postalCode}
                onChange={(e) => setForm({ ...form, postalCode: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })}
                sx={{ width: { xs: '100%', sm: 170 } }}
              />
              <Autocomplete
                freeSolo
                options={cityOptions}
                value={form.city || ''}
                onInputChange={(_, val) => setForm({ ...form, city: val || '' })}
                renderInput={(params) => <TextField {...params} label="Ville" fullWidth />}
                fullWidth
              />
            </FormRow>

            <TextField label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth />

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {(form.phoneNumbers || ['']).map((p, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    label={idx === 0 ? 'Téléphone principal' : `Téléphone ${idx + 1}`}
                    value={p}
                    onChange={(e) => {
                      const next = [...(form.phoneNumbers || [])];
                      next[idx] = e.target.value;
                      setForm({ ...form, phoneNumbers: next });
                    }}
                    fullWidth
                  />
                  <IconButton
                    color="error"
                    onClick={() => {
                      const next = [...(form.phoneNumbers || [])];
                      next.splice(idx, 1);
                      setForm({ ...form, phoneNumbers: next.length ? next : [''] });
                    }}
                    disabled={(form.phoneNumbers || []).length <= 1}
                  >
                    <RemoveCircleOutlineIcon />
                  </IconButton>
                </Box>
              ))}
              <Button
                variant="text"
                startIcon={<AddCircleOutlineIcon />}
                onClick={() => setForm({ ...form, phoneNumbers: [...(form.phoneNumbers || []), ''] })}
                sx={{ alignSelf: 'flex-start' }}
              >
                Ajouter un autre numéro
              </Button>
            </Box>

            <TextField
              label="Adresse complète"
              value={[form.streetNumber, form.street, form.postalCode, form.city].filter(Boolean).join(' ')}
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth multiline rows={3} />
          </Box>
      </FormDialog>
    </Box>
  );
}
