import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, TextField, TableRow,
  TableCell, IconButton, InputAdornment, Chip, Typography, Divider, CircularProgress
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import HomeIcon from '@mui/icons-material/Home';
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

function getTodayDateKey() {
  return new Date().toISOString().split('T')[0];
}

function sortReservationsByCurrentDate(reservations) {
  const today = getTodayDateKey();

  return [...(reservations || [])].sort((a, b) => {
    const aIsPast = a.endDate < today;
    const bIsPast = b.endDate < today;

    if (aIsPast !== bIsPast) {
      return aIsPast ? 1 : -1;
    }

    if (!aIsPast) {
      const aDistance = Math.abs(new Date(a.startDate) - new Date(today));
      const bDistance = Math.abs(new Date(b.startDate) - new Date(today));
      if (aDistance !== bDistance) return aDistance - bDistance;
      return a.startDate.localeCompare(b.startDate);
    }

    return b.endDate.localeCompare(a.endDate);
  });
}

export default function ClientsPage() {
  const { confirm } = useAppDialogs();
  const navigate = useNavigate();
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
  const [clientReservations, setClientReservations] = useState([]);
  const [clientReservationsLoading, setClientReservationsLoading] = useState(false);
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
      setClientReservations([]);
      setClientReservationsLoading(true);
      api.getReservations({ clientId: client.id })
        .then(data => setClientReservations(sortReservationsByCurrentDate(data || [])))
        .catch(() => setClientReservations([]))
        .finally(() => setClientReservationsLoading(false));
    } else {
      setForm({ ...emptyClient });
      setEditId(null);
      setClientReservations([]);
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

  const handleOpenReservation = (reservation) => {
    setOpen(false);
    navigate(`/reservations/${reservation.id}`);
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
        maxWidth="md"
      >
        <ClientFormFields
          form={form}
          setForm={setForm}
          cityOptions={cityOptions}
          emailError={emailError}
          phoneErrors={phoneErrors}
        />

        {editId && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
              Réservations
            </Typography>
            {clientReservationsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={24} />
              </Box>
            ) : clientReservations.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Aucune réservation</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {clientReservations.map((res, index) => {
                  const today = getTodayDateKey();
                  const isPast = res.endDate < today;
                  const previousReservation = index > 0 ? clientReservations[index - 1] : null;
                  const startsPastSection = isPast && previousReservation && previousReservation.endDate >= today;
                  const nights = Math.round((new Date(res.endDate) - new Date(res.startDate)) / 86400000);
                  const totalGuests = (res.adults || 0) + (res.children || 0) + (res.teens || 0) + (res.babies || 0);
                  const start = new Date(res.startDate);
                  const end = new Date(res.endDate);
                  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
                  return (
                    <Box
                      key={res.id}
                      onClick={() => handleOpenReservation(res)}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        p: 1.5,
                        mt: startsPastSection ? 1.5 : 0,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        cursor: 'pointer',
                        opacity: isPast ? 0.45 : 1,
                        position: 'relative',
                        transition: 'background-color 0.15s',
                        '&::before': startsPastSection ? {
                          content: '"Réservations passées"',
                          position: 'absolute',
                          top: -20,
                          left: 0,
                          fontSize: '0.75rem',
                          color: 'text.secondary',
                          fontWeight: 500,
                        } : undefined,
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {res.propertyName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {fmt(start)} → {fmt(end)} · {nights} nuit{nights > 1 ? 's' : ''}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                        <Chip label={res.platform} size="small" variant="outlined" />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {res.finalPrice ? `${res.finalPrice} €` : '—'}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <HomeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="caption" color="text.secondary">{totalGuests} pers.</Typography>
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </>
        )}
      </FormDialog>
    </Box>
  );
}
