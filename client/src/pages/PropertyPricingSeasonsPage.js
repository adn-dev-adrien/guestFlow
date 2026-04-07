import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Box, Typography, Card, CardContent, Button, Grid, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Table, TableHead, TableRow,
  TableCell, TableBody, TableContainer, FormControl, InputLabel, Select,
  MenuItem, Chip, Alert
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import api from '../api';
import { displayDate } from '../utils/formatters';
import { withFrom } from '../utils/navigation';
import { getFrenchPublicHolidays, getSchoolHolidayInfo } from '../frenchHolidays';

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

function getWeekPriceEquivalent(baseNightPrice) {
  return Number(baseNightPrice || 0) * 2;
}

function getTotalFromWeeklyModel(baseNightPrice, nights) {
  const weekPrice = getWeekPriceEquivalent(baseNightPrice);
  if (nights <= 0) return 0;
  if (nights <= 2) return weekPrice * 0.5;
  if (nights === 3) return weekPrice * 0.6;
  if (nights === 4) return weekPrice * 0.7;
  if (nights === 5) return weekPrice * 0.8;
  if (nights === 6) return weekPrice * 0.9;
  if (nights === 7) return weekPrice;
  return weekPrice * (1 + (nights - 7) / 7);
}

function buildDefaultProgressiveTiers(baseNightPrice, maxNights = 14) {
  const tiers = [];
  const base = Number(baseNightPrice || 0);
  if (!base || base <= 0) return tiers;
  for (let night = 2; night <= maxNights; night++) {
    const totalPrev = getTotalFromWeeklyModel(base, night - 1);
    const totalCurrent = getTotalFromWeeklyModel(base, night);
    const extraNightPrice = Math.max(0, totalCurrent - totalPrev);
    const extraNightDiscountPct = Math.max(0, 100 - (extraNightPrice / base) * 100);
    tiers.push({
      nightNumber: night,
      extraNightPrice: Number(extraNightPrice.toFixed(2)),
      extraNightDiscountPct: Number(extraNightDiscountPct.toFixed(2)),
    });
  }
  return tiers;
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

function getTierValue(tiers, nightNumber) {
  return tiers.find((t) => Number(t.nightNumber) === Number(nightNumber));
}

function isoToDayjs(value) {
  return value ? dayjs(value) : null;
}

function dayjsToIso(value) {
  return value && value.isValid() ? value.format('YYYY-MM-DD') : '';
}

export default function PropertyPricingSeasonsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [property, setProperty] = useState(null);
  const [schoolHolidays, setSchoolHolidays] = useState([]);
  const [displayStartYear, setDisplayStartYear] = useState(new Date().getFullYear());
  const [displayYears, setDisplayYears] = useState(1);

  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [editingSeasonId, setEditingSeasonId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [seasonSaveError, setSeasonSaveError] = useState('');

  const [seasonForm, setSeasonForm] = useState({
    label: '',
    dateRanges: [{ startDate: '', endDate: '' }],
    color: DEFAULT_COLORS[0],
    pricePerNight: 100,
    pricingMode: 'fixed',
    minNights: 1,
    progressiveTiers: [],
  });

  const loadData = useCallback(async () => {
    const [p, holidays] = await Promise.all([
      api.getProperty(id),
      api.getSchoolHolidays(),
    ]);
    setProperty({
      ...p,
      pricingRules: (p.pricingRules || [])
        .map((r) => ({
          ...r,
          pricingMode: r.pricingMode || 'fixed',
          color: r.color || DEFAULT_COLORS[0],
          dateRanges: parseDateRanges(r.dateRanges, r.startDate, r.endDate),
          progressiveTiers: parseTiers(r.progressiveTiers),
        }))
        .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))),
    });
    setSchoolHolidays(holidays || []);
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const seasons = property?.pricingRules || [];

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

  const publicHolidayByYear = useMemo(() => {
    const map = new Map();
    yearsToDisplay.forEach((year) => map.set(year, getFrenchPublicHolidays(year)));
    return map;
  }, [yearsToDisplay]);

  const getSeasonForDate = (dateStr) => {
    return seasons.find((s) => (s.dateRanges || []).some((range) => dateStr >= range.startDate && dateStr <= range.endDate)) || null;
  };

  const openCreateSeason = () => {
    const nextColor = DEFAULT_COLORS[seasons.length % DEFAULT_COLORS.length];
    setEditingSeasonId(null);
    setSeasonForm({
      label: `Saison ${seasons.length + 1}`,
      dateRanges: [{ startDate: '', endDate: '' }],
      color: nextColor,
      pricePerNight: 100,
      pricingMode: 'fixed',
      minNights: 1,
      progressiveTiers: [],
    });
    setSeasonSaveError('');
    setSeasonDialogOpen(true);
  };

  const openEditSeason = (season) => {
    setEditingSeasonId(season.id);
    setSeasonForm({
      label: season.label || '',
      dateRanges: parseDateRanges(season.dateRanges, season.startDate, season.endDate),
      color: season.color || DEFAULT_COLORS[0],
      pricePerNight: Number(season.pricePerNight || 0),
      pricingMode: season.pricingMode || 'fixed',
      minNights: Number(season.minNights || 1),
      progressiveTiers: parseTiers(season.progressiveTiers),
    });
    setSeasonSaveError('');
    setSeasonDialogOpen(true);
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
        progressiveTiers: buildDefaultProgressiveTiers(Number(prev.pricePerNight || 0)),
      };
    });
  };

  const handleBasePriceChange = (value) => {
    const numericValue = Number(value || 0);
    setSeasonForm((prev) => {
      const updated = { ...prev, pricePerNight: numericValue };
      if (prev.pricingMode === 'progressive') {
        const baselineTiers = (prev.progressiveTiers || []).length > 0
          ? prev.progressiveTiers
          : buildDefaultProgressiveTiers(numericValue);
        updated.progressiveTiers = baselineTiers.map((tier) => {
          const pct = Number(tier.extraNightDiscountPct || 0);
          const extra = Math.max(0, numericValue * (1 - pct / 100));
          return {
            ...tier,
            extraNightPrice: Number(extra.toFixed(2)),
          };
        });
      }
      return updated;
    });
  };

  const updateTierByPrice = (nightNumber, value) => {
    const base = Number(seasonForm.pricePerNight || 0);
    const extra = Math.max(0, Number(value || 0));
    const pct = base > 0 ? Math.max(0, 100 - (extra / base) * 100) : 0;
    setSeasonForm((prev) => ({
      ...prev,
      progressiveTiers: (prev.progressiveTiers || []).map((t) => (
        Number(t.nightNumber) === Number(nightNumber)
          ? { ...t, extraNightPrice: Number(extra.toFixed(2)), extraNightDiscountPct: Number(pct.toFixed(2)) }
          : t
      )),
    }));
  };

  const updateTierByPct = (nightNumber, value) => {
    const base = Number(seasonForm.pricePerNight || 0);
    const pct = Math.max(0, Number(value || 0));
    const extra = Math.max(0, base * (1 - pct / 100));
    setSeasonForm((prev) => ({
      ...prev,
      progressiveTiers: (prev.progressiveTiers || []).map((t) => (
        Number(t.nightNumber) === Number(nightNumber)
          ? { ...t, extraNightDiscountPct: Number(pct.toFixed(2)), extraNightPrice: Number(extra.toFixed(2)) }
          : t
      )),
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
      progressiveTiers: seasonForm.pricingMode === 'progressive' ? seasonForm.progressiveTiers : [],
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
    } catch (error) {
      setSeasonSaveError(error.message || "Impossible d'enregistrer la saison.");
    }
  };

  const handleDeleteSeason = async () => {
    if (!deleteTarget) return;
    await api.deletePricingRule(id, deleteTarget.id);
    setDeleteTarget(null);
    await loadData();
  };

  if (!property) {
    return <Typography>Chargement…</Typography>;
  }

  return (
    <Box>
      <PageHeader title={`Saisons tarifaires - ${property.name}`} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 2 }}>
            <Typography variant="h6">Saisons</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateSeason}>
              Nouvelle saison
            </Button>
          </Box>
          <TableContainer>
            <Table size="small" sx={{ minWidth: 980 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Saison</TableCell>
                  <TableCell>Dates</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Tarif base 1 nuit</TableCell>
                  <TableCell>Min nuits</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {seasons.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: s.color || '#1976d2' }} />
                        {s.label}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        {getSortedDateRanges(s.dateRanges).map((range, index) => (
                          <Typography key={`${s.id}-range-${index}`} variant="body2" sx={{ lineHeight: 1.25 }}>
                            {displayDate(range.startDate)} → {displayDate(range.endDate)}
                          </Typography>
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>{s.pricingMode === 'progressive' ? 'Dégressif' : 'Fixe'}</TableCell>
                    <TableCell>{Number(s.pricePerNight || 0).toFixed(2)} €</TableCell>
                    <TableCell>{s.minNights}</TableCell>
                    <TableCell>
                      <Button size="small" startIcon={<EditIcon fontSize="small" />} onClick={() => openEditSeason(s)}>Modifier</Button>
                      <Button size="small" color="error" startIcon={<DeleteIcon fontSize="small" />} onClick={() => setDeleteTarget(s)}>Supprimer</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {seasons.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">Aucune saison. Créez votre première saison.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: { xs: 'stretch', md: 'center' }, flexDirection: { xs: 'column', md: 'row' }, flexWrap: 'wrap' }}>
          <TextField
            label="Année de départ"
            type="number"
            value={displayStartYear}
            onChange={(e) => setDisplayStartYear(Number(e.target.value || minYear))}
            inputProps={{ min: minYear, max: maxYear + 2 }}
            size="small"
          />
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Nombre d'années affichées</InputLabel>
            <Select
              value={displayYears}
              label="Nombre d'années affichées"
              onChange={(e) => setDisplayYears(Number(e.target.value))}
            >
              <MenuItem value={1}>1 an</MenuItem>
              <MenuItem value={2}>2 ans</MenuItem>
              <MenuItem value={3}>3 ans</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            onClick={() => navigate(withFrom(`/properties/${id}`, `/properties/${id}/pricing-seasons`))}
          >
            Retour au logement
          </Button>
        </CardContent>
      </Card>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        {yearsToDisplay.map((year) => (
          <Grid item xs={12} key={year}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 2 }}>
                  <Typography variant="h6">{year}</Typography>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', color: 'text.secondary' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'error.main' }} />
                      <Typography variant="caption">Jour férié</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'info.main' }} />
                      <Typography variant="caption">Vacances scolaires</Typography>
                    </Box>
                  </Box>
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
                      const isPublicHoliday = publicHolidayByYear.get(year)?.has(dateStr);
                      const schoolInfo = getSchoolHolidayInfo(dateStr, schoolHolidays);
                      cells.push({ dateStr, day: d.getDate(), inMonth, season, isPublicHoliday, schoolInfo });
                    }

                    return (
                      <Grid item xs={12} sm={6} md={4} lg={3} key={`${year}-${month}`}>
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1 }}>
                          <Typography variant="caption" sx={{ fontWeight: 700, mb: 0.5, display: 'block' }}>{monthLabel(year, month)}</Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.3 }}>
                            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((wd, idx) => (
                              <Typography key={`${wd}-${idx}`} variant="caption" sx={{ textAlign: 'center', color: 'text.secondary', fontWeight: 700 }}>{wd}</Typography>
                            ))}
                            {cells.map((c, idx) => (
                              <Box
                                key={`${c.dateStr}-${idx}`}
                                onClick={() => {
                                  if (c.inMonth && c.season) {
                                    openEditSeason(c.season);
                                  }
                                }}
                                sx={{
                                  height: 20,
                                  borderRadius: 0.8,
                                  borderTop: c.inMonth && c.season ? `3px solid ${c.season.color || '#1976d2'}` : '3px solid transparent',
                                  bgcolor: c.inMonth ? (c.season ? `${c.season.color || '#1976d2'}22` : 'background.paper') : 'transparent',
                                  color: c.inMonth ? 'text.primary' : 'transparent',
                                  fontSize: 10,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  position: 'relative',
                                  cursor: c.inMonth && c.season ? 'pointer' : 'default',
                                  '&:hover': c.inMonth && c.season ? {
                                    outline: `1px solid ${c.season.color || '#1976d2'}`,
                                  } : undefined,
                                }}
                                title={c.season ? `${c.season.label} (${getSortedDateRanges(c.season.dateRanges).map((range) => `${displayDate(range.startDate)} → ${displayDate(range.endDate)}`).join(' | ')})` : ''}
                              >
                                {c.inMonth ? c.day : ''}
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
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog open={seasonDialogOpen} onClose={() => { setSeasonDialogOpen(false); setSeasonSaveError(''); }} maxWidth="md" fullWidth>
        <DialogTitle>{editingSeasonId ? 'Modifier la saison' : 'Nouvelle saison'}</DialogTitle>
        <DialogContent>
          <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="fr">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {seasonSaveError && <Alert severity="error">{seasonSaveError}</Alert>}
            {localDateValidationError && <Alert severity="error">{localDateValidationError}</Alert>}
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField label="Nom de la saison" value={seasonForm.label} onChange={(e) => handleSeasonFormField('label', e.target.value)} fullWidth />
              <TextField label="Couleur" type="color" value={seasonForm.color} onChange={(e) => handleSeasonFormField('color', e.target.value)} sx={{ width: 140 }} />
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2">Plages de dates</Typography>
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
                  <Button color="error" disabled={(seasonForm.dateRanges || []).length === 1} onClick={() => removeDateRange(index)}>
                    Supprimer
                  </Button>
                </Box>
              ))}
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
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
              <TextField label="Tarif base (1 nuit)" type="number" value={seasonForm.pricePerNight} onChange={(e) => handleBasePriceChange(e.target.value)} fullWidth inputProps={{ min: 0, step: 0.01 }} />
              <TextField label="Min nuits" type="number" value={seasonForm.minNights} onChange={(e) => handleSeasonFormField('minNights', Number(e.target.value || 1))} fullWidth inputProps={{ min: 1 }} />
            </Box>

            {seasonForm.pricingMode === 'progressive' && (
              <>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip label={`Tarif semaine équivalent: ${getWeekPriceEquivalent(seasonForm.pricePerNight).toFixed(2)} €`} color="primary" variant="outlined" />
                  <Button size="small" variant="outlined" onClick={() => handleSeasonFormField('progressiveTiers', buildDefaultProgressiveTiers(Number(seasonForm.pricePerNight || 0)))}>
                    Pré-remplir modèle dégressif standard
                  </Button>
                </Box>
                <TableContainer>
                  <Table size="small" sx={{ minWidth: 860 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Nuit #</TableCell>
                        <TableCell align="right">Prix nuit supplémentaire (€)</TableCell>
                        <TableCell align="right">Réduction nuit supplémentaire (%)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(seasonForm.progressiveTiers || []).map((t) => (
                        <TableRow key={t.nightNumber}>
                          <TableCell>{t.nightNumber}</TableCell>
                          <TableCell align="right">
                            <TextField
                              size="small"
                              type="number"
                              value={getTierValue(seasonForm.progressiveTiers, t.nightNumber)?.extraNightPrice ?? ''}
                              onChange={(e) => updateTierByPrice(t.nightNumber, e.target.value)}
                              inputProps={{ min: 0, step: 0.01 }}
                              sx={{ width: 180 }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <TextField
                              size="small"
                              type="number"
                              value={getTierValue(seasonForm.progressiveTiers, t.nightNumber)?.extraNightDiscountPct ?? ''}
                              onChange={(e) => updateTierByPct(t.nightNumber, e.target.value)}
                              inputProps={{ min: 0, step: 0.01 }}
                              sx={{ width: 180 }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                      {(seasonForm.progressiveTiers || []).length === 0 && (
                        <TableRow><TableCell colSpan={3} align="center">Aucun palier. Utilisez le bouton de pré-remplissage.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
            </Box>
          </LocalizationProvider>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setSeasonDialogOpen(false); setSeasonSaveError(''); }}>Annuler</Button>
          <Button
            variant="contained"
            onClick={handleSaveSeason}
            disabled={!(seasonForm.dateRanges || []).some((range) => range.startDate && range.endDate) || !seasonForm.label || Boolean(localDateValidationError)}
          >
            Enregistrer
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteSeason}
        title="Supprimer la saison"
        message={deleteTarget ? `Supprimer la saison ${deleteTarget.label} ?` : ''}
        confirmLabel="Supprimer"
      />
    </Box>
  );
}
