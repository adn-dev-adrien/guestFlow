/**
 * LinenStockPage — `/parametres/stock-blanchisserie`
 * (specs/linen-inventory-shortage-tracking.md §6.1).
 *
 * The « Blanchisserie » card on top (the laundry schedule, specs/linen-laundry-days.md §3.4), then the
 * stock: 6 number fields (bed simple/double/baby + towel large/medium/small).
 * 0 = "I don't track this type" — the simulation skips it and the UI hides any line for that
 * type elsewhere (Planning + Dashboard).
 *
 * Persists the stock to the `linen` plugin's settings via `PUT /api/plugins/linen/settings`
 * (specs/plugins-phase-2-hosts.md rule 15) and the schedule via `PUT /api/laundry/schedule`.
 * Uses the same dirty-form guard pattern as the rest of SettingsPage so navigation away with
 * unsaved changes prompts a confirmation.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Box, Card, CardContent, Stack, Typography, TextField, FormHelperText } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import BathtubIcon from '@mui/icons-material/Bathtub';
import {
  api, PageActionBar, ConfirmDialog, ErrorAlert, useToast, useDirtyFormGuard,
} from '../sdk';
import LaundryScheduleSection from './LaundryScheduleSection';
import {
  draftFromSchedule, effectiveCaption, isDraftValid, scheduleBody, sameDraft,
} from './laundryScheduleDraft';

const EMPTY = { bedSingle: 0, bedDouble: 0, bedBaby: 0, towelLarge: 0, towelMedium: 0, towelSmall: 0, towelBathMat: 0 };
// Form field → plugin setting key.
const SETTING_KEYS = {
  bedSingle: 'bedLinenStockSingle',
  bedDouble: 'bedLinenStockDouble',
  bedBaby: 'bedLinenStockBaby',
  towelLarge: 'towelStockLarge',
  towelMedium: 'towelStockMedium',
  towelSmall: 'towelStockSmall',
  towelBathMat: 'towelStockBathMat',
};

function clampInt(value) {
  const n = Math.floor(Number(value) || 0);
  if (n < 0) return 0;
  if (n > 999) return 999;
  return n;
}

export default function LinenStockPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedForm, setSavedForm] = useState(EMPTY);
  const [draft, setDraft] = useState(EMPTY);
  // The laundry schedule lives on this page; the view is `GET /api/laundry/schedule`. Tracked alongside
  // the stock so the save bar and the dirty guard cover both.
  const [scheduleView, setScheduleView] = useState(null);
  const [savedSchedule, setSavedSchedule] = useState(null);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [scheduleError, setScheduleError] = useState(null);
  // Load failures stay persistent (ErrorAlert); action feedback goes through the shared toasts
  // (specs/ds-components.md §3.2).
  const [loadError, setLoadError] = useState(false);
  const { showSuccess, showError } = useToast();

  const { isDirty, guardDialogOpen, dismissGuard, confirmLeave } = useDirtyFormGuard({
    draft: { ...draft, schedule: scheduleDraft },
    saved: { ...savedForm, schedule: savedSchedule },
    navigate,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [settings, schedule] = await Promise.all([api.getPluginSettings('linen'), api.getLaundrySchedule()]);
        const data = settings || {};
        if (!mounted) return;
        const shaped = Object.fromEntries(Object.entries(SETTING_KEYS).map(([field, key]) => [field, clampInt(data[key])]));
        setSavedForm(shaped);
        setDraft(shaped);
        const shapedSchedule = draftFromSchedule(schedule.pending || schedule.current);
        setScheduleView(schedule);
        setSavedSchedule(shapedSchedule);
        setScheduleDraft(shapedSchedule);
      } catch (err) {
        if (mounted) setLoadError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const update = (key) => (e) => setDraft((d) => ({ ...d, [key]: clampInt(e.target.value) }));

  const changeSchedule = (next) => { setScheduleDraft(next); setScheduleError(null); };

  const stockChanged = Object.keys(SETTING_KEYS).some((field) => draft[field] !== savedForm[field]);
  const scheduleChanged = Boolean(scheduleDraft) && !sameDraft(scheduleDraft, savedSchedule);
  const scheduleValid = !scheduleDraft || isDraftValid(scheduleDraft);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (stockChanged) {
        await api.savePluginSettings('linen', Object.fromEntries(Object.entries(SETTING_KEYS).map(([field, key]) => [key, draft[field]])));
        setSavedForm(draft);
      }
      if (scheduleChanged) {
        const view = await api.saveLaundrySchedule(scheduleBody(scheduleDraft));
        const shaped = draftFromSchedule(view.pending || view.current);
        setScheduleView(view);
        setSavedSchedule(shaped);
        setScheduleDraft(shaped);
      }
      showSuccess('Enregistré.');
    } catch (err) {
      if (err.field) setScheduleError({ field: err.field, message: err.message });
      else showError(err.message || 'Échec de l\'enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(savedForm);
    setScheduleDraft(savedSchedule);
    setScheduleError(null);
  };

  return (
    <Box>
      <PageActionBar
        title="Linge"
        onSave={handleSave}
        saveDisabled={loading || saving || !isDirty || !scheduleValid}
        saveBusy={saving}
        onCancel={handleCancel}
        cancelDisabled={loading || saving || !isDirty}
      />
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: '100%', md: 900, lg: 1240 }, mx: 'auto' }}>
        {loadError && (
          <ErrorAlert
            message="Impossible de charger le stock."
            onRetry={() => window.location.reload()}
            sx={{ mb: 2 }}
          />
        )}

        {scheduleDraft && (
          <LaundryScheduleSection
            value={scheduleDraft}
            onChange={changeSchedule}
            initialCycle={scheduleView.pending || scheduleView.current}
            caption={effectiveCaption(scheduleView, scheduleDraft)}
            error={scheduleError}
            disabled={loading || saving}
          />
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Nombre de jeux complets de chaque type. Le total est partagé entre tous les logements ; il
          sert à projeter le stock jour par jour et à alerter en cas de rupture prévue.
        </Typography>

        {/* Two small cards side-by-side on lg+ (masonry), stacked on smaller screens. */}
        <Box sx={{ columnGap: { lg: 3 }, columnCount: { xs: 1, lg: 2 } }}>
          <Box sx={{ breakInside: 'avoid' }}>
            <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <HotelIcon color="action" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Parures de lit
                </Typography>
              </Box>
              <FormHelperText>0 : type non suivi.</FormHelperText>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Doubles"
                  type="number"
                  size="small"
                  value={draft.bedDouble}
                  onChange={update('bedDouble')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Simples"
                  type="number"
                  size="small"
                  value={draft.bedSingle}
                  onChange={update('bedSingle')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Bébé"
                  type="number"
                  size="small"
                  value={draft.bedBaby}
                  onChange={update('bedBaby')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
              </Stack>
            </Stack>
          </CardContent>
            </Card>
          </Box>

          <Box sx={{ breakInside: 'avoid' }}>
            <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BathtubIcon color="action" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Serviettes
                </Typography>
              </Box>
              <FormHelperText>0 : type non suivi.</FormHelperText>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Grandes"
                  type="number"
                  size="small"
                  value={draft.towelLarge}
                  onChange={update('towelLarge')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Moyennes"
                  type="number"
                  size="small"
                  value={draft.towelMedium}
                  onChange={update('towelMedium')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Petites"
                  type="number"
                  size="small"
                  value={draft.towelSmall}
                  onChange={update('towelSmall')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Tapis de bain"
                  type="number"
                  size="small"
                  value={draft.towelBathMat}
                  onChange={update('towelBathMat')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
              </Stack>
            </Stack>
          </CardContent>
            </Card>
          </Box>
        </Box>
      </Box>
      <ConfirmDialog
        open={guardDialogOpen}
        onClose={dismissGuard}
        onConfirm={confirmLeave}
        title="Modifications non enregistrées"
        message="Des modifications ne sont pas enregistrées. Quitter sans enregistrer ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="error"
      />
    </Box>
  );
}
