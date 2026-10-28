/**
 * OptionEditorPanel — the option editor, in a SidePanel (specs/options-resources-ux.md rules 12-17).
 *
 * Sections, in order: Général, Logements et prix, Planning (manual options), Visibilité, then the
 * type-specific blocks of the options that carry them (Petit-déjeuner, Linge, Tapis de bain,
 * Assurance). Every setting the former dialog had is still here. Validation is mirrored inline; the
 * server's 422 `details[]` land on their field. Saving closes the panel through `onSaved`.
 *
 * Props:
 *   open            boolean
 *   optionId        number|null     the option to edit; null = a new one
 *   initialCategory string          pre-fills a new option (the active category chip)
 *   properties      Array<{ id, name }>
 *   categories      string[]        labels offered as suggestions
 *   onClose         () => void
 *   onSaved         ({ id, isNew }) => void
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, Switch, TextField, Typography,
} from '@mui/material';
import api from '../../api';
import SidePanel, { SidePanelSection } from '../../components/SidePanel';
import LoadingState from '../../components/LoadingState';
import ErrorAlert from '../../components/ErrorAlert';
import OptionPropertyDefaultsMirror from '../../components/OptionPropertyDefaultsMirror';
import { useToast } from '../../components/DialogProvider';
import { usePlugin } from '../../hooks/usePlugins';
import { LINEN, WEBSITE_BOOKING } from '../../constants/plugins';
import { OPTION_PRICE_TYPES, UNIT_BY_PRICE_TYPE } from '../../constants/optionsResourcesTexts';
import CategoryField from './CategoryField';
import OptionPropertyTable from './OptionPropertyTable';
import {
  BathMatPerPropertyField, BathroomTowelCountsFields, BedLinenIncludesFields, BreakfastTimeField, PlanningCardSection,
} from './OptionSpecialSections';
import {
  emptyOptionForm, formFromOption, hasPropertyPrice, isBlank, optionPayload, sectionOfField, validateOptionForm,
} from './optionForm';

export default function OptionEditorPanel({
  open, optionId, initialCategory = '', properties, categories, onClose, onSaved,
}) {
  const linenOn = usePlugin(LINEN);
  const websiteOn = usePlugin(WEBSITE_BOOKING);
  const { showError } = useToast();
  const [form, setFormState] = useState(null);
  const [saved, setSaved] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setServerErrors({});
    setLoadError(false);
    if (optionId == null) {
      const fresh = emptyOptionForm({ propertyIds: propertiesRef.current.map((p) => Number(p.id)), category: initialCategory });
      setFormState(fresh);
      setSaved(JSON.stringify(fresh));
      return undefined;
    }
    setFormState(null);
    api.getOption(optionId)
      .then((item) => {
        if (cancelled) return;
        const loaded = formFromOption(item);
        setFormState(loaded);
        setSaved(JSON.stringify(loaded));
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [open, optionId, initialCategory, attempt]);

  const setForm = (next) => { setServerErrors({}); setFormState(next); };
  const clientErrors = useMemo(() => (form ? validateOptionForm(form) : {}), [form]);
  const errors = { ...clientErrors, ...serverErrors };
  const errorFields = Object.keys(errors);
  const dirty = Boolean(form) && JSON.stringify(form) !== saved;

  const handleSave = async () => {
    if (!form || errorFields.length > 0) return;
    setSaving(true);
    try {
      const payload = optionPayload(form);
      if (optionId == null) {
        const created = await api.createOption(payload);
        onSaved({ id: created.id, isNew: true });
      } else {
        await api.updateOption(optionId, payload);
        onSaved({ id: optionId, isNew: false });
      }
    } catch (err) {
      if (err.status === 422 && Array.isArray(err.details)) {
        setServerErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else {
        showError(err.message || 'Enregistrement impossible.');
      }
    } finally {
      setSaving(false);
    }
  };

  const hasError = (section) => errorFields.some((field) => sectionOfField(field) === section);
  const percent = form && form.priceType === 'percent_of_stay';
  const priced = form && hasPropertyPrice(form.priceType) && form.priceType !== 'free';
  const proposedIds = form ? form.propertyIds : [];
  const everyOverrides = Boolean(form) && priced && proposedIds.length > 0
    && proposedIds.every((pid) => !isBlank((form.propertyPrices || {})[pid]));

  const sections = form ? [
    { id: 'general', label: 'Général', hasError: hasError('general') },
    { id: 'prices', label: 'Logements et prix', hasError: hasError('prices') },
    ...(!form.autoOptionType ? [{ id: 'planning', label: 'Planning' }] : []),
    { id: 'visibility', label: 'Visibilité' },
    ...(form.autoOptionType === 'breakfast' ? [{ id: 'breakfast', label: 'Petit-déjeuner' }] : []),
    ...(linenOn && (form.countsAsBedLinen || form.countsAsBathroomLinen) ? [{ id: 'linen', label: 'Linge' }] : []),
    ...(linenOn && form.countsAsBathMat ? [{ id: 'bathmat', label: 'Tapis de bain' }] : []),
    ...(form.isCancellationInsurance ? [{ id: 'insurance', label: 'Assurance' }] : []),
  ] : [];

  const visibilityHelp = () => {
    if (form.displayToClient) return '';
    const hidden = `absente de la fiche, des mails, du devis${websiteOn ? ' et du site' : ''}`;
    if (linenOn && (form.countsAsBedLinen || form.countsAsBathroomLinen || form.countsAsBathMat)) {
      return `Interne : ${hidden}, toujours comptée dans le linge.`;
    }
    if (form.showsPlanningCard || form.autoOptionType === 'breakfast') return `Interne : ${hidden}, toujours sur le planning.`;
    return `Interne : ${hidden}.`;
  };

  let title = 'Nouvelle option';
  if (optionId != null) title = (form && form.title) || 'Option';
  else if (form && form.title) title = form.title;

  let body;
  if (loadError) {
    body = <Box sx={{ pt: 2 }}><ErrorAlert onRetry={() => setAttempt((n) => n + 1)} /></Box>;
  } else if (!form) {
    body = <LoadingState variant="skeleton" rows={5} />;
  } else {
    body = (
      <>
        <SidePanelSection id="general" title="Général">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Nom"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              error={Boolean(errors.title)}
              helperText={errors.title || undefined}
              required
              fullWidth
              autoFocus={optionId == null}
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              fullWidth
              multiline
              minRows={2}
            />
            <CategoryField form={form} setForm={setForm} suggestions={categories} />
          </Box>
        </SidePanelSection>

        <SidePanelSection id="prices" title="Logements et prix">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="option-price-type">Type de prix</InputLabel>
              <Select
                labelId="option-price-type"
                label="Type de prix"
                value={form.priceType || 'per_stay'}
                onChange={(e) => setForm({ ...form, priceType: e.target.value })}
              >
                {OPTION_PRICE_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>
            {priced && (
              <Box>
                <TextField
                  label={percent ? 'Pourcentage de base' : 'Prix de base'}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  error={Boolean(errors.price)}
                  helperText={errors.price || undefined}
                  sx={{ maxWidth: 240 }}
                  slotProps={{
                    htmlInput: { inputMode: 'decimal', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
                    input: { endAdornment: <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 1 }}>{percent ? '% du séjour' : `€ ${UNIT_BY_PRICE_TYPE[form.priceType] || ''}`}</Typography> },
                  }}
                />
                <FormHelperText>
                  {everyOverrides
                    ? 'Chaque logement a son propre prix : le prix de base ne s’applique nulle part.'
                    : 'Repris par les logements dont la case prix est vide.'}
                </FormHelperText>
                {percent && (
                  <FormHelperText>
                    Pourcentage du montant hébergement du séjour (nuits et supplément voyageurs, hors options, ressources et taxe de séjour).
                  </FormHelperText>
                )}
              </Box>
            )}
          </Box>
          <OptionPropertyTable form={form} setForm={setForm} properties={properties} errors={errors} />
          {Number(form.autoEnabled) !== 1 && (
            <FormHelperText sx={{ mt: 1 }}>
              « Inclus » : ajoutée d’office aux nouvelles réservations. « Offert » : incluse à 0 €.
            </FormHelperText>
          )}
        </SidePanelSection>

        {!form.autoOptionType && (
          <SidePanelSection id="planning" title="Planning">
            <PlanningCardSection form={form} setForm={setForm} />
          </SidePanelSection>
        )}

        <SidePanelSection id="visibility" title="Visibilité">
          <FormControlLabel
            control={<Switch checked={Boolean(form.displayToClient)} onChange={(e) => setForm({ ...form, displayToClient: e.target.checked })} />}
            label="Visible du client"
          />
          {visibilityHelp() && <FormHelperText sx={{ mt: 0 }}>{visibilityHelp()}</FormHelperText>}
        </SidePanelSection>

        {form.autoOptionType === 'breakfast' && (
          <SidePanelSection id="breakfast" title="Petit-déjeuner">
            <BreakfastTimeField form={form} setForm={setForm} />
          </SidePanelSection>
        )}

        {linenOn && (form.countsAsBedLinen || form.countsAsBathroomLinen) && (
          <SidePanelSection id="linen" title="Linge">
            {form.countsAsBedLinen && <BedLinenIncludesFields form={form} setForm={setForm} />}
            {form.countsAsBathroomLinen && <BathroomTowelCountsFields form={form} setForm={setForm} />}
            <OptionPropertyDefaultsMirror optionId={optionId} form={form} />
          </SidePanelSection>
        )}

        {linenOn && form.countsAsBathMat && (
          <SidePanelSection id="bathmat" title="Tapis de bain">
            <BathMatPerPropertyField form={form} setForm={setForm} properties={properties} />
          </SidePanelSection>
        )}

        {form.isCancellationInsurance && (
          <SidePanelSection id="insurance" title="Assurance">
            <FormHelperText sx={{ m: 0 }}>Assurance annulation : proposée seulement avec un tarif supérieur à 0.</FormHelperText>
          </SidePanelSection>
        )}
      </>
    );
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={title}
      dirty={dirty}
      saving={saving}
      errorCount={errorFields.length}
      sections={sections}
      onSave={handleSave}
    >
      {body}
    </SidePanel>
  );
}
