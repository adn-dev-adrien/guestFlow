import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router';
import { Box } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { TIME_OPTIONS } from '../constants/timeOptions';
import { getFromParam, navigateBackWithFrom, withFrom } from '../utils/navigation';
import PageActionBar from '../components/PageActionBar';
import PageTabs from '../components/PageTabs';
import ConfirmDialog from '../components/ConfirmDialog';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import { useToast } from '../components/DialogProvider';
import PropertyGeneralTab from '../components/property/PropertyGeneralTab';
import PropertyTariffTab from '../components/property/PropertyTariffTab';
import PropertyPaymentTab from '../components/property/PropertyPaymentTab';
import PropertyStayTab from '../components/property/PropertyStayTab';
import PropertyPlatformsTab from '../components/property/PropertyPlatformsTab';
import PropertyDocumentsTab from '../components/property/PropertyDocumentsTab';
import api from '../api';

// Article options for "votre séjour <article> <name>" in client emails (mirrors the server's
// formatPropertyWithArticle: the apostrophe form elides, the others get a space).
// « à » is for names that carry their own article: « à La Granja » (specs/guest-email-sequence.md §5).
const NAME_ARTICLES = ['au', 'à la', "à l'", 'aux', 'à'];
// Exported for non-regression unit tests (pages/__tests__/PropertyDetail.helpers.test.js).
export function previewWithArticle(name, article) {
  const n = String(name || '').trim();
  if (!n) return '';
  const a = article || 'au';
  return a.endsWith("'") ? `${a}${n}` : `${a} ${n}`;
}

const NEW_DEFAULTS = {
  name: '', nameArticle: 'au', maxGuests: 2, maxBabies: 0,
  basePriceIncludedGuests: 0,
  extraGuestPrice: 0,
  extraGuestPriceUnit: 'per_stay',
  singleBeds: 0, doubleBeds: 1,
  depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7,
  depositEnabled: false,
  defaultCautionAmount: 500,
  parkingDistanceMeters: 0, hasWifi: true, hasFilterCoffeeMaker: false,
  touristTaxPerDayPerPerson: 0,
  touristTaxMode: 'per_day_per_person',
  touristTaxPercentage: 0,
  touristTaxDepartmentPercentage: 0,
  touristTaxFixedAmount: 0,
  defaultCheckIn: '15:00', defaultCheckOut: '10:00', cleaningHours: 3,
};

// specs/settings-rationalization.md rule 21 — the property page is split into tabs; the tab lives in
// `?tab=`. Every form field belongs to one tab, so a tab can show that it holds an unsaved change
// (amber dot) or a field the server refused (red dot).
export const PROPERTY_TABS = [
  { key: 'general', label: 'Général' },
  { key: 'tarifs', label: 'Tarifs' },
  { key: 'paiement', label: 'Paiement & caution' },
  { key: 'sejour', label: 'Séjour' },
  { key: 'plateformes', label: 'Plateformes & iCal' },
  { key: 'documents', label: 'Documents' },
];
export const FIELD_TAB = {
  name: 'general', nameArticle: 'general', maxGuests: 'general', maxBabies: 'general',
  doubleBeds: 'general', singleBeds: 'general', defaultCheckIn: 'general', defaultCheckOut: 'general', cleaningHours: 'general',
  basePriceIncludedGuests: 'tarifs', extraGuestPrice: 'tarifs', extraGuestPriceUnit: 'tarifs', touristTaxMode: 'tarifs',
  touristTaxPerDayPerPerson: 'tarifs', touristTaxPercentage: 'tarifs', touristTaxDepartmentPercentage: 'tarifs', touristTaxFixedAmount: 'tarifs',
  depositEnabled: 'paiement', depositPercent: 'paiement', depositDueDays: 'paiement', balanceDaysBefore: 'paiement',
  cancelAfterBalanceDueDays: 'paiement', defaultCautionAmount: 'paiement',
  parkingDistanceMeters: 'sejour', hasWifi: 'sejour', hasFilterCoffeeMaker: 'sejour',
};

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
  // Saves used to succeed SILENTLY on this page — toast the outcome (specs/ds-components.md §3.2).
  const { showSuccess, showError } = useToast();
  const dirtyRef = useRef(false);
  const [navGuardOpen, setNavGuardOpen] = useState(false);
  const pendingNavRef = useRef(null);
  const [property, setProperty] = useState(isNew ? { name: 'Nouveau logement', pricingRules: [], documents: [] } : null);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState(isNew ? NEW_DEFAULTS : {});
  const [dirty, setDirty] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [originalForm, setOriginalForm] = useState(isNew ? NEW_DEFAULTS : {});
  const [errors, setErrors] = useState({});
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = PROPERTY_TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'general';
  const selectTab = (next) => setSearchParams((prev) => {
    const params = new URLSearchParams(prev);
    if (next === 'general') params.delete('tab'); else params.set('tab', next);
    return params;
  }, { replace: true });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoValidationError, setPhotoValidationError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
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
    setLoadError(false);
    let p; let allOptions;
    try {
      [p, allOptions] = await Promise.all([api.getProperty(id), api.getOptions()]);
    } catch (e) {
      setLoadError(true);
      return;
    }
    setProperty(p);
    const initial = {
      name: p.name, nameArticle: p.nameArticle || 'au', maxGuests: p.maxGuests, maxBabies: p.maxBabies,
      basePriceIncludedGuests: p.basePriceIncludedGuests ?? 0,
      extraGuestPrice: p.extraGuestPrice ?? 0,
      extraGuestPriceUnit: p.extraGuestPriceUnit === 'per_night' ? 'per_night' : 'per_stay',
      singleBeds: p.singleBeds ?? 0, doubleBeds: p.doubleBeds ?? 0,
      depositPercent: p.depositPercent, depositDueDays: p.depositDueDays,
      balanceDaysBefore: p.balanceDaysBefore, cancelAfterBalanceDueDays: p.cancelAfterBalanceDueDays,
      depositEnabled: Boolean(p.depositEnabled),
      defaultCautionAmount: p.defaultCautionAmount ?? 500,
      parkingDistanceMeters: p.parkingDistanceMeters ?? 0,
      hasWifi: p.hasWifi == null ? true : Boolean(p.hasWifi),
      hasFilterCoffeeMaker: Boolean(p.hasFilterCoffeeMaker),
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
    if (errors[field]) setErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
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
    setErrors({});
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
    setErrors({});
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
      showSuccess('Logement enregistré.');
    } catch (err) {
      // A refused field lands under its input and lights its tab (rule 23a); anything else toasts —
      // NOT the photo-validation field (reserved for the local file-format check).
      if (err && err.errors) {
        setErrors(err.errors);
        const firstTab = PROPERTY_TABS.find((t) => Object.keys(err.errors).some((f) => FIELD_TAB[f] === t.key));
        if (firstTab) selectTab(firstTab.key);
        showError('Enregistrement refusé : corrigez les champs en rouge.');
      } else {
        showError(err?.message || "Impossible d'enregistrer le logement.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProperty = async () => {
    try {
      await api.deleteProperty(id);
      navigateBackWithFrom(navigate, from);
    } catch (err) {
      showError(err?.message || 'Impossible de supprimer le logement.');
    }
  };

  if (loadError) {
    return <Box><PageActionBar title="Logement" onBack={() => navigateBackWithFrom(navigate, from)} /><ErrorAlert message="Impossible de charger le logement." onRetry={load} /></Box>;
  }
  if (!property) return <Box><PageActionBar title="Logement" /><LoadingState label="Chargement du logement…" /></Box>;

  const showSaveCancel = isNew || pageDirty;
  const tabState = (key) => {
    const fields = Object.keys(FIELD_TAB).filter((f) => FIELD_TAB[f] === key);
    if (fields.some((f) => errors[f])) return 'error';
    const changed = fields.some((f) => String(form[f] ?? '') !== String(originalForm[f] ?? ''))
      || (key === 'general' && Boolean(photoFile))
      || (key === 'sejour' && timedOptionsDirty);
    return changed ? 'dirty' : '';
  };
  const tabDot = (state) => (state ? (
    <Box component="span" aria-label={state === 'error' ? 'erreur' : 'modifié'} sx={{ width: 8, height: 8, borderRadius: '50%', ml: 0.75, bgcolor: state === 'error' ? 'error.main' : 'warning.main' }} />
  ) : null);
  const tabItems = PROPERTY_TABS
    .filter((t) => !isNew || ['general', 'tarifs', 'paiement', 'sejour'].includes(t.key))
    .map((t) => ({ value: t.key, label: t.label, badge: tabDot(tabState(t.key)) }));
  const common = { form, errors, updateField, onZeroFocus: handleZeroFocus };

  return (
    <Box>
      <PageActionBar
        title={isNew ? 'Nouveau logement' : (property.name || 'Logement')}
        titleOnXs
        tabs={<PageTabs value={tab} onChange={selectTab} items={tabItems} ariaLabel="Onglets du logement" />}
        {...(showSaveCancel ? {
          onSave: handleSaveProperty,
          saveTooltip: isNew ? 'Créer le logement' : 'Enregistrer',
          saveDisabled: saving || !form.name?.trim(),
          saveBusy: saving,
          onCancel: isNew ? () => navigateBackWithFrom(navigate, from) : handleCancel,
        } : {})}
        actionsAfter={!isNew ? [{
          icon: <DeleteIcon />,
          tooltip: 'Supprimer le logement',
          onClick: () => setDeleteOpen(true),
          color: 'error',
        }] : []}
      />
      <Box sx={{ maxWidth: 980, mx: 'auto', px: { xs: 0, sm: 1 } }}>
        {tab === 'general' && (
          <PropertyGeneralTab
            {...common}
            property={property}
            isNew={isNew}
            photoFile={photoFile}
            photoValidationError={photoValidationError}
            onPhotoChange={handlePhotoFileChange}
            nameArticles={NAME_ARTICLES}
            previewWithArticle={previewWithArticle}
            photoFormatsText={SUPPORTED_PHOTO_FORMATS_TEXT}
            timeOptions={TIME_OPTIONS}
          />
        )}
        {tab === 'tarifs' && (
          <PropertyTariffTab
            {...common}
            property={property}
            canManage={canManageExtras}
            getSortedSeasonRanges={getSortedSeasonRanges}
            onOpenTariffs={() => navigate(withFrom(`/properties/${id}/pricing-seasons`, `/properties/${id}?tab=tarifs`))}
          />
        )}
        {tab === 'paiement' && <PropertyPaymentTab {...common} />}
        {tab === 'sejour' && (
          <PropertyStayTab
            {...common}
            timedOptions={timedOptions}
            updateTimedOptionField={updateTimedOptionField}
            timeOptions={TIME_OPTIONS}
          />
        )}
        {tab === 'plateformes' && !isNew && (
          <PropertyPlatformsTab propertyId={property.id} propertyName={property.name} canManage={canManageExtras} />
        )}
        {tab === 'documents' && !isNew && (
          <PropertyDocumentsTab propertyId={id} documents={property.documents || []} canManage={canManageExtras} onChanged={load} />
        )}
      </Box>
      <UnsavedChangesDialog
        open={navGuardOpen}
        onStay={() => setNavGuardOpen(false)}
        onDiscard={handleNavGuardLeave}
        onSaveAndQuit={handleNavGuardSave}
      />
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
