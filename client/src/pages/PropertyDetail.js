import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, TextField, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, InputLabel, Select, MenuItem, Switch, FormControlLabel,
  Tooltip, useMediaQuery, useTheme
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import UploadIcon from '@mui/icons-material/Upload';
import SyncIcon from '@mui/icons-material/Sync';
import AddIcon from '@mui/icons-material/Add';
import PlatformColorPicker from '../components/PlatformColorPicker';
import { TIME_OPTIONS } from '../constants/timeOptions';
import { PLATFORM_COLORS, normalizePlatformKey } from '../constants/platforms';
import { displayDate } from '../utils/formatters';
import { getFromParam, navigateBackWithFrom, withFrom } from '../utils/navigation';
import ConfirmDialog from '../components/ConfirmDialog';
import IcalExportCard from '../components/IcalExportCard';
import api from '../api';

// Article options for "votre séjour <article> <name>" in client emails (mirrors the server's
// formatPropertyWithArticle: the apostrophe form elides, the others get a space).
const NAME_ARTICLES = ['au', 'à la', "à l'", 'aux'];
// Exported for non-regression unit tests (pages/__tests__/PropertyDetail.helpers.test.js).
export function previewWithArticle(name, article) {
  const n = String(name || '').trim();
  if (!n) return '';
  const a = article || 'au';
  return a.endsWith("'") ? `${a}${n}` : `${a} ${n}`;
}

const NEW_DEFAULTS = {
  name: '', nameArticle: 'au', maxAdults: 2, maxChildren: 0, maxBabies: 0,
  basePriceIncludedGuests: 0,
  extraGuestPrice: 0,
  singleBeds: 0, doubleBeds: 0,
  depositPercent: 30, depositDaysBefore: 30, balanceDaysBefore: 7,
  defaultCautionAmount: 500,
  touristTaxPerDayPerPerson: 0,
  touristTaxMode: 'per_day_per_person',
  touristTaxPercentage: 0,
  touristTaxDepartmentPercentage: 0,
  touristTaxFixedAmount: 0,
  defaultCheckIn: '15:00', defaultCheckOut: '10:00', cleaningHours: 3,
};

const DEFAULT_ICAL_COLOR = '#757575';

const SUPPORTED_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_PHOTO_FORMATS_TEXT = 'Formats pris en charge: JPG, JPEG, PNG, WEBP.';

export function getSortedSeasonRanges(rule) {
  const ranges = Array.isArray(rule?.dateRanges) ? rule.dateRanges : [];
  if (ranges.length > 0) {
    return ranges
      .filter((range) => range.startDate && range.endDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  return [{ startDate: rule?.startDate, endDate: rule?.endDate }].filter((range) => range.startDate && range.endDate);
}

export function normalizeTimedOptionForSnapshot(option) {
  if (!option) return null;
  return {
    id: Number(option.id || 0) || null,
    autoEnabled: Boolean(option.autoEnabled),
    autoPricingMode: option.autoPricingMode || 'fixed',
    autoFullNightThreshold: option.autoFullNightThreshold || null,
    price: Number(option.price || 0),
  };
}

export function buildTimedOptionsSnapshot(options) {
  return JSON.stringify({
    early: normalizeTimedOptionForSnapshot(options?.early),
    late: normalizeTimedOptionForSnapshot(options?.late),
  });
}

export default function PropertyDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const canManageExtras = !isNew;
  const navigate = useNavigate();
  const location = useLocation();
  const from = getFromParam(location.search);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const dirtyRef = useRef(false);
  const [navGuardOpen, setNavGuardOpen] = useState(false);
  const pendingNavRef = useRef(null);
  const [property, setProperty] = useState(isNew ? { name: 'Nouveau logement', pricingRules: [], documents: [] } : null);
  const [form, setForm] = useState(isNew ? NEW_DEFAULTS : {});
  const [dirty, setDirty] = useState(isNew);
  const [isNameEditing, setIsNameEditing] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [originalForm, setOriginalForm] = useState(isNew ? NEW_DEFAULTS : {});
  const [docType, setDocType] = useState('contract');
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoValidationError, setPhotoValidationError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Plateformes & iCal (specs/platforms-and-ical-rework.md): the merged list (built-ins ∪ DB +
  // this property's source config + global colour) drives the whole section.
  const [platformRows, setPlatformRows] = useState([]);
  const [editingKey, setEditingKey] = useState(null);
  const [editDraft, setEditDraft] = useState({ url: '', collectsTouristTax: true });
  const [savingKey, setSavingKey] = useState(null);
  const [busyKey, setBusyKey] = useState(null);     // tax/disable toggle or single sync in flight
  const [syncingAll, setSyncingAll] = useState(false);
  const [addingPlatform, setAddingPlatform] = useState(false);
  const [newPlatformName, setNewPlatformName] = useState('');
  const [timedOptions, setTimedOptions] = useState({ early: null, late: null });
  const [initialTimedOptions, setInitialTimedOptions] = useState({ early: null, late: null });
  const [timedOptionsSaving, setTimedOptionsSaving] = useState(false);
  const timedOptionsDirty = useMemo(
    () => buildTimedOptionsSnapshot(timedOptions) !== buildTimedOptionsSnapshot(initialTimedOptions),
    [timedOptions, initialTimedOptions]
  );
  const pageDirty = dirty || timedOptionsDirty;

  const load = useCallback(async () => {
    if (isNew) return;
    const [p, allOptions] = await Promise.all([api.getProperty(id), api.getOptions()]);
    setProperty(p);
    const initial = {
      name: p.name, nameArticle: p.nameArticle || 'au', maxAdults: p.maxAdults, maxChildren: p.maxChildren, maxBabies: p.maxBabies,
      basePriceIncludedGuests: p.basePriceIncludedGuests ?? 0,
      extraGuestPrice: p.extraGuestPrice ?? 0,
      singleBeds: p.singleBeds ?? 0, doubleBeds: p.doubleBeds ?? 0,
      depositPercent: p.depositPercent, depositDaysBefore: p.depositDaysBefore, balanceDaysBefore: p.balanceDaysBefore,
      defaultCautionAmount: p.defaultCautionAmount ?? 500,
      touristTaxPerDayPerPerson: p.touristTaxPerDayPerPerson ?? 0,
      touristTaxMode: p.touristTaxMode ?? 'per_day_per_person',
      touristTaxPercentage: p.touristTaxPercentage ?? 0,
      touristTaxDepartmentPercentage: p.touristTaxDepartmentPercentage ?? 0,
      touristTaxFixedAmount: p.touristTaxFixedAmount ?? 0,
      defaultCheckIn: p.defaultCheckIn || '15:00', defaultCheckOut: p.defaultCheckOut || '10:00', cleaningHours: p.cleaningHours ?? 3
    };
    setForm(initial);
    setOriginalForm(initial);
    setDirty(false);
    setPhotoFile(null);

    const propId = Number(id);
    const scopedOptions = (allOptions || []).filter((option) => Array.isArray(option.propertyIds) && option.propertyIds.includes(propId));
    const early = scopedOptions.find((option) => option.autoOptionType === 'early_check_in');
    const late = scopedOptions.find((option) => option.autoOptionType === 'late_check_out');
    const loadedTimedOptions = {
      early: early ? {
        ...early,
        autoEnabled: Number(early.autoEnabled || 0) === 1,
        autoPricingMode: early.autoPricingMode || 'fixed',
        autoFullNightThreshold: early.autoFullNightThreshold || '10:00',
        price: Number(early.price || 0),
      } : {
        autoOptionType: 'early_check_in',
        title: 'Arrivée anticipée',
        description: 'Option automatique si arrivée avant l\'heure par défaut',
        autoEnabled: false,
        autoPricingMode: 'fixed',
        autoFullNightThreshold: '10:00',
        price: 0,
        propertyIds: [propId],
        priceType: 'per_stay',
      },
      late: late ? {
        ...late,
        autoEnabled: Number(late.autoEnabled || 0) === 1,
        autoPricingMode: late.autoPricingMode || 'fixed',
        autoFullNightThreshold: late.autoFullNightThreshold || '17:00',
        price: Number(late.price || 0),
      } : {
        autoOptionType: 'late_check_out',
        title: 'Départ tardif',
        description: 'Option automatique si départ après l\'heure par défaut',
        autoEnabled: false,
        autoPricingMode: 'fixed',
        autoFullNightThreshold: '17:00',
        price: 0,
        propertyIds: [propId],
        priceType: 'per_stay',
      },
    };
    setTimedOptions(loadedTimedOptions);
    setInitialTimedOptions(loadedTimedOptions);
  }, [id, isNew]);

  // Merged platform list (built-ins ∪ DB + this property's source config + global colour). Loaded
  // independently of `load()` so a sync/colour/tax change can refresh just this section.
  const loadPlatforms = useCallback(async () => {
    if (isNew) return;
    const res = await api.getPropertyPlatforms(id);
    setPlatformRows(res.platforms || []);
  }, [id, isNew]);

  const updateTimedOptionField = (kind, field, value) => {
    setTimedOptions((prev) => {
      const option = prev[kind];
      if (!option) return prev;
      return {
        ...prev,
        [kind]: {
          ...option,
          [field]: value,
        },
      };
    });
  };

  const persistTimedOptions = useCallback(async ({ reloadAfter = true } = {}) => {
    if (!canManageExtras) return;
    const payloads = [timedOptions.early, timedOptions.late].filter(Boolean);
    if (payloads.length === 0) return;

    setTimedOptionsSaving(true);
    try {
      await Promise.all(payloads.map((option) => {
        const payload = {
          title: option.title,
          description: option.description,
          priceType: 'per_stay',
          price: Number(option.price || 0),
          propertyIds: option.propertyIds || [Number(id)],
          autoOptionType: option.autoOptionType,
          autoEnabled: Boolean(option.autoEnabled),
          autoPricingMode: option.autoPricingMode || 'fixed',
          autoFullNightThreshold: option.autoFullNightThreshold,
        };
        // Si l'option a un ID, elle existe déjà : UPDATE
        // Sinon, elle est nouvelle : CREATE
        if (option.id) {
          return api.updateOption(option.id, payload);
        } else {
          return api.createOption(payload);
        }
      }));
      if (reloadAfter) {
        await load();
      }
    } finally {
      setTimedOptionsSaving(false);
    }
  }, [canManageExtras, timedOptions, id, load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadPlatforms(); }, [loadPlatforms]);

  // Warn on browser close/refresh
  useEffect(() => {
    if (!pageDirty) return;
    const handler = (e) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pageDirty]);

  // Keep dirtyRef in sync
  useEffect(() => { dirtyRef.current = pageDirty; }, [pageDirty]);

  // Intercept app-level route changes (same pattern as ReservationPage)
  useEffect(() => {
    const guardHandler = (targetPath) => {
      if (!dirtyRef.current) return false;
      if (!targetPath || targetPath === window.location.pathname) return false;
      pendingNavRef.current = targetPath;
      setNavGuardOpen(true);
      return true;
    };

    window.__guestflowBeforeNavigate = guardHandler;
    return () => {
      if (window.__guestflowBeforeNavigate === guardHandler) {
        delete window.__guestflowBeforeNavigate;
      }
    };
  }, []);

  // Intercept clicks on <a> links to block navigation when dirty
  useEffect(() => {
    const handler = (e) => {
      if (!dirtyRef.current) return;
      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('blob:')) return;
      e.preventDefault();
      e.stopPropagation();
      pendingNavRef.current = href;
      setNavGuardOpen(true);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  // Intercept browser back/forward
  useEffect(() => {
    if (!pageDirty) return;
    const handler = () => {
      pendingNavRef.current = null;
      setNavGuardOpen(true);
      // push current location back to cancel the pop
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [pageDirty, location]);

  const handleNavGuardLeave = () => {
    setNavGuardOpen(false);
    const dest = pendingNavRef.current;
    pendingNavRef.current = null;
    dirtyRef.current = false;
    setDirty(false);
    if (dest) navigate(dest);
    else navigateBackWithFrom(navigate, from);
  };

  const handleNavGuardSave = async () => {
    await handleSaveProperty();
    setNavGuardOpen(false);
    const dest = pendingNavRef.current;
    pendingNavRef.current = null;
    if (dest) navigate(dest);
    else navigateBackWithFrom(navigate, from);
  };

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const handleZeroFocus = (e) => {
    if (Number(e.target.value) === 0) {
      requestAnimationFrame(() => e.target.select());
    }
  };

  const handleCancel = () => {
    setForm({ ...originalForm });
    setDirty(false);
    setTimedOptions({ ...initialTimedOptions });
    setPhotoFile(null);
    setPhotoValidationError('');
  };

  const handlePhotoFileChange = (event) => {
    const next = event.target.files?.[0] || null;
    if (!next) return;

    if (!SUPPORTED_PHOTO_MIME_TYPES.has(next.type)) {
      setPhotoValidationError(`Format non pris en charge pour la photo. ${SUPPORTED_PHOTO_FORMATS_TEXT}`);
      event.target.value = '';
      return;
    }

    setPhotoValidationError('');
    setPhotoFile(next);
    setDirty(true);
  };

  const handleSaveProperty = async () => {
    if (!form.name?.trim()) return;
    if (photoFile && !SUPPORTED_PHOTO_MIME_TYPES.has(photoFile.type)) {
      setPhotoValidationError(`Format non pris en charge pour la photo. ${SUPPORTED_PHOTO_FORMATS_TEXT}`);
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        if (photoFile) fd.append('photo', photoFile);
        const result = await api.createProperty(fd);
        navigate(`/properties/${result.id}`, { replace: true });
        return;
      }

      if (dirty || photoFile) {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        if (photoFile) fd.append('photo', photoFile);
        await api.updateProperty(id, fd);
      }

      if (canManageExtras && timedOptionsDirty) {
        await persistTimedOptions({ reloadAfter: false });
      }

      setDirty(false);
      setPhotoFile(null);
      setPhotoValidationError('');
      await load();
    } catch (err) {
      setPhotoValidationError(err?.message || 'Impossible de mettre à jour la photo du logement.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProperty = async () => {
    await api.deleteProperty(id);
    navigateBackWithFrom(navigate, from);
  };

  const handleUploadDoc = async () => {
    if (!canManageExtras) return;
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

  // ── Plateformes & iCal handlers (specs/platforms-and-ical-rework.md) ───────────────────────────

  // Upsert this property's source row for a platform (configure-on-demand): create when no row
  // exists yet, otherwise update. `changes` overrides url / collectsTouristTax / disabled.
  const upsertPlatformSource = async (row, changes = {}) => {
    const payload = {
      platformKey: row.platformKey,
      platformLabel: row.platformLabel,
      url: changes.url !== undefined ? changes.url : (row.url || ''),
      collectsTouristTax: changes.collectsTouristTax !== undefined ? changes.collectsTouristTax : Boolean(row.collectsTouristTax),
      disabled: changes.disabled !== undefined ? changes.disabled : Boolean(row.disabled),
    };
    if (row.sourceId) await api.updatePropertyIcalSource(id, row.sourceId, payload);
    else await api.createPropertyIcalSource(id, payload);
  };

  const handleSetPlatformColor = async (row, hex) => {
    if (!canManageExtras) return;
    setPlatformRows((prev) => prev.map((r) => (r.platformKey === row.platformKey ? { ...r, color: hex } : r)));
    try {
      await api.setPlatformColor(row.platformLabel, hex);
      // Recolour the calendar/planning/finance views live (same module map App.js seeds from
      // GET /properties/platform-colors). Keyed by the label normalised the way getPlatformColor
      // looks up reservation.platform — so the change shows without a full reload.
      const slug = normalizePlatformKey(row.platformLabel);
      if (slug) PLATFORM_COLORS[slug] = hex;
    } catch {
      await loadPlatforms(); // revert to server truth on failure
    }
  };

  const handleToggleTax = async (row) => {
    if (!canManageExtras || row.isDirect) return;
    setBusyKey(row.platformKey);
    try {
      await upsertPlatformSource(row, { collectsTouristTax: !row.collectsTouristTax });
      await loadPlatforms();
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleDisabled = async (row) => {
    if (!canManageExtras) return;
    setBusyKey(row.platformKey);
    try {
      await upsertPlatformSource(row, { disabled: !row.disabled });
      await loadPlatforms();
    } finally {
      setBusyKey(null);
    }
  };

  const startEditPlatform = (row) => {
    setEditingKey(row.platformKey);
    setEditDraft({ url: row.url || '', collectsTouristTax: Boolean(row.collectsTouristTax) });
  };

  const cancelEditPlatform = () => setEditingKey(null);

  const handleSavePlatform = async (row) => {
    if (!canManageExtras) return;
    const url = (editDraft.url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) return; // UX guard; the server validates authoritatively
    setSavingKey(row.platformKey);
    try {
      await upsertPlatformSource(row, { url, collectsTouristTax: editDraft.collectsTouristTax });
      await loadPlatforms();
      setEditingKey(null);
    } finally {
      setSavingKey(null);
    }
  };

  const handleSyncPlatform = async (row) => {
    if (!canManageExtras || !row.sourceId || !row.url) return;
    setBusyKey(row.platformKey);
    try {
      await api.syncPropertyIcalSource(id, row.sourceId);
      await loadPlatforms();
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeletePlatformSource = async (row) => {
    if (!canManageExtras || !row.sourceId) return;
    await api.deletePropertyIcalSource(id, row.sourceId);
    if (editingKey === row.platformKey) setEditingKey(null);
    await loadPlatforms();
  };

  const handleSyncAllIcalSources = async () => {
    if (!canManageExtras) return;
    setSyncingAll(true);
    try {
      await api.syncAllPropertyIcalSources(id);
      await loadPlatforms();
    } finally {
      setSyncingAll(false);
    }
  };

  const handleAddPlatform = async () => {
    if (!canManageExtras) return;
    const name = newPlatformName.trim();
    if (!name) return;
    // Upsert the platform into the registry (empty colour ⇒ tracks the built-in / grey default).
    await api.setPlatformColor(name, '');
    setNewPlatformName('');
    setAddingPlatform(false);
    await loadPlatforms();
  };

  // Platform name + clickable colour swatch (opens the palette). Greyed when the platform is disabled.
  const renderPlatformName = (row) => (
    <PlatformColorPicker
      color={row.color || DEFAULT_ICAL_COLOR}
      disabled={!canManageExtras}
      onChange={(hex) => handleSetPlatformColor(row, hex)}
      label={(
        <Typography variant="body2" sx={{ fontWeight: 600, color: row.disabled ? 'text.disabled' : 'text.primary' }}>
          {row.platformLabel}
        </Typography>
      )}
    />
  );

  // Taxe collectée: live toggle in read mode (persists on flip); draft toggle in edit mode. `direct`
  // has no platform-tax notion → "—". On = the platform collects, off = we do.
  const renderTaxControl = (row, editing) => {
    if (row.isDirect) return <Typography variant="caption" color="text.secondary">—</Typography>;
    const checked = editing ? editDraft.collectsTouristTax : Boolean(row.collectsTouristTax);
    const onChange = editing
      ? (e) => setEditDraft((d) => ({ ...d, collectsTouristTax: e.target.checked }))
      : () => handleToggleTax(row);
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Switch size="small" checked={checked} onChange={onChange} disabled={!canManageExtras || (!editing && busyKey === row.platformKey)} />
        <Typography variant="caption" color="text.secondary">{checked ? 'Plateforme' : 'Vous'}</Typography>
      </Box>
    );
  };

  // Per-row action buttons (shared by the desktop table + the mobile cards).
  const renderPlatformActions = (row) => {
    const isEditing = editingKey === row.platformKey;
    const isBusy = busyKey === row.platformKey;
    const isSaving = savingKey === row.platformKey;
    const hasUrl = Boolean(row.url);
    if (isEditing) {
      return (
        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
          <Tooltip title="Enregistrer">
            <span><IconButton size="small" color="primary" aria-label="Enregistrer" onClick={() => handleSavePlatform(row)} disabled={!canManageExtras || isSaving}><CheckIcon fontSize="small" /></IconButton></span>
          </Tooltip>
          <Tooltip title="Annuler">
            <span><IconButton size="small" aria-label="Annuler" onClick={cancelEditPlatform} disabled={isSaving}><CloseIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        </Box>
      );
    }
    return (
      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {hasUrl && row.sourceId && (
          <Tooltip title="Synchroniser">
            <span><IconButton size="small" color="info" aria-label="Synchroniser" onClick={() => handleSyncPlatform(row)} disabled={!canManageExtras || isBusy}><SyncIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        )}
        <Tooltip title={row.disabled ? 'Réactiver' : 'Désactiver'}>
          <span><IconButton size="small" color={row.disabled ? 'warning' : 'default'} aria-label={row.disabled ? 'Réactiver' : 'Désactiver'} onClick={() => handleToggleDisabled(row)} disabled={!canManageExtras || isBusy}>{row.disabled ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}</IconButton></span>
        </Tooltip>
        {!row.isDirect && (
          <Tooltip title="Modifier">
            <span><IconButton size="small" aria-label="Modifier" onClick={() => startEditPlatform(row)} disabled={!canManageExtras}><EditIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        )}
        {row.sourceId && (
          <Tooltip title="Réinitialiser la configuration">
            <span><IconButton size="small" color="error" aria-label="Réinitialiser la configuration" onClick={() => handleDeletePlatformSource(row)} disabled={!canManageExtras}><DeleteIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        )}
      </Box>
    );
  };

  if (!property) return <Typography>Chargement…</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {isNameEditing ? (
            <TextField
              label="Nom du logement"
              value={form.name || ''}
              onChange={(e) => updateField('name', e.target.value)}
              size="small"
              autoFocus
              sx={{ minWidth: { xs: '100%', sm: 320 } }}
            />
          ) : (
            <Typography variant="h4">{form.name?.trim() || 'Nouveau logement'}</Typography>
          )}
          <IconButton
            size="small"
            onClick={() => setIsNameEditing((prev) => !prev)}
            aria-label={isNameEditing ? 'Valider le nom' : 'Modifier le nom'}
          >
            {isNameEditing ? <CheckIcon fontSize="small" /> : <EditIcon fontSize="small" />}
          </IconButton>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' }, flexDirection: { xs: 'column', sm: 'row' } }}>
          {!isNew && <Button variant="outlined" color="error" onClick={() => setDeleteOpen(true)} sx={{ width: { xs: '100%', sm: 'auto' } }}>Supprimer le logement</Button>}
          {(isNew || pageDirty) && (
            <>
              {!isNew && <Button variant="outlined" onClick={handleCancel} sx={{ width: { xs: '100%', sm: 'auto' } }}>Annuler</Button>}
              {isNew && <Button variant="outlined" onClick={() => navigateBackWithFrom(navigate, from)} sx={{ width: { xs: '100%', sm: 'auto' } }}>Annuler</Button>}
              <Button variant="contained" onClick={handleSaveProperty} disabled={saving || !form.name?.trim()} sx={{ width: { xs: '100%', sm: 'auto' } }}>{saving ? 'Enregistrement…' : isNew ? 'Créer le logement' : 'Enregistrer'}</Button>
            </>
          )}
        </Box>
      </Box>
      {/* Two explicit columns on md+ (1 on xs): left = Informations + Acompte,
          right = Horaires + Options horaires + Options par défaut. alignItems flex-start
          keeps each column at its own height. Wide / table cards go full-width below. */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Infos */}
        <Box sx={{ breakInside: 'avoid', mb: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Informations</Typography>
              {property.photo && <Box component="img" src={property.photo} alt={property.name} sx={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 2, mb: 2 }} />}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
                    {property.photo ? 'Changer la photo' : 'Ajouter une photo'}
                    <input type="file" hidden accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={handlePhotoFileChange} />
                  </Button>
                  {photoFile && <Typography variant="body2" sx={{ mt: 1 }}>{photoFile.name}</Typography>}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    {SUPPORTED_PHOTO_FORMATS_TEXT}
                  </Typography>
                  {photoValidationError && (
                    <Typography variant="body2" color="error" sx={{ mt: 0.75 }}>
                      {photoValidationError}
                    </Typography>
                  )}
                </Box>
                <TextField
                  select
                  label="Article du nom (emails clients)"
                  value={form.nameArticle || 'au'}
                  onChange={(e) => updateField('nameArticle', e.target.value)}
                  size="small"
                  sx={{ width: { xs: '100%', sm: 360 } }}
                  helperText={previewWithArticle(form.name, form.nameArticle)
                    ? `Aperçu : « votre séjour ${previewWithArticle(form.name, form.nameArticle)} »`
                    : 'Utilisé pour « votre séjour … » dans les emails clients.'}
                >
                  {NAME_ARTICLES.map((a) => (
                    <MenuItem key={a} value={a}>{a}</MenuItem>
                  ))}
                </TextField>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Max adultes" type="number" value={form.maxAdults ?? 0} onChange={(e) => updateField('maxAdults', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
                  <TextField label="Max enfants" type="number" value={form.maxChildren ?? 0} onChange={(e) => updateField('maxChildren', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" helperText="2 à 18 ans" />
                  <TextField label="Max bébés" type="number" value={form.maxBabies ?? 0} onChange={(e) => updateField('maxBabies', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" helperText="0 à 2 ans" />
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Lits doubles" type="number" value={form.doubleBeds ?? 0} onChange={(e) => updateField('doubleBeds', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" slotProps={{
                    htmlInput: { min: 0 }
                  }} />
                  <TextField label="Lits simples" type="number" value={form.singleBeds ?? 0} onChange={(e) => updateField('singleBeds', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" slotProps={{
                    htmlInput: { min: 0 }
                  }} />
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField
                    label="Capacité incluse dans le prix de base"
                    type="number"
                    value={form.basePriceIncludedGuests ?? 0}
                    onChange={(e) => updateField('basePriceIncludedGuests', e.target.value)}
                    onFocus={handleZeroFocus}
                    fullWidth
                    size="small"
                    helperText="Nombre de personnes incluses avant surcoût"
                    slotProps={{
                      htmlInput: { min: 0, step: 1 }
                    }}
                  />
                  <TextField
                    label="Supplément par personne (€ / séjour)"
                    type="number"
                    value={form.extraGuestPrice ?? 0}
                    onChange={(e) => updateField('extraGuestPrice', e.target.value)}
                    onFocus={handleZeroFocus}
                    fullWidth
                    size="small"
                    helperText="Ex: 15 pour facturer 15€ par personne supplémentaire"
                    slotProps={{
                      htmlInput: { min: 0, step: 0.01 }
                    }}
                  />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* Acompte & Solde */}
        <Box sx={{ mb: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Acompte & Solde</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField label="% acompte" type="number" value={form.depositPercent ?? 30} onChange={(e) => updateField('depositPercent', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField label="Acompte (jours avant)" type="number" value={form.depositDaysBefore ?? 30} onChange={(e) => updateField('depositDaysBefore', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
                  <TextField label="Solde (jours avant)" type="number" value={form.balanceDaysBefore ?? 7} onChange={(e) => updateField('balanceDaysBefore', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" />
                </Box>
                <TextField label="Caution par défaut (€)" type="number" value={form.defaultCautionAmount ?? 500} onChange={(e) => updateField('defaultCautionAmount', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" slotProps={{
                  htmlInput: { step: 50 }
                }} />
              </Box>
            </CardContent>
          </Card>
        </Box>
        </Box>{/* fin colonne gauche */}

        <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Horaires & Ménage */}
        <Box sx={{ breakInside: 'avoid', mb: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Horaires & Ménage</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Heure d'arrivée</InputLabel>
                    <Select value={form.defaultCheckIn || '15:00'} label="Heure d'arrivée" onChange={(e) => updateField('defaultCheckIn', e.target.value)}>
                      {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small">
                    <InputLabel>Heure de départ</InputLabel>
                    <Select value={form.defaultCheckOut || '10:00'} label="Heure de départ" onChange={(e) => updateField('defaultCheckOut', e.target.value)}>
                      {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Box>
                <TextField label="Temps de ménage (heures)" type="number" value={form.cleaningHours ?? 3} onChange={(e) => updateField('cleaningHours', e.target.value)} onFocus={handleZeroFocus} fullWidth size="small" slotProps={{
                  htmlInput: { min: 0, step: 0.5 }
                }} />
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ breakInside: 'avoid', mb: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Options horaires automatiques</Typography>
              {[
                { key: 'early', title: 'Arrivée anticipée', hint: 'Ajoutée automatiquement si arrivée avant l\'heure par défaut.' },
                { key: 'late', title: 'Départ tardif', hint: 'Ajoutée automatiquement si départ après l\'heure par défaut.' },
              ].map((entry) => {
                const option = timedOptions[entry.key];
                if (!option) return null;
                return (
                  <Box key={entry.key} sx={{ mb: 2.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{entry.title}</Typography>
                        <Typography variant="caption" color="text.secondary">{entry.hint}</Typography>
                      </Box>
                      <FormControlLabel
                        control={<Switch checked={Boolean(option.autoEnabled)} onChange={(e) => updateTimedOptionField(entry.key, 'autoEnabled', e.target.checked)} />}
                        label={option.autoEnabled ? 'Actif' : 'Inactif'}
                      />
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.5, mt: 1 }}>
                      <FormControl size="small" fullWidth>
                        <InputLabel>Tarification</InputLabel>
                        <Select
                          value={option.autoPricingMode || 'fixed'}
                          label="Tarification"
                          onChange={(e) => updateTimedOptionField(entry.key, 'autoPricingMode', e.target.value)}
                        >
                          <MenuItem value="fixed">Prix fixe</MenuItem>
                          <MenuItem value="proportional">Proportionnel au prix de nuit</MenuItem>
                        </Select>
                      </FormControl>

                      <TextField
                        size="small"
                        type="number"
                        label="Prix fixe (€)"
                        value={option.price ?? 0}
                        onChange={(e) => updateTimedOptionField(entry.key, 'price', e.target.value)}
                        disabled={(option.autoPricingMode || 'fixed') !== 'fixed'}
                        fullWidth
                        slotProps={{
                          htmlInput: { min: 0, step: 1 }
                        }}
                      />

                      <FormControl size="small" fullWidth>
                        <InputLabel>Seuil nuit complète</InputLabel>
                        <Select
                          value={option.autoFullNightThreshold || (entry.key === 'early' ? '10:00' : '17:00')}
                          label="Seuil nuit complète"
                          onChange={(e) => updateTimedOptionField(entry.key, 'autoFullNightThreshold', e.target.value)}
                        >
                          {TIME_OPTIONS.map((time) => <MenuItem key={`${entry.key}-${time}`} value={time}>{time}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Box>
                  </Box>
                );
              })}

            </CardContent>
          </Card>
        </Box>

        </Box>{/* fin colonne droite */}
      </Box>{/* fin wrapper 2 colonnes */}

      {/* Full-width section: wide / table-bearing cards */}
      <Box>
        {/* Pricing */}
        <Box sx={{ mb: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Tarification</Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 2 }}>Taxe de séjour</Typography>
              
              <FormControl fullWidth size="small" sx={{ mt: 1.25, mb: 1.5 }}>
                <InputLabel>Mode de calcul</InputLabel>
                <Select
                  label="Mode de calcul"
                  value={form.touristTaxMode ?? 'per_day_per_person'}
                  onChange={(e) => updateField('touristTaxMode', e.target.value)}
                >
                  <MenuItem value="per_day_per_person">Par jour et par adulte</MenuItem>
                  <MenuItem value="percentage_accommodation">% du montant hébergement</MenuItem>
                  <MenuItem value="percentage_and_fixed">% + montant fixe</MenuItem>
                </Select>
              </FormControl>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, mb: 2 }}>
                {form.touristTaxMode === 'per_day_per_person' && (
                  <TextField
                    label="Taxe (€/jour/adulte)"
                    type="number"
                    value={form.touristTaxPerDayPerPerson ?? 0}
                    onChange={(e) => updateField('touristTaxPerDayPerPerson', e.target.value)}
                    onFocus={handleZeroFocus}
                    fullWidth
                    size="small"
                    slotProps={{
                      htmlInput: { min: 0, step: 0.01 }
                    }}
                  />
                )}
                
                {form.touristTaxMode === 'percentage_accommodation' && (
                  <>
                    <TextField
                      label="Pourcentage commune (%)"
                      type="number"
                      value={form.touristTaxPercentage ?? 0}
                      onChange={(e) => updateField('touristTaxPercentage', e.target.value)}
                      onFocus={handleZeroFocus}
                      fullWidth
                      size="small"
                      helperText="Appliqué au prix moyen HT de la nuit par occupant"
                      slotProps={{
                        htmlInput: { min: 0, step: 0.01 }
                      }}
                    />
                    <TextField
                      label="Pourcentage additionnel départemental (%)"
                      type="number"
                      value={form.touristTaxDepartmentPercentage ?? 0}
                      onChange={(e) => updateField('touristTaxDepartmentPercentage', e.target.value)}
                      onFocus={handleZeroFocus}
                      fullWidth
                      size="small"
                      helperText="Pourcentage additionnel appliqué sur la part communale"
                      slotProps={{
                        htmlInput: { min: 0, step: 0.01 }
                      }}
                    />
                  </>
                )}
                
                {form.touristTaxMode === 'percentage_and_fixed' && (
                  <>
                    <TextField
                      label="Pourcentage commune (%)"
                      type="number"
                      value={form.touristTaxPercentage ?? 0}
                      onChange={(e) => updateField('touristTaxPercentage', e.target.value)}
                      onFocus={handleZeroFocus}
                      fullWidth
                      size="small"
                      helperText="Appliqué au prix moyen HT de la nuit par occupant"
                      slotProps={{
                        htmlInput: { min: 0, step: 0.01 }
                      }}
                    />
                    <TextField
                      label="Pourcentage additionnel départemental (%)"
                      type="number"
                      value={form.touristTaxDepartmentPercentage ?? 0}
                      onChange={(e) => updateField('touristTaxDepartmentPercentage', e.target.value)}
                      onFocus={handleZeroFocus}
                      fullWidth
                      size="small"
                      helperText="Pourcentage additionnel appliqué sur la part communale"
                      slotProps={{
                        htmlInput: { min: 0, step: 0.01 }
                      }}
                    />
                    <TextField
                      label="Montant fixe (€)"
                      type="number"
                      value={form.touristTaxFixedAmount ?? 0}
                      onChange={(e) => updateField('touristTaxFixedAmount', e.target.value)}
                      onFocus={handleZeroFocus}
                      fullWidth
                      size="small"
                      helperText="Montant fixe par nuit et par adulte, ajouté au pourcentage"
                      slotProps={{
                        htmlInput: { min: 0, step: 0.01 }
                      }}
                    />
                  </>
                )}
              </Box>

              <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 2 }}>TVA (tous les montants en TTC)</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Les taux de TVA (hébergement et standard) sont communs à tous les logements et se règlent
                dans <strong>Paramètres → Taux de TVA</strong>.
              </Typography>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Gestion des saisons tarifaires</Typography>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!canManageExtras}
                  onClick={() => navigate(withFrom(`/properties/${id}/pricing-seasons`, `/properties/${id}`))}
                >
                  Gestion tarifaire
                </Button>
              </Box>
              <TableContainer>
                <Table size="small" sx={{ minWidth: 700 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Saison</TableCell>
                      <TableCell>Dates</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Tarif base</TableCell>
                      <TableCell>Min nuits</TableCell>
                      <TableCell>Couleur</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...(property.pricingRules || [])]
                      .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
                      .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                            {getSortedSeasonRanges(r).map((range, index) => (
                              <Typography key={`${r.id}-range-${index}`} variant="body2" sx={{ lineHeight: 1.25 }}>
                                {displayDate(range.startDate)} → {displayDate(range.endDate)}
                              </Typography>
                            ))}
                          </Box>
                        </TableCell>
                        <TableCell>{(r.pricingMode || 'fixed') === 'progressive' ? 'Dégressif' : 'Fixe'}</TableCell>
                        <TableCell>{Number(r.pricePerNight || 0).toFixed(2)}€</TableCell>
                        <TableCell>{r.minNights}</TableCell>
                        <TableCell>
                          <Box sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: r.color || '#1976d2' }} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!property.pricingRules || property.pricingRules.length === 0) && (
                      <TableRow><TableCell colSpan={6} align="center">Aucune saison tarifaire</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Box>

        {/* Documents */}
        <Box sx={{ mb: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Documents</Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {(property.documents || []).map((d) => (
                  <Chip
                    key={d.id}
                    label={`${d.name} (${d.type})`}
                    onDelete={canManageExtras ? async () => { await api.deleteDocument(id, d.id); load(); } : undefined}
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
                <TextField size="small" label="Nom" value={docName} onChange={(e) => setDocName(e.target.value)} disabled={!canManageExtras} />
                <Button variant="outlined" component="label" startIcon={<UploadIcon />} disabled={!canManageExtras}>
                  Fichier
                  <input type="file" hidden onChange={(e) => setDocFile(e.target.files[0])} />
                </Button>
                {docFile && <Typography variant="body2">{docFile.name}</Typography>}
                <Button variant="contained" size="small" onClick={handleUploadDoc} disabled={!canManageExtras || !docFile}>Envoyer</Button>
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* iCal Export */}
        {!isNew && (
          <Box sx={{ mb: 3 }}>
            <IcalExportCard propertyId={property.id} propertyName={property.name} />
          </Box>
        )}

        {/* Plateformes & iCal (specs/platforms-and-ical-rework.md) */}
        <Box sx={{ mb: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Typography variant="h6">Plateformes &amp; iCal</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button variant="text" startIcon={<AddIcon />} onClick={() => setAddingPlatform((v) => !v)} disabled={!canManageExtras}>
                    Ajouter une plateforme
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<SyncIcon />}
                    onClick={handleSyncAllIcalSources}
                    disabled={!canManageExtras || syncingAll || !platformRows.some((r) => r.url)}
                  >
                    {syncingAll ? 'Synchronisation…' : 'Synchroniser tout'}
                  </Button>
                </Box>
              </Box>

              {addingPlatform && (
                <Box sx={{ display: 'flex', gap: 1, mb: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField
                    size="small"
                    label="Nom de la plateforme"
                    value={newPlatformName}
                    onChange={(e) => setNewPlatformName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddPlatform(); }}
                    placeholder="ex: Vrbo"
                    autoFocus
                    fullWidth
                    disabled={!canManageExtras}
                  />
                  <Button variant="contained" onClick={handleAddPlatform} disabled={!canManageExtras || !newPlatformName.trim()}>Ajouter</Button>
                  <Button variant="text" onClick={() => { setAddingPlatform(false); setNewPlatformName(''); }}>Annuler</Button>
                </Box>
              )}

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Cliquez sur le nom ou le carré de couleur pour changer la couleur d&apos;affichage sur le calendrier.
                Une URL iCal vide signifie une saisie manuelle (pas de synchronisation).
              </Typography>

              {platformRows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">Chargement…</Typography>
              ) : isMobile ? (
                /* Mobile: one stacked card per platform (no horizontal scroll). */
                <Box>
                  {platformRows.map((row) => {
                    const isEditing = editingKey === row.platformKey;
                    const hasUrl = Boolean(row.url);
                    const muted = Boolean(row.disabled);
                    return (
                      <Card key={row.platformKey} variant="outlined" sx={{ mb: 1.5, opacity: muted ? 0.75 : 1 }}>
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
                            {renderPlatformName(row)}
                            {renderPlatformActions(row)}
                          </Box>
                          {!row.isDirect && (
                            <Box sx={{ mb: 1 }}>
                              {isEditing ? (
                                <TextField
                                  size="small"
                                  fullWidth
                                  label="URL iCal"
                                  value={editDraft.url}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, url: e.target.value }))}
                                  disabled={!canManageExtras}
                                  placeholder="https://…  (laisser vide = saisie manuelle)"
                                />
                              ) : (
                                <Typography variant="body2" sx={{ wordBreak: 'break-all', color: muted ? 'text.disabled' : 'text.secondary' }}>
                                  {row.url || 'Saisie manuelle (pas d’URL iCal)'}
                                </Typography>
                              )}
                            </Box>
                          )}
                          {!row.isDirect && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="caption" color="text.secondary">Taxe collectée :</Typography>
                              {renderTaxControl(row, isEditing)}
                            </Box>
                          )}
                          {hasUrl && (
                            <Typography variant="caption" display="block" sx={{ mt: 0.5 }} color={row.lastSyncStatus === 'error' ? 'error.main' : 'text.secondary'}>
                              {row.lastSyncAt ? `Sync : ${displayDate(row.lastSyncAt.slice(0, 10))} — ` : ''}
                              {row.lastSyncStatus === 'error' ? (row.lastSyncMessage || 'Erreur') : (row.lastSyncMessage || 'Jamais synchronisé')}
                            </Typography>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </Box>
              ) : (
                /* Desktop / tablet: table. */
                <TableContainer>
                  <Table size="small" sx={{ minWidth: 760 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Plateforme</TableCell>
                        <TableCell>URL iCal</TableCell>
                        <TableCell>Taxe collectée</TableCell>
                        <TableCell>Dernière synchro</TableCell>
                        <TableCell>État</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {platformRows.map((row) => {
                        const isEditing = editingKey === row.platformKey;
                        const hasUrl = Boolean(row.url);
                        const muted = Boolean(row.disabled);
                        const textColor = muted ? 'text.disabled' : 'text.primary';
                        return (
                          <TableRow key={row.platformKey} sx={{ opacity: muted ? 0.75 : 1 }}>
                            <TableCell>{renderPlatformName(row)}</TableCell>
                            <TableCell sx={{ maxWidth: 300 }}>
                              {row.isDirect ? (
                                <Typography variant="caption" color="text.secondary">—</Typography>
                              ) : isEditing ? (
                                <TextField
                                  size="small"
                                  fullWidth
                                  value={editDraft.url}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, url: e.target.value }))}
                                  disabled={!canManageExtras}
                                  placeholder="https://…  (laisser vide = saisie manuelle)"
                                />
                              ) : (
                                <Typography variant="body2" noWrap title={row.url} sx={{ color: textColor, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {row.url || '—'}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>{renderTaxControl(row, isEditing)}</TableCell>
                            <TableCell>
                              <Typography variant="caption" sx={{ color: textColor }}>
                                {hasUrl ? (row.lastSyncAt ? displayDate(row.lastSyncAt.slice(0, 10)) : '—') : ''}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              {hasUrl && (
                                <Typography variant="caption" color={row.lastSyncStatus === 'error' ? 'error.main' : 'text.secondary'}>
                                  {row.lastSyncStatus === 'error' ? (row.lastSyncMessage || 'Erreur') : (row.lastSyncMessage || 'Jamais synchronisé')}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell align="right">{renderPlatformActions(row)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Box>

      </Box>
      {/* Unsaved changes dialog */}
      <Dialog open={navGuardOpen} onClose={() => setNavGuardOpen(false)}>
        <DialogTitle>Modifications non sauvegardées</DialogTitle>
        <DialogContent>
          <Typography>Vous avez des modifications non sauvegardées. Voulez-vous les sauvegarder avant de quitter ?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleNavGuardLeave} color="error">Quitter sans sauvegarder</Button>
          <Button onClick={() => setNavGuardOpen(false)}>Rester sur la page</Button>
          <Button variant="contained" onClick={handleNavGuardSave}>Sauvegarder et quitter</Button>
        </DialogActions>
      </Dialog>
      {!isNew && <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteProperty}
        title="Supprimer le logement"
        message={`Voulez-vous vraiment supprimer "${property.name}" ?`}
        confirmLabel="Supprimer"
      />}
    </Box>
  );
}
