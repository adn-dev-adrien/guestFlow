import React, { useEffect, useState } from 'react';
import {
  Box, TextField, TableRow,
  TableCell, IconButton, InputAdornment, Chip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DataPageScaffold from '../components/DataPageScaffold';
import FormDialog from '../components/FormDialog';
import ClientFormFields from '../components/ClientFormFields';
import { useAppDialogs } from '../components/DialogProvider';
import useCrudResource from '../hooks/useCrudResource';
import api from '../api';
import { isValidEmail, isValidPhone } from '../utils/validation';

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
  const emailError = !isValidEmail(form.email);
  const phoneErrors = (form.phoneNumbers || []).map((phone) => !isValidPhone(phone));
  const hasPhoneError = phoneErrors.some(Boolean);

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
    if (emailError || hasPhoneError) return;

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
      <DataPageScaffold
        title="Clients"
        actionLabel="Nouveau client"
        actionIcon={<AddIcon />}
        onAction={() => handleOpen(null)}
        topContent={(
          <TextField
            fullWidth
            placeholder="Rechercher un client (nom, email, téléphone…)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
            size="small"
            variant="outlined"
          />
        )}
        minWidth={860}
        head={(
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Nom</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Prénom</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Téléphone</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Ville</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Notes</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
          </TableRow>
        )}
        hasItems={clients.length > 0}
        emptyColSpan={7}
        emptyText="Aucun client trouvé"
      >
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
      </DataPageScaffold>

      {/* Dialog */}
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? 'Modifier le client' : 'Nouveau client'}
        onSubmit={handleSave}
        submitDisabled={!form.lastName || !form.firstName || emailError || hasPhoneError}
        submitLabel="Enregistrer"
      >
        <ClientFormFields
          form={form}
          setForm={setForm}
          cityOptions={cityOptions}
          emailError={emailError}
          phoneErrors={phoneErrors}
        />
      </FormDialog>
    </Box>
  );
}
