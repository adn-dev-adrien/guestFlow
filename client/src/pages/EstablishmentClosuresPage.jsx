import React, { useEffect, useRef, useState } from 'react';
import {
  Box, IconButton, TextField, TableHead, TableBody, TableRow, TableCell,
  Tooltip, MenuItem, Alert, Typography, Button, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { frFR } from '@mui/x-date-pickers/locales';
import dayjs from 'dayjs';
import PageActionBar from '../components/PageActionBar';
import TableCard from '../components/TableCard';
import FormDialog from '../components/FormDialog';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import ConflictList from '../components/ConflictList';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';
import { displayDate } from '../utils/formatters';

function isoToDayjs(iso) {
  if (!iso) return null;
  const d = dayjs(iso);
  return d.isValid() ? d : null;
}
function dayjsToIso(d) {
  return d && d.isValid && d.isValid() ? d.format('YYYY-MM-DD') : '';
}

const ALL_PROPERTIES = 'ALL';

// specs/payment-link-lifecycle.md rules 40, 41, 49 — the headlines of the dialog's conflict lines.
const CONFLICT_TITLES = {
  reservations: 'Réservation sur ces dates : fermeture impossible.',
  requests: 'Demande de paiement en cours sur ces dates.',
  devis: 'Devis en cours sur ces dates.',
};
const NO_CONFLICTS = { reservations: [], requests: [], devis: [] };
// The refusals of a save that come with their list: the list is the message.
const LISTED_REFUSALS = { RESERVATION_OVERLAP: 'reservations', OPEN_PAYMENT_REQUEST: 'requests' };

const EMPTY_FORM = {
  propertyId: ALL_PROPERTIES,
  label: 'Fermeture établissement',
  startDate: '',
  endDate: '',
};

export default function EstablishmentClosuresPage({ barTabs }) {
  const { confirm, alert } = useAppDialogs();
  const phone = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [closures, setClosures] = useState([]);
  const [properties, setProperties] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [dialogError, setDialogError] = useState('');
  const [saving, setSaving] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [conflicts, setConflicts] = useState(NO_CONFLICTS);
  // The save refused for open requests: their line then says what to do (rule 41).
  const [requestsRefusal, setRequestsRefusal] = useState('');
  const [conflictsToken, setConflictsToken] = useState(0);
  const conflictsSeq = useRef(0);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [closuresList, propsList] = await Promise.all([
        api.getEstablishmentClosures(),
        api.getProperties(),
      ]);
      setClosures(closuresList || []);
      setProperties(propsList || []);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Rules 41, 49 — as soon as the logement and both dates are set, the server says what the closure would
  // meet. Asked again when the operator comes back to this tab (a request withdrawn on the devis meanwhile).
  const rangeSet = Boolean(form.startDate && form.endDate && form.startDate < form.endDate);
  useEffect(() => {
    setRequestsRefusal('');
    if (!dialogOpen || !rangeSet) { setConflicts(NO_CONFLICTS); return undefined; }
    const seq = ++conflictsSeq.current;
    api.getClosureConflicts({
      propertyId: form.propertyId === ALL_PROPERTIES ? null : Number(form.propertyId),
      startDate: form.startDate,
      endDate: form.endDate,
    }).then((answer) => {
      if (seq === conflictsSeq.current) setConflicts({ ...NO_CONFLICTS, ...(answer || {}) });
    }).catch(() => {
      // The save is the judge: a failed look only leaves the lines out.
      if (seq === conflictsSeq.current) setConflicts(NO_CONFLICTS);
    });
    // Rule 62 — an answer still in flight belongs to dates the dialog no longer shows.
    return () => { conflictsSeq.current += 1; };
  }, [dialogOpen, rangeSet, form.propertyId, form.startDate, form.endDate, conflictsToken]);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const again = () => { if (document.visibilityState !== 'hidden') setConflictsToken((t) => t + 1); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [dialogOpen]);

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setDialogError('');
    setEndDateOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      propertyId: row.propertyId == null ? ALL_PROPERTIES : String(row.propertyId),
      label: row.label || 'Fermeture établissement',
      startDate: row.startDate || '',
      endDate: row.endDate || '',
    });
    setDialogError('');
    setEndDateOpen(false);
    setDialogOpen(true);
  };

  const submitDisabled = !form.startDate || !form.endDate || form.startDate >= form.endDate || saving;

  const handleSave = async () => {
    setSaving(true);
    setDialogError('');
    const payload = {
      propertyId: form.propertyId === ALL_PROPERTIES ? null : Number(form.propertyId),
      label: form.label,
      startDate: form.startDate,
      endDate: form.endDate,
    };
    try {
      if (editId) {
        await api.updateEstablishmentClosure(editId, payload);
      } else {
        await api.createEstablishmentClosure(payload);
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      const listed = err && LISTED_REFUSALS[err.code];
      if (listed && Array.isArray(err[listed])) {
        setConflicts((prev) => ({ ...prev, [listed]: err[listed] }));
        if (listed === 'requests') setRequestsRefusal(err.error || '');
      } else {
        setDialogError(err.error || err.message || "Impossible d'enregistrer cette fermeture.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: 'Supprimer cette période de fermeture ?',
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.deleteEstablishmentClosure(id);
      await load();
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message || 'Impossible de supprimer cette fermeture.' });
    }
  };

  const propertyNameById = (id) => {
    const p = properties.find((x) => Number(x.id) === Number(id));
    return p ? p.name : `#${id}`;
  };

  return (
    <Box>
      <PageActionBar
        tabs={barTabs}
        title={phone ? 'Fermetures' : "Fermetures de l'établissement"}
        actionsBefore={[{
          node: (
            <Button key="add-closure" variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
              {phone ? 'Ajouter' : 'Ajouter une fermeture'}
            </Button>
          ),
        }]}
      />

      <Box sx={{ maxWidth: { xs: '100%', md: 920, lg: 1200 }, mx: 'auto', px: { xs: 0, sm: 1 } }}>
        {loadError && <ErrorAlert message="Impossible de charger les fermetures." onRetry={load} sx={{ mb: 2 }} />}
        {loading && !loadError && <LoadingState label="Chargement des fermetures…" />}
        {!loading && !loadError && closures.length === 0 && (
          <EmptyState message="Aucune fermeture configurée." py={4} />
        )}
        {!loading && !loadError && closures.length > 0 && (
        <TableCard minWidth={760}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Libellé</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Début</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Fin</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {closures.map((row) => (
              <TableRow
                key={row.id}
                hover
                onClick={() => openEdit(row)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  {row.propertyId == null ? (
                    <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                      Tous les logements
                    </Typography>
                  ) : (
                    row.propertyName || propertyNameById(row.propertyId)
                  )}
                </TableCell>
                <TableCell>{row.label || 'Fermeture établissement'}</TableCell>
                <TableCell>{displayDate(row.startDate)}</TableCell>
                <TableCell>{displayDate(row.endDate)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Supprimer">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
                      aria-label="Supprimer"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
        )}
      </Box>

      <FormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editId ? 'Modifier la fermeture' : 'Ajouter une fermeture'}
        onSubmit={handleSave}
        submitDisabled={submitDisabled}
        submitLabel={saving ? 'Enregistrement…' : 'Enregistrer'}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {dialogError && <Alert severity="error">{dialogError}</Alert>}
          <TextField
            select
            label="Logement concerné"
            value={form.propertyId}
            onChange={(e) => setForm((prev) => ({ ...prev, propertyId: e.target.value }))}
            fullWidth
            helperText="« Tous les logements » pour une fermeture globale."
          >
            <MenuItem value={ALL_PROPERTIES}>Tous les logements</MenuItem>
            {properties.map((p) => (
              <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Libellé"
            value={form.label}
            onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
            fullWidth
          />
          <LocalizationProvider
            dateAdapter={AdapterDayjs}
            adapterLocale="fr"
            localeText={frFR.components.MuiLocalizationProvider.defaultProps.localeText}
          >
            <DatePicker
              label="Début de fermeture"
              value={isoToDayjs(form.startDate)}
              onChange={(value) => setForm((prev) => ({ ...prev, startDate: dayjsToIso(value) }))}
              onAccept={(value) => {
                const iso = dayjsToIso(value);
                const nextDayIso = value && value.isValid()
                  ? value.add(1, 'day').format('YYYY-MM-DD')
                  : '';
                setForm((prev) => ({
                  ...prev,
                  startDate: iso,
                  // Pre-fill the reopening date with start+1 (= one closed day)
                  // whenever it's empty or no longer valid (≤ new start).
                  endDate: (!prev.endDate || prev.endDate <= iso) ? nextDayIso : prev.endDate,
                }));
                setEndDateOpen(true);
              }}
              format="DD/MM/YYYY"
              slotProps={{ textField: { fullWidth: true } }}
            />
            <DatePicker
              label="Réouverture"
              open={endDateOpen}
              onOpen={() => setEndDateOpen(true)}
              onClose={() => setEndDateOpen(false)}
              value={isoToDayjs(form.endDate)}
              onChange={(value) => setForm((prev) => ({ ...prev, endDate: dayjsToIso(value) }))}
              minDate={form.startDate ? dayjs(form.startDate).add(1, 'day') : undefined}
              format="DD/MM/YYYY"
              slotProps={{
                textField: {
                  fullWidth: true,
                  helperText: 'Premier jour à nouveau disponible. Ex : du 15 au 16 = un seul jour fermé (le 15).',
                },
              }}
            />
          </LocalizationProvider>
          <ConflictList
            severity="error"
            title={CONFLICT_TITLES.reservations}
            items={conflicts.reservations.map((r) => ({ ...r, key: `r${r.id}` }))}
            newTab={!phone}
          />
          <ConflictList
            severity="warning"
            groups={[
              { title: requestsRefusal || CONFLICT_TITLES.requests, items: conflicts.requests.map((r) => ({ ...r, key: `l${r.linkId}` })) },
              { title: CONFLICT_TITLES.devis, items: conflicts.devis.map((d) => ({ ...d, key: `d${d.reservationId}` })) },
            ]}
            newTab={!phone}
          />
        </Box>
      </FormDialog>
    </Box>
  );
}
