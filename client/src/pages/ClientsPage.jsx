import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Box, Button, Divider, FormControl, InputLabel, MenuItem, Select, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import HomeIcon from '@mui/icons-material/Home';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import DataPageScaffold from '../components/DataPageScaffold';
import PageTabs from '../components/PageTabs';
import FormDialog from '../components/FormDialog';
import PlatformChip from '../components/PlatformChip';
import StatusBadge from '../components/StatusBadge';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import SearchField from '../components/SearchField';
import GroupedList from '../components/GroupedList';
import ClientDirectoryRow from '../components/ClientDirectoryRow';
import ClientFormFields from '../components/ClientFormFields';
import ClientCleanupDialog from '../components/ClientCleanupDialog';
import useCrudResource from '../hooks/useCrudResource';
import api from '../api';
import { isValidEmail, isValidPhone } from '../utils/validation';
import { withFrom } from '../utils/navigation';
import { formatCurrency } from '../utils/formatters';
import { useToast, useAppDialogs } from '../components/DialogProvider';
import { localIsoToday } from '../utils/isoDay';
import {
  VIEWS, SORTS, TEXTS, viewFromParam, paramFromView, viewLabel,
} from '../constants/clientsDirectory';

const DEVIS_STATUS = {
  draft: { status: 'neutral', label: 'Brouillon' },
  sent: { status: 'info', label: 'Envoyé' },
  accepted: { status: 'success', label: 'Accepté' },
  converted: { status: 'success', label: 'Converti' },
};

const emptyClient = {
  lastName: '',
  firstName: '',
  streetNumber: '',
  street: '',
  postalCode: '',
  city: '',
  address: '',
  phone: '',
  email: '',
  notes: '',
  emailLanguage: 'fr',
  postStayEmailsDisabled: 0,
};

function getTodayDateKey() {
  return localIsoToday();
}

function formatStayDates(startDate, endDate) {
  const fmt = (value) => new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt(new Date(startDate))} -> ${fmt(new Date(endDate))}`;
}

export default function ClientsPage() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const { confirm } = useAppDialogs();
  const [urlParams, setUrlParams] = useSearchParams();
  // specs/clients-upcoming-past-directory.md rules 11-21 — views, groups, labels, counts and ordering
  // all come from the server; the page holds the view (in the URL), the search and the sort.
  const view = viewFromParam(urlParams.get('vue'));
  const [sortKey, setSortKey] = useState('stayDate');
  const [directory, setDirectory] = useState(null);
  const [pending, setPending] = useState(0);
  const latestRequest = useRef(0);
  const latestItems = useRef([]);
  const {
    items: clients,
    loading,
    error: listError,
    reload,
    createItem,
    updateItem,
  } = useCrudResource({
    listFn: async (params) => {
      latestRequest.current += 1;
      const mine = latestRequest.current;
      setPending((n) => n + 1);
      try {
        const res = await api.getClientsDirectory(params);
        if (mine !== latestRequest.current) return latestItems.current;
        latestItems.current = (res?.groups || []).flatMap((g) => g.items);
        setDirectory(res);
        return latestItems.current;
      } catch (err) {
        // A superseded request's failure is nobody's business any more.
        if (mine !== latestRequest.current) return latestItems.current;
        throw err;
      } finally {
        setPending((n) => n - 1);
      }
    },
    createFn: (payload) => api.createClient(payload),
    updateFn: (id, payload) => api.updateClient(id, payload),
    deleteFn: (id) => api.deleteClient(id),
  });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const listParams = { q: debouncedSearch, view, sort: sortKey };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyClient);
  const [editId, setEditId] = useState(null);
  const [cityOptions, setCityOptions] = useState([]);
  const [clientReservations, setClientReservations] = useState([]);
  const [clientReservationsLoading, setClientReservationsLoading] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState({
    open: false,
    clientId: null,
    clientName: '',
    reservations: [],
    devis: [],
    loading: false,
    error: '',
  });
  const [cleanupDialog, setCleanupDialog] = useState({ open: false, orphans: [], loading: false, busy: false });
  const emailError = !isValidEmail(form.email);
  const phoneError = !isValidPhone(form.phone);

  // The failure is surfaced through the scaffold's error state (useCrudResource re-throws); swallow
  // the rejection here so it doesn't bubble as an unhandled promise rejection.
  useEffect(() => {
    reload(listParams).catch(() => {});
  }, [debouncedSearch, view, sortKey, reload]);

  // The view lives in the URL (rule 12) so « Retour » from a fiche and a shared link land on the same list.
  const handleViewChange = (next) => {
    const nextParams = new URLSearchParams(urlParams);
    const param = paramFromView(next);
    if (param) nextParams.set('vue', param);
    else nextParams.delete('vue');
    setUrlParams(nextParams, { replace: true });
  };
  const counts = directory?.counts || { upcoming: 0, past: 0, none: 0 };
  const viewTabs = (
    <PageTabs
      value={view}
      onChange={handleViewChange}
      items={VIEWS.map((v) => ({
        value: v.value,
        label: v.label,
        badge: (
          <Box component="span" sx={{ px: 0.75, borderRadius: 99, bgcolor: 'grey.200', color: 'text.secondary', fontSize: '0.75rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {` ${counts[v.value]}`}
          </Box>
        ),
      }))}
      ariaLabel={TEXTS.tabsLabel}
    />
  );

  const setClientParam = (clientId) => {
    const nextParams = new URLSearchParams(urlParams);
    nextParams.delete('deleteClientId');
    if (clientId) nextParams.set('clientId', String(clientId));
    else nextParams.delete('clientId');
    setUrlParams(nextParams, { replace: true });
  };

  const setDeleteClientParam = (clientId) => {
    const nextParams = new URLSearchParams(urlParams);
    nextParams.delete('clientId');
    if (clientId) nextParams.set('deleteClientId', String(clientId));
    else nextParams.delete('deleteClientId');
    setUrlParams(nextParams, { replace: true });
  };

  const handleOpen = (client) => {
    if (client) {
      setForm({ ...emptyClient, ...client });
      setEditId(client.id);
      setClientParam(client.id);
      setClientReservations([]);
      setClientReservationsLoading(true);
      // Server-shaped (sorted + nights) reservations for this client.
      api.getClientDeleteImpact(client.id)
        .then((impact) => setClientReservations(impact?.reservations || []))
        .catch(() => setClientReservations([]))
        .finally(() => setClientReservationsLoading(false));
    } else {
      setForm({ ...emptyClient });
      setEditId(null);
      setClientReservations([]);
      setClientParam(null);
    }
    setOpen(true);
  };

  const handleCloseDialog = () => {
    setOpen(false);
    setClientParam(null);
  };

  // « Supprimer » inside the client sheet: close the sheet and hand over to the same confirmation
  // dialog the list's trash icon opens — one deletion path, one impact review.
  const handleDeleteFromSheet = () => {
    if (!editId) return;
    setOpen(false);
    handleDelete(editId);
  };

  const handleSave = async () => {
    if (emailError || phoneError) return;

    const payload = {
      ...form,
      address: [form.streetNumber, form.street].filter(Boolean).join(' ').trim(),
      phone: String(form.phone || '').trim(),
    };
    if (editId) {
      await updateItem(editId, payload, listParams);
    } else {
      try {
        await createItem(payload, listParams);
      } catch (err) {
        // specs/clients.md rule 12 — the email or phone already belongs to a client.
        if (err?.code !== 'CLIENT_EXISTS') throw err;
        const proceed = await confirm({
          title: 'Client existant',
          message: err.message,
          confirmLabel: 'Créer quand même',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return;
        await createItem({ ...payload, allowDuplicate: true }, listParams);
      }
    }
    handleCloseDialog();
  };

  // 2026-06-06 bug fix — the URL-watch effect must NOT re-open the dialog while the
  // user is interacting with it. The original effect had `open` in its deps and
  // checked `open` directly, which produced this race on Save (and on Cancel via a
  // similar path):
  //   1. user clicks "Enregistrer" → `handleSave` awaits `updateItem(...)`
  //   2. `updateItem` calls `reload()` internally → `clients` state changes → effect
  //      re-runs because `clients` is in deps → `open` is still true → guard passes
  //   3. `await` returns → `handleCloseDialog` runs → `setOpen(false)` +
  //      `setClientParam(null)` (router-driven, async-ish)
  //   4. React re-renders. Effect sees `open=false` + stale `?clientId=6` (router
  //      hasn't flushed yet) → calls `handleOpen(clientToOpen)` → dialog re-opens
  //   5. URL never clears (`handleOpen` immediately re-sets `?clientId=6`)
  // Refactor: track the LAST clientId the effect actually acted on; bail when the
  // current URL clientId matches it. When the URL clears (`?clientId` removed by the
  // close handler), reset the ref so a fresh manual click on the same row still
  // opens the dialog.
  const lastHandledClientIdRef = useRef(0);
  useEffect(() => {
    const clientIdFromUrl = Number(urlParams.get('clientId') || 0);
    const deleteClientIdFromUrl = Number(urlParams.get('deleteClientId') || 0);
    // URL cleared (close path): reset the "last handled" so a future re-click on the
    // same row re-opens normally.
    if (!clientIdFromUrl) {
      lastHandledClientIdRef.current = 0;
      return;
    }
    if (deleteClientIdFromUrl) return;
    if (!directory) return;
    // Already opened (or attempted to open) this client during the current URL state:
    // don't re-open just because `clients` was reloaded after a save.
    if (clientIdFromUrl === lastHandledClientIdRef.current) return;
    lastHandledClientIdRef.current = clientIdFromUrl;
    const clientToOpen = clients.find((c) => c.id === clientIdFromUrl);
    if (clientToOpen) {
      handleOpen(clientToOpen);
    } else {
      // The client belongs to another view than the one on screen (a link from a fiche).
      api.getClient(clientIdFromUrl).then(handleOpen).catch(() => setClientParam(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParams, clients, directory]);

  // 2026-09-25 bug fix — same race as the `clientId` effect above, on the deletion side. Keying the
  // effect on `deleteImpact.open` alone let it re-open the dialog it had just closed: the router
  // flushes its own URL update a render after `setDeleteImpact`, so React saw « dialog closed but
  // ?deleteClientId=12 still there » and re-ran `handleDelete`. On Annuler the dialog never closed;
  // on Confirmer the re-opened dialog asked the server about a client that no longer existed and
  // showed « Client non trouvé » — the deletion looking like it had already happened. Track the id
  // last acted on (set by the effect AND by a direct click) and reset it when the URL clears.
  const lastHandledDeleteClientIdRef = useRef(0);
  useEffect(() => {
    const deleteClientIdFromUrl = Number(urlParams.get('deleteClientId') || 0);
    if (!deleteClientIdFromUrl) {
      lastHandledDeleteClientIdRef.current = 0;
      return;
    }
    if (deleteClientIdFromUrl === lastHandledDeleteClientIdRef.current) return;
    handleDelete(deleteClientIdFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParams, clients]);

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
    const client = clients.find((c) => c.id === id);
    lastHandledDeleteClientIdRef.current = id;
    setDeleteClientParam(id);
    setDeleteImpact({
      open: true,
      clientId: id,
      clientName: client ? `${client.firstName} ${client.lastName}`.trim() : `Client #${id}`,
      reservations: [],
      devis: [],
      loading: true,
      error: '',
    });

    try {
      const impact = await api.getClientDeleteImpact(id);
      const impactClient = impact?.client;
      setDeleteImpact((prev) => ({
        ...prev,
        clientName: impactClient ? `${impactClient.firstName} ${impactClient.lastName}`.trim() : prev.clientName,
        reservations: impact?.reservations || [],
        devis: impact?.devis || [],
        loading: false,
      }));
    } catch (error) {
      setDeleteImpact((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || 'Impossible de charger les éléments associés.',
      }));
    }
  };

  const closeDeleteImpact = () => {
    setDeleteClientParam(null);
    setDeleteImpact({ open: false, clientId: null, clientName: '', reservations: [], devis: [], loading: false, error: '' });
  };

  const handleForceDeleteClient = async () => {
    if (!deleteImpact.clientId || deleteImpact.loading || deleteImpact.error) return;
    setDeleteImpact((prev) => ({ ...prev, loading: true }));
    try {
      await api.deleteClient(deleteImpact.clientId, { force: true });
      closeDeleteImpact();
      await reload(listParams);
    } catch (error) {
      setDeleteImpact((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || 'Une erreur est survenue pendant la suppression.',
      }));
    }
  };

  // The list the operator came from (rule 12): the view is kept when a fiche sends them back here.
  const clientsUrl = (extra) => {
    const params = new URLSearchParams(extra || {});
    const param = paramFromView(view);
    if (param) params.set('vue', param);
    const qs = params.toString();
    return qs ? `/clients?${qs}` : '/clients';
  };

  const openReservationFromClients = (reservationId, clientIdFromReservation = null, source = 'client') => {
    const targetClientId = editId || clientIdFromReservation || deleteImpact.clientId;
    const fromUrl = clientsUrl(targetClientId && { [source === 'delete' ? 'deleteClientId' : 'clientId']: targetClientId });
    if (source === 'client') {
      setOpen(false);
    }
    navigate(withFrom(`/reservations/${reservationId}`, fromUrl));
  };

  const openDevisFromClients = (devisId) => {
    const targetClientId = deleteImpact.clientId || editId;
    const fromUrl = clientsUrl(targetClientId && { deleteClientId: targetClientId });
    navigate(withFrom(`/reservations/new?mode=devis&devisId=${devisId}`, fromUrl));
  };

  // Renders a server-shaped (already sorted, with `nights`) list of the client's reservations.
  const renderReservationRows = (reservations, onOpenReservation = null) => {
    const today = getTodayDateKey();
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {(reservations || []).map((res, index) => {
          const isPast = res.endDate < today;
          const previousReservation = index > 0 ? reservations[index - 1] : null;
          const startsPastSection = isPast && previousReservation && previousReservation.endDate >= today;
          const nights = res.nights;
          const totalGuests = (res.adults || 0) + (res.children || 0) + (res.teens || 0) + (res.babies || 0);
          return (
            <Box
              key={res.id}
              onClick={onOpenReservation ? () => onOpenReservation(res) : undefined}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                mt: startsPastSection ? 1.5 : 0,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                cursor: onOpenReservation ? 'pointer' : 'default',
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
                '&:hover': onOpenReservation ? { bgcolor: 'action.hover' } : undefined,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {res.propertyName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatStayDates(res.startDate, res.endDate)} · {nights} nuit{nights > 1 ? 's' : ''}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                <PlatformChip platform={res.platform} />
                <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {res.finalPrice ? formatCurrency(res.finalPrice) : '—'}
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
    );
  };

  // Renders the client's devis (server-shaped) shown in the deletion-impact dialog.
  const renderDevisRows = (devisList) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {(devisList || []).map((d) => (
        <Box
          key={d.id}
          onClick={() => openDevisFromClients(d.id)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            p: 1.5,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            cursor: 'pointer',
            transition: 'background-color 0.15s',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Devis {d.devisNumber || `#${d.id}`} · {d.propertyName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatStayDates(d.startDate, d.endDate)} · {d.nights} nuit{d.nights > 1 ? 's' : ''}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <StatusBadge {...(DEVIS_STATUS[d.status] || { status: 'neutral', label: d.status })} />
            <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {d.finalPrice ? formatCurrency(d.finalPrice) : '—'}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );

  const handleOpenReservation = (reservation) => {
    openReservationFromClients(reservation.id, reservation.clientId, 'client');
  };

  // Open the selective cleanup popup: fetch the orphan list, then show the dialog.
  // The legacy bulk `cleanupOrphanClients()` API stays available but the UI no longer calls it.
  const handleCleanupOrphanClients = async () => {
    setCleanupDialog({ open: true, orphans: [], loading: true, busy: false });
    try {
      const { orphans = [] } = await api.getOrphanClientsPreview();
      setCleanupDialog({ open: true, orphans, loading: false, busy: false });
    } catch (error) {
      setCleanupDialog({ open: false, orphans: [], loading: false, busy: false });
      showError(error?.message || 'Impossible de charger la liste des clients à supprimer.');
    }
  };

  const handleCleanupClose = () => {
    setCleanupDialog((prev) => (prev.busy ? prev : { ...prev, open: false }));
  };

  const handleCleanupConfirm = async (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    setCleanupDialog((prev) => ({ ...prev, busy: true }));
    try {
      const result = await api.cleanupOrphanClientsByIds(ids);
      setCleanupDialog({ open: false, orphans: [], loading: false, busy: false });
      await reload(listParams);
      const deleted = Number(result?.deletedCount || 0);
      const skipped = Number(result?.skippedCount || 0);
      const skippedSuffix = skipped > 0
        ? ` · ${skipped} client(s) ignoré(s) car ils ont gagné une réservation entre-temps.`
        : '';
      showSuccess(`${deleted} client(s) supprimé(s).${skippedSuffix}`);
    } catch (error) {
      setCleanupDialog((prev) => ({ ...prev, busy: false }));
      showError(error?.message || 'Impossible de supprimer les clients sélectionnés.');
    }
  };

  const groups = directory?.groups || [];
  const orphanCount = directory?.orphanCount || 0;
  const elsewhere = directory?.elsewhere;

  const emptyList = (() => {
    if (search.trim()) {
      if (!elsewhere) return <EmptyState message={TEXTS.noMatchAnywhere} py={5} />;
      return (
        <EmptyState
          message={TEXTS.noMatchIn(viewLabel(view))}
          actionLabel={TEXTS.switchTo(elsewhere.count, viewLabel(elsewhere.view))}
          onAction={() => handleViewChange(elsewhere.view)}
          py={5}
        />
      );
    }
    if (view === 'upcoming') {
      return (
        <EmptyState
          message={TEXTS.emptyUpcoming}
          actionLabel={counts.past > 0 ? TEXTS.seePast(counts.past) : undefined}
          onAction={() => handleViewChange('past')}
          py={5}
        />
      );
    }
    return <EmptyState message={view === 'past' ? TEXTS.emptyPast : TEXTS.emptyNone} py={5} />;
  })();

  const listBody = (
    <Box aria-busy={pending > 0} sx={{ opacity: pending > 0 ? 0.6 : 1, transition: 'opacity 150ms' }}>
      {view === 'none' && orphanCount > 0 && (
        <Box
          sx={(t) => ({
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap',
            px: 2, py: 1.25, mb: 1.5, borderRadius: '14px', bgcolor: t.palette.warning.soft, color: t.palette.warning.text,
          })}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{TEXTS.orphanStrip(orphanCount)}</Typography>
          <Button variant="outlined" color="warning" size="small" startIcon={<DeleteSweepIcon />} onClick={handleCleanupOrphanClients}>
            {TEXTS.cleanup}
          </Button>
        </Box>
      )}
      <GroupedList
        groups={groups}
        renderItem={(client) => <ClientDirectoryRow client={client} onOpen={handleOpen} />}
        empty={(
          <Box sx={{ bgcolor: 'background.paper', borderRadius: '14px', boxShadow: '0 1px 2px rgba(39,37,31,.06), 0 4px 14px rgba(39,37,31,.05)' }}>
            {emptyList}
          </Box>
        )}
      />
    </Box>
  );

  return (
    <Box>
      <DataPageScaffold
        title="Clients"
        barTabs={viewTabs}
        actionLabel="Nouveau client"
        actionIcon={<AddIcon />}
        onAction={() => handleOpen(null)}
        topContent={(
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexDirection: { xs: 'column', sm: 'row' } }}>
            <SearchField
              label={TEXTS.searchLabel}
              value={search}
              onChange={setSearch}
              sx={{ flex: 1, width: { xs: '100%', sm: 'auto' } }}
            />
            <FormControl size="small" sx={{ minWidth: 190, width: { xs: '100%', sm: 'auto' } }}>
              <InputLabel id="clients-sort-label">{TEXTS.sortLabel}</InputLabel>
              <Select
                labelId="clients-sort-label"
                label={TEXTS.sortLabel}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                sx={{ borderRadius: 3, bgcolor: 'background.paper' }}
              >
                {SORTS.map((o) => <MenuItem key={o.value} value={o.value}>{o.value === 'stayDate' && view === 'none' ? TEXTS.sortByCreation : o.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>
        )}
        loading={loading && !directory}
        error={listError}
        onRetry={() => reload(listParams)}
        body={listBody}
      />
      {/* Dialog */}
      <FormDialog
        open={open}
        onClose={handleCloseDialog}
        title={editId ? 'Modifier le client' : 'Nouveau client'}
        onSubmit={handleSave}
        submitDisabled={!form.lastName || !form.firstName || emailError || phoneError}
        submitLabel="Enregistrer"
        maxWidth="md"
        secondaryAction={editId ? (
          <Button size="small" startIcon={<DeleteIcon />} onClick={handleDeleteFromSheet} color="error" variant="outlined">
            Supprimer
          </Button>
        ) : null}
      >
        <ClientFormFields
          form={form}
          setForm={setForm}
          cityOptions={cityOptions}
          emailError={emailError}
          phoneError={phoneError}
        />

        {editId && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="sectionHeader" sx={{ mb: 1.5 }}>
              Réservations
            </Typography>
            {clientReservationsLoading ? (
              <LoadingState py={2} />
            ) : clientReservations.length === 0 ? (
              <EmptyState message="Aucune réservation." py={2} />
            ) : (
              renderReservationRows(clientReservations, handleOpenReservation)
            )}
          </>
        )}
      </FormDialog>
      <FormDialog
        open={deleteImpact.open}
        onClose={closeDeleteImpact}
        title="Confirmer la suppression du client"
        maxWidth="md"
        submitLabel="Confirmer la suppression"
        submitColor="error"
        onSubmit={handleForceDeleteClient}
        submitDisabled={deleteImpact.loading || !!deleteImpact.error}
      >
        <Typography sx={{ mb: 1.5 }}>
          Attention: la suppression du client <strong>{deleteImpact.clientName}</strong> supprimera aussi toutes ses réservations et devis associés.
        </Typography>
        {deleteImpact.loading ? (
          <LoadingState py={2} />
        ) : deleteImpact.error ? (
          <ErrorAlert message={deleteImpact.error} />
        ) : (
          <Box sx={{ maxHeight: 420, overflowY: 'auto', pr: 0.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1 }}>
                Réservations qui seront supprimées ({deleteImpact.reservations.length})
              </Typography>
              {deleteImpact.reservations.length === 0 ? (
                <EmptyState message="Aucune réservation associée." py={2} />
              ) : (
                renderReservationRows(deleteImpact.reservations, (reservation) => openReservationFromClients(reservation.id, reservation.clientId, 'delete'))
              )}
            </Box>
            <Box>
              <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1 }}>
                Devis qui seront supprimés ({deleteImpact.devis.length})
              </Typography>
              {deleteImpact.devis.length === 0 ? (
                <EmptyState message="Aucun devis associé." py={2} />
              ) : (
                renderDevisRows(deleteImpact.devis)
              )}
            </Box>
          </Box>
        )}
      </FormDialog>

      <ClientCleanupDialog
        open={cleanupDialog.open}
        orphans={cleanupDialog.orphans}
        onClose={handleCleanupClose}
        onConfirm={handleCleanupConfirm}
        busy={cleanupDialog.busy}
      />
    </Box>
  );
}
