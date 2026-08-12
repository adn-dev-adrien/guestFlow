import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import {
  Box, Typography, Card, CardContent, Button, Grid, TextField, Table, TableHead, TableRow,
  TableCell, TableBody, TableContainer, FormControl, InputLabel, Select,
  MenuItem, Chip, Alert, InputAdornment, FormControlLabel, Switch, RadioGroup, Radio, FormLabel,
  IconButton
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { frFR } from '@mui/x-date-pickers/locales';
import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DateRangeIcon from '@mui/icons-material/DateRange';
import EventIcon from '@mui/icons-material/Event';
import PageActionBar from '../components/PageActionBar';
import ConfirmDialog from '../components/ConfirmDialog';
import FormDialog from '../components/FormDialog';
import TableCard from '../components/TableCard';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import PlatformPriceCard from '../components/PlatformPriceCard';
import TariffRecipeCard from '../components/property/TariffRecipeCard';
import { useToast } from '../components/DialogProvider';
import api from '../api';
import { displayDate, formatCurrency } from '../utils/formatters';
import { withFrom } from '../utils/navigation';
import { getSchoolHolidayInfo } from '../frenchHolidays';

const DEFAULT_COLORS = ['#1976d2', '#2e7d32', '#f57c00', '#6a1b9a', '#00838f', '#d81b60', '#5d4037'];

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

function getMondayStart(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function parseTiers(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDateRanges(value, startDate, endDate) {
  if (Array.isArray(value) && value.length > 0) return value;
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // ignore invalid JSON and fallback to legacy fields
    }
  }
  if (startDate && endDate) return [{ startDate, endDate }];
  return [{ startDate: '', endDate: '' }];
}

function getSortedDateRanges(ranges) {
  return (ranges || [])
    .filter((range) => range.startDate && range.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

// Only the ranges that still have sellable days ahead — a season's past dates are noise on a page
// whose job is to answer « what do I charge from here on ». Purely presentational: nothing is
// dropped from the data (specs/tariff-recipes/spec.md §3.4 rule 25quinquies).
function upcomingRangesFrom(ranges, todayIso) {
  return getSortedDateRanges(ranges).filter((range) => range.endDate >= todayIso);
}

// Closure lookup for a day — the ranges come computed from the server, this is a plain containment
// test (specs/tariff-recipes/spec.md §3.4 rule 25bis).
function findClosureForDate(closureRanges, dateStr) {
  return (closureRanges || []).find((c) => dateStr >= c.startDate && dateStr <= c.endDate) || null;
}

// Changeover weekdays (specs/tariff-recipes/spec.md §3.4) — JS convention 0 = dimanche … 6 = samedi,
// listed Monday-first for the French eye. '' = « Aucun » = unrestricted.
const WEEKDAYS_FR = [
  { value: 1, label: 'lundi' }, { value: 2, label: 'mardi' }, { value: 3, label: 'mercredi' },
  { value: 4, label: 'jeudi' }, { value: 5, label: 'vendredi' }, { value: 6, label: 'samedi' },
  { value: 0, label: 'dimanche' },
];

function isoToDayjs(value) {
  return value ? dayjs(value) : null;
}

function dayjsToIso(value) {
  return value && value.isValid() ? value.format('YYYY-MM-DD') : '';
}

function parseDecimalInput(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(',', '.').trim();
  if (!normalized || normalized === '.' || normalized === '-.' || normalized === '-') return null;
  if (normalized.endsWith('.')) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDecimalForInput(value) {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

function sanitizeDecimalInput(raw) {
  // Accept , or . as decimal separator; strip everything else except digits and minus
  return String(raw || '').replace(/\./g, ',').replace(/[^0-9,\-]/g, '');
}

export default function PropertyPricingSeasonsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [property, setProperty] = useState(null);
  // Bumped after a season is saved/deleted so the « Prix plateformes » grid re-fetches its net prices.
  const [platformRefresh, setPlatformRefresh] = useState(0);
  const [allProperties, setAllProperties] = useState([]);
  const [schoolHolidays, setSchoolHolidays] = useState([]);
  const [publicHolidays, setPublicHolidays] = useState(() => new Set());
  const [displayStartYear, setDisplayStartYear] = useState(new Date().getFullYear());
  const displayYears = 1; // one year per screen; the arrows move it

  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [editingSeasonId, setEditingSeasonId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [seasonSaveError, setSeasonSaveError] = useState('');
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmDialogAction, setConfirmDialogAction] = useState(null); // 'close' | 'prefill' | null
  const [progressivePreview, setProgressivePreview] = useState({ weekPriceEquivalent: 0, rows: [], progressiveTiers: [] });
  const progressivePreviewRequestRef = useRef(0);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyTargetPropertyId, setApplyTargetPropertyId] = useState('');
  const [applyReplaceExisting, setApplyReplaceExisting] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { showSuccess, showError } = useToast();
  const [basePriceInput, setBasePriceInput] = useState('');
  const [tierPriceInputs, setTierPriceInputs] = useState({});

  // Calendar season painting (specs/pricing-min-nights-per-range.md): drag-select a period, then a
  // dialog (re)assigns it to a season with a minimum-nights. Anchor/hover drive the highlight; the
  // refs distinguish a real drag from a plain click (which keeps the "open season for edit" behaviour).
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [selectionHover, setSelectionHover] = useState(null);
  const isSelectingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignForm, setAssignForm] = useState({
    startDate: '', endDate: '', minNights: 1,
    targetMode: 'existing', targetRuleId: '',
    newLabel: '', newColor: DEFAULT_COLORS[0], newPrice: 100, newMode: 'fixed',
  });

  const [seasonForm, setSeasonForm] = useState({
    label: '',
    dateRanges: [{ startDate: '', endDate: '' }],
    color: DEFAULT_COLORS[0],
    pricePerNight: 100,
    pricingMode: 'fixed',
    minNights: 1,
    maxNights: '',
    progressiveTiers: [],
    changeoverArrival: '',
    changeoverDeparture: '',
  });

  const [initialSeasonForm, setInitialSeasonForm] = useState({
    label: '',
    dateRanges: [{ startDate: '', endDate: '' }],
    color: DEFAULT_COLORS[0],
    pricePerNight: 100,
    pricingMode: 'fixed',
    minNights: 1,
    maxNights: '',
    progressiveTiers: [],
    changeoverArrival: '',
    changeoverDeparture: '',
  });

  const loadData = useCallback(async () => {
    setLoadError(false);
    let p; let holidays; let props;
    try {
      [p, holidays, props] = await Promise.all([
        api.getProperty(id),
        api.getSchoolHolidays(),
        api.getProperties(),
      ]);
    } catch (e) {
      setLoadError(true);
      return;
    }
    setProperty({
      ...p,
      // The server already returns the seasons ordered by the earliest date they cover, and each
      // one's closure-aware display ranges — no re-sorting, no date maths here.
      pricingRules: (p.pricingRules || []).map((r) => ({
        ...r,
        pricingMode: r.pricingMode || 'fixed',
        color: r.color || DEFAULT_COLORS[0],
        dateRanges: parseDateRanges(r.dateRanges, r.startDate, r.endDate),
        dateRangesVisible: Array.isArray(r.dateRangesVisible) ? r.dateRangesVisible : null,
        progressiveTiers: parseTiers(r.progressiveTiers),
      })),
    });
    setSchoolHolidays(holidays?.periods || []);
    setAllProperties(props || []);
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const seasons = property?.pricingRules || [];
  // Computed once per render: today in ISO, and the per-season upcoming ranges the table shows.
  const todayIso = toIsoDate(new Date());
  const upcomingRanges = useCallback(
    (season) => upcomingRangesFrom(season.dateRangesVisible || season.dateRanges, todayIso),
    [todayIso]
  );
  const otherProperties = useMemo(
    () => (allProperties || []).filter((p) => Number(p.id) !== Number(id)),
    [allProperties, id]
  );

  const refreshProgressivePreview = useCallback(async (pricePerNight, progressiveTiers) => {
    const requestId = ++progressivePreviewRequestRef.current;
    const preview = await api.previewProgressivePricing(id, {
      pricePerNight: Number(pricePerNight || 0),
      progressiveTiers: Array.isArray(progressiveTiers) ? progressiveTiers : [],
      maxNights: 14,
    });
    if (requestId !== progressivePreviewRequestRef.current) return null;
    setProgressivePreview(preview);
    return preview;
  }, [id]);

  const localDateValidationError = useMemo(() => {
    const currentRanges = getSortedDateRanges(seasonForm.dateRanges || []);
    if (currentRanges.some((range) => range.startDate > range.endDate)) {
      return 'Une plage de dates est invalide (début après fin).';
    }

    const otherSeasons = seasons.filter((season) => Number(season.id) !== Number(editingSeasonId));
    for (const currentRange of currentRanges) {
      for (const season of otherSeasons) {
        const seasonRanges = getSortedDateRanges(season.dateRanges || []);
        const conflict = seasonRanges.find((seasonRange) => (
          currentRange.startDate <= seasonRange.endDate && currentRange.endDate >= seasonRange.startDate
        ));
        if (conflict) {
          return `Chevauchement avec la saison "${season.label}" (${displayDate(conflict.startDate)} → ${displayDate(conflict.endDate)}).`;
        }
      }
    }
    return '';
  }, [seasonForm.dateRanges, seasons, editingSeasonId]);

  const minYear = useMemo(() => {
    const years = seasons
      .flatMap((s) => (s.dateRanges || []).flatMap((range) => [range.startDate, range.endDate]))
      .filter(Boolean)
      .map((d) => Number(String(d).slice(0, 4)));
    return years.length ? Math.min(...years, new Date().getFullYear()) : new Date().getFullYear();
  }, [seasons]);

  const maxYear = useMemo(() => {
    const years = seasons
      .flatMap((s) => (s.dateRanges || []).flatMap((range) => [range.startDate, range.endDate]))
      .filter(Boolean)
      .map((d) => Number(String(d).slice(0, 4)));
    return years.length ? Math.max(...years, new Date().getFullYear()) : new Date().getFullYear();
  }, [seasons]);

  useEffect(() => {
    setDisplayStartYear((prev) => Math.max(Math.min(prev, maxYear), minYear));
  }, [minYear, maxYear]);

  const yearsToDisplay = useMemo(() => {
    const years = [];
    for (let i = 0; i < displayYears; i++) {
      years.push(displayStartYear + i);
    }
    return years;
  }, [displayStartYear, displayYears]);

  // Public holidays are now server-computed; fetch them for the displayed years.
  const yearsKey = yearsToDisplay.join(',');
  useEffect(() => {
    let cancelled = false;
    const years = yearsKey.split(',').filter(Boolean).map(Number);
    if (years.length === 0) return undefined;
    api.getPublicHolidays(years)
      .then((list) => { if (!cancelled) setPublicHolidays(new Set((list || []).map((h) => h.date))); })
      .catch(() => { if (!cancelled) setPublicHolidays(new Set()); });
    return () => { cancelled = true; };
  }, [yearsKey]);

  const getSeasonForDate = (dateStr) => {
    return seasons.find((s) => (s.dateRanges || []).some((range) => dateStr >= range.startDate && dateStr <= range.endDate)) || null;
  };

  // Effective minimum nights for a day = its covering range's own min, else the season default, else 1.
  // Display-only (mirrors getSeasonForDate); the authoritative check lives in the server pricing engine.
  const getMinNightsForDate = (dateStr) => {
    for (const s of seasons) {
      const range = (s.dateRanges || []).find((r) => dateStr >= r.startDate && dateStr <= r.endDate);
      if (range) return Number(range.minNights ?? s.minNights ?? 1);
    }
    return 1;
  };

  const openAssignDialog = ({ startDate = '', endDate = '' } = {}) => {
    const covering = startDate ? getSeasonForDate(startDate) : null;
    setAssignForm({
      startDate,
      endDate,
      minNights: covering ? Number(covering.minNights || 1) : 1,
      targetMode: covering || seasons.length ? 'existing' : 'new',
      targetRuleId: covering ? covering.id : (seasons[0]?.id || ''),
      newLabel: `Période ${seasons.length + 1}`,
      newColor: DEFAULT_COLORS[seasons.length % DEFAULT_COLORS.length],
      newPrice: covering ? Number(covering.pricePerNight || 100) : 100,
      newMode: 'fixed',
    });
    setAssignError('');
    setAssignDialogOpen(true);
  };

  const handleAssignSubmit = async () => {
    const { startDate, endDate, minNights, targetMode, targetRuleId, newLabel, newColor, newPrice, newMode } = assignForm;
    if (!startDate || !endDate) return;
    const target = targetMode === 'existing'
      ? { mode: 'existing', ruleId: Number(targetRuleId) }
      : { mode: 'new', label: newLabel, color: newColor, pricePerNight: Number(newPrice || 0), pricingMode: newMode };
    try {
      setAssignError('');
      const result = await api.assignPricingDateRange(id, {
        startDate, endDate, minNights: Number(minNights || 1), target,
      });
      setAssignDialogOpen(false);
      await loadData();
      setPlatformRefresh((n) => n + 1);
      showSuccess(`Minimum de ${Number(minNights || 1)} nuit(s) appliqué du ${displayDate(startDate)} au ${displayDate(endDate)}.`);
      (result?.deletedLabels || []).forEach((lbl) => showSuccess(`Saison « ${lbl} » supprimée (dates réattribuées).`));
    } catch (error) {
      setAssignError(error.message || "Impossible d'affecter la période.");
    }
  };

  const handleDayMouseDown = (event, dateStr) => {
    if (event.button !== 0) return;
    isSelectingRef.current = true;
    dragMovedRef.current = false;
    setSelectionAnchor(dateStr);
    setSelectionHover(dateStr);
  };

  const handleDayMouseEnter = (dateStr) => {
    if (!isSelectingRef.current) return;
    if (dateStr !== selectionAnchor) dragMovedRef.current = true;
    setSelectionHover(dateStr);
  };

  const handleDayClick = (cell) => {
    // A plain click (no drag) opens the covering season for edit; a drag is handled on mouse-up.
    if (dragMovedRef.current) { dragMovedRef.current = false; return; }
    if (cell.inMonth && cell.season) openEditSeason(cell.season);
  };

  useEffect(() => {
    const onMouseUp = () => {
      if (!isSelectingRef.current) return;
      isSelectingRef.current = false;
      const a = selectionAnchor;
      const b = selectionHover;
      if (dragMovedRef.current && a && b) {
        openAssignDialog({ startDate: a <= b ? a : b, endDate: a <= b ? b : a });
      }
      setSelectionAnchor(null);
      setSelectionHover(null);
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionAnchor, selectionHover]);

  const selectionStart = selectionAnchor && selectionHover ? (selectionAnchor <= selectionHover ? selectionAnchor : selectionHover) : null;
  const selectionEnd = selectionAnchor && selectionHover ? (selectionAnchor <= selectionHover ? selectionHover : selectionAnchor) : null;
  const isInSelection = (dateStr) => Boolean(selectionStart && dateStr >= selectionStart && dateStr <= selectionEnd);

  const openCreateSeason = () => {
    const nextColor = DEFAULT_COLORS[seasons.length % DEFAULT_COLORS.length];
    const newForm = {
      label: `Saison ${seasons.length + 1}`,
      dateRanges: [{ startDate: '', endDate: '' }],
      color: nextColor,
      pricePerNight: 100,
      pricingMode: 'fixed',
      minNights: 1,
      maxNights: '',
      progressiveTiers: [],
      changeoverArrival: '',
      changeoverDeparture: '',
    };
    setEditingSeasonId(null);
    setSeasonForm(newForm);
    setInitialSeasonForm(JSON.parse(JSON.stringify(newForm)));
    setSeasonSaveError('');
    setBasePriceInput('');
    setTierPriceInputs({});
    setSeasonDialogOpen(true);
  };

  const openEditSeason = (season) => {
    const newForm = {
      label: season.label || '',
      dateRanges: parseDateRanges(season.dateRanges, season.startDate, season.endDate),
      color: season.color || DEFAULT_COLORS[0],
      pricePerNight: Number(season.pricePerNight || 0),
      pricingMode: season.pricingMode || 'fixed',
      minNights: Number(season.minNights || 1),
      maxNights: season.maxNights ?? '',
      progressiveTiers: parseTiers(season.progressiveTiers),
      changeoverArrival: season.changeoverArrival ?? '',
      changeoverDeparture: season.changeoverDeparture ?? '',
    };
    setEditingSeasonId(season.id);
    setSeasonForm(newForm);
    setInitialSeasonForm(JSON.parse(JSON.stringify(newForm)));
    setSeasonSaveError('');
    setBasePriceInput('');
    setTierPriceInputs({});
    setSeasonDialogOpen(true);
  };

  const hasModifications = () => {
    return JSON.stringify(seasonForm) !== JSON.stringify(initialSeasonForm);
  };

  const handleCloseDialog = () => {
    if (hasModifications()) {
      setConfirmDialogAction('close');
      setConfirmDialogOpen(true);
    } else {
      setSeasonDialogOpen(false);
      setSeasonSaveError('');
      setBasePriceInput('');
      setTierPriceInputs({});
    }
  };

  const handleConfirmDialogClose = () => {
    setConfirmDialogOpen(false);
    setConfirmDialogAction(null);
  };

  const handleConfirmDialogConfirm = () => {
    if (confirmDialogAction === 'close') {
      setSeasonDialogOpen(false);
      setSeasonSaveError('');
      handleConfirmDialogClose();
    } else if (confirmDialogAction === 'prefill') {
      handleConfirmDialogClose();
      handlePrefillProgressive();
    }
  };

  const handlePrefillProgressive = () => {
    setSeasonForm((prev) => ({
      ...prev,
      progressiveTiers: [],
    }));
  };

  const handlePrefillWithConfirm = () => {
    // Si des tarifs existent déjà, demander confirmation avant de les remplacer
    if (seasonForm.progressiveTiers && seasonForm.progressiveTiers.length > 0) {
      setConfirmDialogAction('prefill');
      setConfirmDialogOpen(true);
    } else {
      // Sinon, pré-remplir immédiatement
      handlePrefillProgressive();
    }
  };

  const handleSeasonFormField = (field, value) => {
    setSeasonForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateDateRange = (index, field, value) => {
    setSeasonSaveError('');
    setSeasonForm((prev) => ({
      ...prev,
      dateRanges: (prev.dateRanges || []).map((range, rangeIndex) => (
        rangeIndex === index ? { ...range, [field]: value } : range
      )),
    }));
  };

  const addDateRange = () => {
    setSeasonSaveError('');
    setSeasonForm((prev) => ({
      ...prev,
      dateRanges: [...(prev.dateRanges || []), { startDate: '', endDate: '' }],
    }));
  };

  const removeDateRange = (index) => {
    setSeasonSaveError('');
    setSeasonForm((prev) => ({
      ...prev,
      dateRanges: (prev.dateRanges || []).filter((_, rangeIndex) => rangeIndex !== index),
    }));
  };

  const ensureProgressiveDefaults = () => {
    setSeasonForm((prev) => {
      if (prev.pricingMode !== 'progressive') return prev;
      if ((prev.progressiveTiers || []).length > 0) return prev;
      return {
        ...prev,
        progressiveTiers: [],
      };
    });
  };

  const handleBasePriceChange = (value) => {
    const parsedValue = parseDecimalInput(value);
    if (parsedValue === null) return;
    const numericValue = Number.isFinite(parsedValue) ? Math.round(Math.max(0, parsedValue) * 100) / 100 : 0;
    setSeasonForm((prev) => {
      return { ...prev, pricePerNight: numericValue };
    });
  };

  const updateTierByPrice = (nightNumber, value) => {
    const parsedValue = parseDecimalInput(value);
    if (parsedValue === null) return;
    setSeasonForm((prev) => ({
      ...prev,
      progressiveTiers: (() => {
        const currentTiers = Array.isArray(prev.progressiveTiers) ? [...prev.progressiveTiers] : [];
        const tierIndex = currentTiers.findIndex((tier) => Number(tier.nightNumber) === Number(nightNumber));
        const nextTier = {
          ...(tierIndex >= 0 ? currentTiers[tierIndex] : { nightNumber }),
          nightNumber,
          extraNightPrice: Math.max(0, Math.round(parsedValue * 100) / 100),
        };
        delete nextTier.extraNightDiscountPct;
        if (tierIndex >= 0) currentTiers[tierIndex] = nextTier;
        else currentTiers.push(nextTier);
        return currentTiers;
      })(),
    }));
  };

  const updateTierByPct = (nightNumber, value) => {
    setSeasonForm((prev) => ({
      ...prev,
      progressiveTiers: (() => {
        const currentTiers = Array.isArray(prev.progressiveTiers) ? [...prev.progressiveTiers] : [];
        const tierIndex = currentTiers.findIndex((tier) => Number(tier.nightNumber) === Number(nightNumber));
        const nextTier = {
          ...(tierIndex >= 0 ? currentTiers[tierIndex] : { nightNumber }),
          nightNumber,
          extraNightDiscountPct: Math.max(0, Math.min(100, Number(value || 0))),
        };
        delete nextTier.extraNightPrice;
        if (tierIndex >= 0) currentTiers[tierIndex] = nextTier;
        else currentTiers.push(nextTier);
        return currentTiers;
      })(),
    }));
  };

  const handleSaveSeason = async () => {
    const validDateRanges = (seasonForm.dateRanges || []).filter((range) => range.startDate && range.endDate);
    if (validDateRanges.length === 0 || localDateValidationError) return;
    const payload = {
      label: seasonForm.label,
      dateRanges: validDateRanges,
      color: seasonForm.color,
      pricePerNight: Number(seasonForm.pricePerNight || 0),
      pricingMode: seasonForm.pricingMode || 'fixed',
      minNights: Number(seasonForm.minNights || 1),
      maxNights: seasonForm.maxNights === '' ? null : Number(seasonForm.maxNights),
      progressiveTiers: seasonForm.pricingMode === 'progressive' ? seasonForm.progressiveTiers : [],
      changeoverArrival: seasonForm.changeoverArrival === '' ? null : Number(seasonForm.changeoverArrival),
      changeoverDeparture: seasonForm.changeoverDeparture === '' ? null : Number(seasonForm.changeoverDeparture),
    };
    try {
      setSeasonSaveError('');
      if (editingSeasonId) {
        await api.updatePricingRule(id, editingSeasonId, payload);
      } else {
        await api.addPricingRule(id, payload);
      }
      setSeasonDialogOpen(false);
      setEditingSeasonId(null);
      await loadData();
      setPlatformRefresh((n) => n + 1);
    } catch (error) {
      setSeasonSaveError(error.message || "Impossible d'enregistrer la saison.");
    }
  };

  const handleDeleteSeason = async () => {
    if (!deleteTarget) return;
    await api.deletePricingRule(id, deleteTarget.id);
    setDeleteTarget(null);
    await loadData();
    setPlatformRefresh((n) => n + 1);
  };

  const openApplyDialog = () => {
    setApplyTargetPropertyId(otherProperties[0]?.id || '');
    setApplyReplaceExisting(true);
    setApplyDialogOpen(true);
  };

  const handleApplyToProperty = async () => {
    if (!applyTargetPropertyId) return;
    try {
      const result = await api.applyPricingRulesToProperty(id, {
        targetPropertyId: Number(applyTargetPropertyId),
        replaceExisting: applyReplaceExisting,
      });
      setApplyDialogOpen(false);
      const targetName = otherProperties.find((p) => Number(p.id) === Number(applyTargetPropertyId))?.name || 'logement cible';
      showSuccess(`${result.copiedRules || 0} saison(s) appliquée(s) vers "${targetName}".`);
    } catch (error) {
      showError(error.message || 'Impossible d\'appliquer les saisons.');
    }
  };

  useEffect(() => {
    if (!seasonDialogOpen || seasonForm.pricingMode !== 'progressive') {
      setProgressivePreview({ weekPriceEquivalent: 0, rows: [], progressiveTiers: [] });
      return;
    }

    let cancelled = false;
    refreshProgressivePreview(seasonForm.pricePerNight, seasonForm.progressiveTiers)
      .then((preview) => {
        if (!preview || cancelled) return;
        const nextSerialized = JSON.stringify(preview.progressiveTiers || []);
        const currentSerialized = JSON.stringify(seasonForm.progressiveTiers || []);
        if (nextSerialized !== currentSerialized) {
          setSeasonForm((prev) => ({
            ...prev,
            progressiveTiers: preview.progressiveTiers || [],
          }));
          // Tiers are STORED normalized over 365 nights but previewed over 14, so opening a
          // progressive season always rewrites them here — which used to mark a merely-consulted
          // form as modified and pop the « quitter sans enregistrer ? » confirm on Annuler.
          // When the rewrite is a pure normalization (the user hasn't edited a tier yet, i.e. the
          // form still carries the pristine list), move the pristine snapshot with it so the form
          // stays clean. A real tier edit leaves the snapshot behind and still counts as dirty.
          setInitialSeasonForm((pristine) => (
            JSON.stringify(pristine.progressiveTiers || []) === currentSerialized
              ? { ...pristine, progressiveTiers: preview.progressiveTiers || [] }
              : pristine
          ));
        }
      })
      .catch(() => {
        // Keep current values if preview refresh fails.
      });

    return () => {
      cancelled = true;
    };
  }, [seasonDialogOpen, seasonForm.pricingMode, seasonForm.pricePerNight, seasonForm.progressiveTiers, refreshProgressivePreview]);

  if (loadError) {
    return <Box><PageActionBar title="Gestion tarifaire" backTo={`/properties/${id}`} /><ErrorAlert message="Impossible de charger la tarification du logement." onRetry={loadData} /></Box>;
  }
  if (!property) {
    return <Box><PageActionBar title="Gestion tarifaire" backTo={`/properties/${id}`} /><LoadingState label="Chargement de la tarification…" /></Box>;
  }

  return (
    <Box>
      <PageActionBar
        title={`Gestion tarifaire - ${property.name}`}
        titleOnXs
        backTo={`/properties/${id}`}
        actionsBefore={[{
          node: (
            <Button key="apply-other" variant="outlined" size="small" onClick={openApplyDialog} disabled={otherProperties.length === 0}>
              Appliquer à un autre logement
            </Button>
          ),
        }, {
          node: (
            <Button key="assign-period" variant="outlined" size="small" startIcon={<DateRangeIcon />} onClick={() => openAssignDialog({})}>
              Affecter une période
            </Button>
          ),
        }, {
          node: (
            <Button key="new-season" variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreateSeason}>
              Nouvelle saison
            </Button>
          ),
        }]}
      />
      {/* Tariff recipe (specs/tariff-recipes/spec.md §3.2): pick + preview + apply. */}
      <TariffRecipeCard
        propertyId={id}
        activeRecipeId={property.tariffRecipeId || ''}
        appliedVersion={property.tariffRecipeVersion || ''}
        rateInclusions={property.rateInclusions || []}
        onApplied={async () => { await loadData(); setPlatformRefresh((n) => n + 1); showSuccess('Recette appliquée.'); }}
        onError={(message) => showError(message)}
      />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" sx={{ mb: 2 }}>Saisons</Typography>
          <TableCard minWidth={980}>
              <TableHead>
                <TableRow>
                  <TableCell>Saison</TableCell>
                  <TableCell>Dates</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Tarif base 1 nuit</TableCell>
                  <TableCell>Min – max nuits</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {seasons.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: (t) => s.color || t.palette.primary.main }} />
                        {s.label}
                        {/* Recipe-owned vs manual (specs/tariff-recipes/spec.md §3.2 rule 9). */}
                        <Chip
                          size="small"
                          variant="outlined"
                          color={s.seasonKey ? 'info' : 'default'}
                          label={s.seasonKey ? `recette · ${s.seasonKey}` : 'Manuelle'}
                          sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
                        />
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        {/* Closed dates are hidden from the display only — the stored ranges keep
                            their full span, so moving a closure re-reveals them
                            (specs/tariff-recipes/spec.md §3.4 rule 25ter). Past ranges are hidden
                            too: only what is still sellable is worth reading here. */}
                        {upcomingRanges(s).map((range, index, all) => (
                          <React.Fragment key={`${s.id}-range-${index}`}>
                            {(index === 0 || range.startDate.slice(0, 4) !== all[index - 1].startDate.slice(0, 4)) && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: index === 0 ? 0 : 0.75, mb: 0.25 }}>
                                <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 600, letterSpacing: 0.5 }}>
                                  {range.startDate.slice(0, 4)}
                                </Typography>
                                <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                              </Box>
                            )}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <Typography variant="body2" sx={{ lineHeight: 1.25 }}>
                                {displayDate(range.startDate)} → {displayDate(range.endDate)}
                              </Typography>
                              {range.minNights != null && (
                                <Chip size="small" label={`min ${range.minNights}`} color="warning" variant="outlined" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }} />
                              )}
                              {/* WHY this week is priced the way it is, readable from the table alone
                                  (specs/tariff-events-and-extra-guest-tiers §3.3 rule 15bis). */}
                              {range.eventLabel && (
                                <Chip
                                  size="small"
                                  icon={<EventIcon sx={{ fontSize: 14 }} />}
                                  label={range.eventLabel}
                                  color="secondary"
                                  variant="outlined"
                                  sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
                                />
                              )}
                            </Box>
                          </React.Fragment>
                        ))}
                        {upcomingRanges(s).length === 0 && (
                          <Typography variant="caption" color="text.secondary">
                            {getSortedDateRanges(s.dateRanges).length === 0
                              ? 'aucune plage'
                              : (getSortedDateRanges(s.dateRangesVisible || s.dateRanges).length === 0
                                ? 'entièrement en fermeture'
                                : 'aucune date à venir')}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>{s.pricingMode === 'progressive' ? 'Dégressif' : 'Fixe'}</TableCell>
                    <TableCell>{formatCurrency(Number(s.pricePerNight || 0))}</TableCell>
                    <TableCell>{s.minNights}{s.maxNights ? ` – ${s.maxNights}` : ''}</TableCell>
                    <TableCell>
                      <Button size="small" startIcon={<EditIcon fontSize="small" />} onClick={() => openEditSeason(s)}>Modifier</Button>
                      <Button size="small" color="error" startIcon={<DeleteIcon fontSize="small" />} onClick={() => setDeleteTarget(s)}>Supprimer</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {seasons.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ p: 0, border: 0 }}>
                      <EmptyState message="Aucune saison. Créez votre première saison." py={4} />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
          </TableCard>
        </CardContent>
      </Card>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        {yearsToDisplay.map((year) => (
          <Grid key={year} size={12}>
            <Card>
              <CardContent>
                {/* One year at a time, navigated by the arrows framing it. */}
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: { xs: 1, sm: 2 }, mb: 2.5 }}>
                  <IconButton
                    onClick={() => setDisplayStartYear((y) => y - 1)}
                    disabled={displayStartYear <= minYear - 1}
                    aria-label="Année précédente"
                    size="large"
                  >
                    <ChevronLeftIcon fontSize="inherit" />
                  </IconButton>
                  <Typography
                    component="div"
                    sx={{ fontSize: { xs: 30, sm: 40 }, fontWeight: 700, lineHeight: 1, minWidth: { xs: 100, sm: 130 }, textAlign: 'center', letterSpacing: 1 }}
                  >
                    {year}
                  </Typography>
                  <IconButton
                    onClick={() => setDisplayStartYear((y) => y + 1)}
                    disabled={displayStartYear >= maxYear + 2}
                    aria-label="Année suivante"
                    size="large"
                  >
                    <ChevronRightIcon fontSize="inherit" />
                  </IconButton>
                </Box>
                <Grid container spacing={1.5}>
                  {Array.from({ length: 12 }, (_, month) => {
                    const first = new Date(year, month, 1);
                    const last = new Date(year, month + 1, 0);
                    const startGrid = getMondayStart(first);
                    const cells = [];
                    for (let i = 0; i < 42; i++) {
                      const d = new Date(startGrid);
                      d.setDate(startGrid.getDate() + i);
                      const dateStr = toIsoDate(d);
                      const inMonth = d.getMonth() === month;
                      const season = getSeasonForDate(dateStr);
                      const isPublicHoliday = publicHolidays.has(dateStr);
                      const schoolInfo = getSchoolHolidayInfo(dateStr, schoolHolidays);
                      const coveringRange = season ? (season.dateRanges || []).find((r) => dateStr >= r.startDate && dateStr <= r.endDate) : null;
                      const seasonDefaultMin = season ? Number(season.minNights || 1) : 1;
                      const dayMin = coveringRange ? Number(coveringRange.minNights ?? seasonDefaultMin) : seasonDefaultMin;
                      // Changeover markers (specs/tariff-recipes/spec.md §3.4 rule 25): range override
                      // ⇒ season default ⇒ unrestricted; the marker shows only on the permitted weekday.
                      const arrivalDay = coveringRange?.changeoverArrival ?? season?.changeoverArrival ?? null;
                      const departureDay = coveringRange?.changeoverDeparture ?? season?.changeoverDeparture ?? null;
                      const weekday = d.getDay();
                      const isArrivalDay = arrivalDay != null && arrivalDay !== '' && Number(arrivalDay) === weekday;
                      const isDepartureDay = departureDay != null && departureDay !== '' && Number(departureDay) === weekday;
                      const closure = findClosureForDate(property.closureRanges, dateStr);
                      const eventLabel = coveringRange?.eventLabel || null;
                      cells.push({ dateStr, day: d.getDate(), inMonth, season, isPublicHoliday, schoolInfo, dayMin, seasonDefaultMin, isArrivalDay, isDepartureDay, closure, eventLabel });
                    }

                    return (
                      <Grid
                        key={`${year}-${month}`}
                        size={{
                          xs: 12,
                          sm: 6,
                          md: 4,
                          lg: 3
                        }}>
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1 }}>
                          <Typography variant="caption" sx={{ fontWeight: 700, mb: 0.5, display: 'block' }}>{monthLabel(year, month)}</Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.3 }}>
                            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((wd, idx) => (
                              <Typography key={`${wd}-${idx}`} variant="caption" sx={{ textAlign: 'center', color: 'text.secondary', fontWeight: 700 }}>{wd}</Typography>
                            ))}
                            {cells.map((c, idx) => (
                              <Box
                                key={`${c.dateStr}-${idx}`}
                                onMouseDown={(e) => { if (c.inMonth) handleDayMouseDown(e, c.dateStr); }}
                                onMouseEnter={() => { if (c.inMonth) handleDayMouseEnter(c.dateStr); }}
                                onClick={() => handleDayClick(c)}
                                sx={{
                                  height: 20,
                                  borderRadius: 0.8,
                                  userSelect: 'none',
                                  // A closed day is greyed out and loses its season colour: it is not
                                  // sellable, so showing a tariff there is noise (spec rule 25bis).
                                  borderTop: (t) => (c.inMonth && c.season && !c.closure ? `3px solid ${c.season.color || t.palette.primary.main}` : '3px solid transparent'),
                                  bgcolor: (t) => {
                                    if (!c.inMonth) return 'transparent';
                                    if (isInSelection(c.dateStr)) return alpha(t.palette.primary.main, 0.28);
                                    if (c.closure) return t.palette.action.disabledBackground;
                                    return c.season ? `${c.season.color || t.palette.primary.main}22` : t.palette.background.paper;
                                  },
                                  color: c.inMonth ? (c.closure ? 'text.disabled' : 'text.primary') : 'transparent',
                                  fontSize: 10,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  position: 'relative',
                                  cursor: c.inMonth ? 'pointer' : 'default',
                                  // An event night keeps its season colour on top and adds a dotted
                                  // frame — a third channel that reads as « something else decided
                                  // this week » (specs/tariff-events-and-extra-guest-tiers §6).
                                  border: (t) => (c.inMonth && c.eventLabel && !c.closure
                                    ? `1px dotted ${t.palette.secondary.main}` : '1px solid transparent'),
                                  outline: (t) => (isInSelection(c.dateStr) ? `2px solid ${t.palette.primary.main}` : 'none'),
                                  outlineOffset: '-2px',
                                  '&:hover': c.inMonth && !isInSelection(c.dateStr) ? {
                                    outline: (t) => `1px solid ${c.season ? (c.season.color || t.palette.primary.main) : t.palette.divider}`,
                                  } : undefined,
                                }}
                                title={c.closure
                                  ? `Fermé — ${c.closure.label || 'fermeture'} (${displayDate(c.closure.startDate)} → ${displayDate(c.closure.endDate)})`
                                  : [
                                    c.season ? `${c.season.label} (${getSortedDateRanges(c.season.dateRangesVisible || c.season.dateRanges).map((range) => `${displayDate(range.startDate)} → ${displayDate(range.endDate)}`).join(' | ')})` : '',
                                    c.inMonth && c.dayMin > 1 ? `min ${c.dayMin} nuits` : '',
                                    c.eventLabel || '',
                                  ].filter(Boolean).join(' · ')}
                              >
                                {c.inMonth ? c.day : ''}
                                {/* Effective minimum shown whenever it exceeds 1 — a season-wide
                                    minimum is a constraint too, not only a range override
                                    (specs/tariff-recipes/spec.md §3.4 rule 25). */}
                                {!c.closure && c.inMonth && c.dayMin > 1 && (
                                  <Box sx={{ position: 'absolute', top: -1, right: 1, fontSize: 8, fontWeight: 700, color: 'warning.dark', lineHeight: 1 }}>
                                    {c.dayMin}
                                  </Box>
                                )}
                                {!c.closure && c.inMonth && c.isArrivalDay && (
                                  <Box sx={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderLeft: '4px solid', borderLeftColor: 'success.main' }} />
                                )}
                                {!c.closure && c.inMonth && c.isDepartureDay && (
                                  <Box sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderRight: '4px solid', borderRightColor: 'secondary.main' }} />
                                )}
                                {c.inMonth && c.isPublicHoliday && (
                                  <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: 'error.main', position: 'absolute', bottom: 1, left: 1 }} />
                                )}
                                {c.inMonth && c.schoolInfo && (
                                  <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: 'info.main', position: 'absolute', bottom: 1, right: 1 }} />
                                )}
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      </Grid>
                    );
                  })}
                </Grid>
                {/* Legend (specs/tariff-recipes/spec.md §3.4 rule 25) — the calendar now carries five
                    distinct signals; every marker is named here. */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 1.5, sm: 2.5 }, mt: 1.5, alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: 'action.disabledBackground', border: '1px solid', borderColor: 'divider' }} />
                    <Typography variant="caption" color="text.secondary">fermeture</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />
                    <Typography variant="caption" color="text.secondary">jour férié</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'info.main' }} />
                    <Typography variant="caption" color="text.secondary">vacances scolaires</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'warning.dark' }}>3</Typography>
                    <Typography variant="caption" color="text.secondary">minimum de nuits</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: '5px solid', borderLeftColor: 'success.main' }} />
                    <Typography variant="caption" color="text.secondary">arrivée possible</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderRight: '5px solid', borderRightColor: 'secondary.main' }} />
                    <Typography variant="caption" color="text.secondary">départ possible</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: 0.5, border: '1px dotted', borderColor: 'secondary.main' }} />
                    <Typography variant="caption" color="text.secondary">événement</Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* « Prix plateformes » — placed last on the page (specs/platform-price-from-commission.md §6):
          gross-up of each season net /nuit by each platform's commission %. */}
      <PlatformPriceCard propertyId={id} refreshKey={platformRefresh} />

      <FormDialog
        open={seasonDialogOpen}
        onClose={handleCloseDialog}
        title={editingSeasonId ? 'Modifier la saison' : 'Nouvelle saison'}
        maxWidth="md"
        onSubmit={handleSaveSeason}
        submitDisabled={!(seasonForm.dateRanges || []).some((range) => range.startDate && range.endDate) || !seasonForm.label || Boolean(localDateValidationError)}
      >
          <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="fr" localeText={frFR.components.MuiLocalizationProvider.defaultProps.localeText}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {seasonSaveError && <Alert severity="error">{seasonSaveError}</Alert>}
            {localDateValidationError && <Alert severity="error">{localDateValidationError}</Alert>}
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField label="Nom de la saison" value={seasonForm.label} onChange={(e) => handleSeasonFormField('label', e.target.value)} fullWidth />
              <TextField label="Couleur" type="color" value={seasonForm.color} onChange={(e) => handleSeasonFormField('color', e.target.value)} sx={{ width: 140 }} />
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem' }}>Plages de dates</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={addDateRange}>Ajouter une plage</Button>
              </Box>
              {(seasonForm.dateRanges || []).map((range, index) => (
                <Box key={index} sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' } }}>
                  <DatePicker
                    label="Date début"
                    value={isoToDayjs(range.startDate)}
                    onChange={(value) => updateDateRange(index, 'startDate', dayjsToIso(value))}
                    referenceDate={isoToDayjs(range.startDate || range.endDate) || dayjs()}
                    format="DD/MM/YYYY"
                    slotProps={{ textField: { fullWidth: true } }}
                  />
                  <DatePicker
                    label="Date fin"
                    value={isoToDayjs(range.endDate)}
                    onChange={(value) => updateDateRange(index, 'endDate', dayjsToIso(value))}
                    referenceDate={isoToDayjs(range.endDate || range.startDate) || dayjs()}
                    format="DD/MM/YYYY"
                    slotProps={{ textField: { fullWidth: true } }}
                  />
                  <TextField
                    label="Min nuits"
                    type="number"
                    value={range.minNights ?? ''}
                    onChange={(e) => updateDateRange(index, 'minNights', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder={String(seasonForm.minNights || 1)}
                    sx={{ width: { xs: '100%', sm: 130 } }}
                    slotProps={{ htmlInput: { min: 1 }, inputLabel: { shrink: true } }}
                  />
                  <Button color="error" disabled={(seasonForm.dateRanges || []).length === 1} onClick={() => removeDateRange(index)}>
                    Supprimer
                  </Button>
                </Box>
              ))}
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField
                label="Tarif base (1 nuit)"
                type="text"
                value={basePriceInput !== '' ? basePriceInput : formatDecimalForInput(seasonForm.pricePerNight)}
                onFocus={() => {
                  setBasePriceInput((prev) => (prev !== '' ? prev : formatDecimalForInput(seasonForm.pricePerNight)));
                }}
                onChange={(e) => {
                  const rawValue = sanitizeDecimalInput(e.target.value);
                  setBasePriceInput(rawValue);
                  handleBasePriceChange(rawValue);
                }}
                onBlur={() => {
                  handleBasePriceChange(basePriceInput);
                  setBasePriceInput('');
                }}
                fullWidth
                slotProps={{
                  htmlInput: { inputMode: 'decimal' }
                }}
              />
              <FormControl fullWidth>
                <InputLabel>Type de tarification</InputLabel>
                <Select
                  value={seasonForm.pricingMode}
                  label="Type de tarification"
                  onChange={(e) => {
                    const mode = e.target.value;
                    setSeasonForm((prev) => ({ ...prev, pricingMode: mode }));
                    if (mode === 'progressive') {
                      setTimeout(ensureProgressiveDefaults, 0);
                    }
                  }}
                >
                  <MenuItem value="fixed">Fixe</MenuItem>
                  <MenuItem value="progressive">Dégressif</MenuItem>
                </Select>
              </FormControl>
              <TextField label="Min nuits" type="number" value={seasonForm.minNights} onChange={(e) => handleSeasonFormField('minNights', Number(e.target.value || 1))} fullWidth slotProps={{
                htmlInput: { min: 1 }
              }} />
              <TextField
                label="Max nuits"
                type="number"
                value={seasonForm.maxNights}
                onChange={(e) => handleSeasonFormField('maxNights', e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="illimité"
                fullWidth
                helperText="Laisser vide = illimité"
                slotProps={{ htmlInput: { min: 1 }, inputLabel: { shrink: true } }}
              />
            </Box>

            {/* Changeover day (specs/tariff-recipes/spec.md §3.4): restrict the arrival and/or
                departure weekday for the season. « Aucun » = unrestricted (the default). */}
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <FormControl fullWidth>
                <InputLabel id="changeover-arrival-label">Jour d'arrivée imposé</InputLabel>
                <Select
                  labelId="changeover-arrival-label"
                  label="Jour d'arrivée imposé"
                  value={seasonForm.changeoverArrival}
                  onChange={(e) => handleSeasonFormField('changeoverArrival', e.target.value)}
                >
                  <MenuItem value="">Aucun</MenuItem>
                  {WEEKDAYS_FR.map((d) => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel id="changeover-departure-label">Jour de départ imposé</InputLabel>
                <Select
                  labelId="changeover-departure-label"
                  label="Jour de départ imposé"
                  value={seasonForm.changeoverDeparture}
                  onChange={(e) => handleSeasonFormField('changeoverDeparture', e.target.value)}
                >
                  <MenuItem value="">Aucun</MenuItem>
                  {WEEKDAYS_FR.map((d) => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>

            {seasonForm.pricingMode === 'progressive' && (
              <>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip label={`Tarif semaine équivalent: ${formatCurrency(Number(progressivePreview.weekPriceEquivalent || 0))}`} color="primary" variant="outlined" />
                  <Button size="small" variant="outlined" onClick={handlePrefillWithConfirm}>
                    Pré-remplir modèle dégressif standard
                  </Button>
                </Box>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ width: '100%', tableLayout: 'auto' }}>
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.100' }}>
                        <TableCell sx={{ fontWeight: 600, minWidth: { xs: 40, sm: 50 } }}>Nuit</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, minWidth: { xs: 100, sm: 130 } }}>Prix nuit €</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, minWidth: { xs: 100, sm: 130 } }}>Réduction %</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, minWidth: { xs: 100, sm: 130 } }}>Total cumulé €</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {progressivePreview.rows.map((t, idx) => {
                        return (
                          <TableRow 
                            key={`tier-${t.nightNumber}`}
                            sx={{ 
                              bgcolor: idx % 2 === 0 ? 'grey.50' : 'background.paper',
                              '&:hover': { bgcolor: 'action.hover' }
                            }}
                          >
                            <TableCell sx={{ fontWeight: 500, py: { xs: 0.75, sm: 1 } }}>{t.nightNumber}</TableCell>
                            <TableCell align="right" sx={{ py: { xs: 0.75, sm: 1 } }}>
                              <TextField
                                size="small"
                                type="text"
                                value={tierPriceInputs[t.nightNumber] ?? formatDecimalForInput(t.extraNightPrice)}
                                onFocus={() => {
                                  setTierPriceInputs((prev) => ({
                                    ...prev,
                                    [t.nightNumber]: prev[t.nightNumber] ?? formatDecimalForInput(t.extraNightPrice),
                                  }));
                                }}
                                onChange={(e) => {
                                  const rawValue = sanitizeDecimalInput(e.target.value);
                                  setTierPriceInputs((prev) => ({
                                    ...prev,
                                    [t.nightNumber]: rawValue,
                                  }));
                                  updateTierByPrice(t.nightNumber, rawValue);
                                }}
                                onBlur={() => {
                                  const rawValue = tierPriceInputs[t.nightNumber] ?? '';
                                  updateTierByPrice(t.nightNumber, rawValue);
                                  setTierPriceInputs((prev) => {
                                    const next = { ...prev };
                                    delete next[t.nightNumber];
                                    return next;
                                  });
                                }}
                                sx={{ width: { xs: 100, sm: 120 } }}
                                disabled={t.readOnly}
                                slotProps={{
                                  input: { endAdornment: <InputAdornment position="end" sx={{ mr: 0.5 }}>€</InputAdornment> },
                                  htmlInput: { inputMode: 'decimal' }
                                }} />
                            </TableCell>
                            <TableCell align="right" sx={{ py: { xs: 0.75, sm: 1 } }}>
                              <TextField
                                size="small"
                                type="number"
                                value={Number(t.extraNightDiscountPct || 0).toFixed(0)}
                                onChange={(e) => updateTierByPct(t.nightNumber, e.target.value)}
                                sx={{ width: { xs: 100, sm: 120 } }}
                                disabled={t.readOnly}
                                slotProps={{
                                  input: { endAdornment: <InputAdornment position="end" sx={{ mr: 0.5 }}>%</InputAdornment> },
                                  htmlInput: { min: 0, max: 100, step: 1 }
                                }} />
                            </TableCell>
                            <TableCell align="right" sx={(t) => ({ fontWeight: 500, bgcolor: alpha(t.palette.info.main, 0.12), py: { xs: 1, sm: 1 } })}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                                {formatCurrency(Number(t.cumulativePrice || 0))}
                              </Box>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {progressivePreview.rows.length <= 1 && (
                        <TableRow><TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>Aucun palier. Utilisez le bouton de pré-remplissage.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
            </Box>
          </LocalizationProvider>
      </FormDialog>
      <FormDialog
        open={applyDialogOpen}
        onClose={() => setApplyDialogOpen(false)}
        title="Appliquer les saisons à un autre logement"
        maxWidth="sm"
        submitLabel="Appliquer"
        onSubmit={handleApplyToProperty}
        submitDisabled={!applyTargetPropertyId}
      >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Logement cible</InputLabel>
              <Select
                value={applyTargetPropertyId}
                label="Logement cible"
                onChange={(e) => setApplyTargetPropertyId(e.target.value)}
              >
                {otherProperties.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={<Switch checked={applyReplaceExisting} onChange={(e) => setApplyReplaceExisting(e.target.checked)} />}
              label="Remplacer toutes les saisons existantes du logement cible"
            />

            {!applyReplaceExisting && (
              <Alert severity="info">
                En mode ajout, l'application est refusée si une saison existante du logement cible chevauche une plage copiée.
              </Alert>
            )}
          </Box>
      </FormDialog>
      <FormDialog
        open={assignDialogOpen}
        onClose={() => setAssignDialogOpen(false)}
        title="Affecter une période à une saison"
        maxWidth="sm"
        submitLabel="Appliquer"
        onSubmit={handleAssignSubmit}
        submitDisabled={
          !assignForm.startDate || !assignForm.endDate
          || assignForm.startDate > assignForm.endDate
          || (assignForm.targetMode === 'existing' && !assignForm.targetRuleId)
          || (assignForm.targetMode === 'new' && !assignForm.newLabel)
        }
      >
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="fr" localeText={frFR.components.MuiLocalizationProvider.defaultProps.localeText}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {assignError && <Alert severity="error">{assignError}</Alert>}
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <DatePicker
                label="Début"
                value={isoToDayjs(assignForm.startDate)}
                onChange={(value) => setAssignForm((prev) => ({ ...prev, startDate: dayjsToIso(value) }))}
                format="DD/MM/YYYY"
                slotProps={{ textField: { fullWidth: true } }}
              />
              <DatePicker
                label="Fin"
                value={isoToDayjs(assignForm.endDate)}
                onChange={(value) => setAssignForm((prev) => ({ ...prev, endDate: dayjsToIso(value) }))}
                format="DD/MM/YYYY"
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Box>

            <FormControl>
              <FormLabel sx={{ fontSize: '0.85rem', mb: 0.5 }}>Rattacher à</FormLabel>
              <RadioGroup
                row
                value={assignForm.targetMode}
                onChange={(e) => setAssignForm((prev) => ({ ...prev, targetMode: e.target.value }))}
              >
                <FormControlLabel value="existing" control={<Radio size="small" />} label="Une saison existante" />
                <FormControlLabel value="new" control={<Radio size="small" />} label="Une nouvelle saison" />
              </RadioGroup>
            </FormControl>

            {assignForm.targetMode === 'existing' ? (
              <FormControl fullWidth>
                <InputLabel>Saison</InputLabel>
                <Select
                  value={assignForm.targetRuleId}
                  label="Saison"
                  onChange={(e) => setAssignForm((prev) => ({ ...prev, targetRuleId: e.target.value }))}
                >
                  {seasons.map((s) => (
                    <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                <TextField label="Nom de la saison" value={assignForm.newLabel} onChange={(e) => setAssignForm((prev) => ({ ...prev, newLabel: e.target.value }))} fullWidth />
                <TextField label="Couleur" type="color" value={assignForm.newColor} onChange={(e) => setAssignForm((prev) => ({ ...prev, newColor: e.target.value }))} sx={{ width: 120 }} />
                <TextField label="Tarif base (1 nuit)" type="number" value={assignForm.newPrice} onChange={(e) => setAssignForm((prev) => ({ ...prev, newPrice: Number(e.target.value || 0) }))} sx={{ width: { xs: '100%', sm: 160 } }} slotProps={{ htmlInput: { min: 0, step: 1, inputMode: 'decimal' } }} />
              </Box>
            )}

            <TextField
              label="Nuits minimum sur cette période"
              type="number"
              value={assignForm.minNights}
              onChange={(e) => setAssignForm((prev) => ({ ...prev, minNights: Number(e.target.value || 1) }))}
              fullWidth
              slotProps={{ htmlInput: { min: 1 } }}
            />

            <Alert severity="info">
              La ou les saisons couvrant cette période seront découpées autour d'elle ; une saison entièrement recouverte sera supprimée. Le tarif du reste de la saison n'est pas modifié.
            </Alert>
          </Box>
        </LocalizationProvider>
      </FormDialog>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteSeason}
        title="Supprimer la saison"
        message={deleteTarget ? `Supprimer la saison ${deleteTarget.label} ?` : ''}
        confirmLabel="Supprimer"
      />
      <ConfirmDialog
        open={confirmDialogOpen}
        onClose={handleConfirmDialogClose}
        onConfirm={handleConfirmDialogConfirm}
        title={
          confirmDialogAction === 'prefill'
            ? 'Pré-remplir le modèle dégressif'
            : 'Vous avez des modifications non enregistrées'
        }
        message={
          confirmDialogAction === 'prefill'
            ? 'Êtes-vous sûr ? Cela remplacera tous les tarifs actuels par le modèle de pricing dégressif standard et vous perdrez vos modifications.'
            : 'Vous avez des modifications dans cette saison qui ne seront pas enregistrées. Êtes-vous sûr de vouloir continuer ?'
        }
        confirmLabel={confirmDialogAction === 'prefill' ? 'Pré-remplir' : 'Abandonner les modifications'}
        confirmColor={confirmDialogAction === 'prefill' ? 'warning' : 'error'}
      />
    </Box>
  );
}
