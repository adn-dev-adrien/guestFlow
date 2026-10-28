/**
 * ResourceEditorPanel — the resource editor, in a SidePanel (specs/options-resources-ux.md rule 20).
 *
 * Sections: Général (name, description, stock — « En service » for a resource sold by the hour — and its
 * properties, legacy « none selected = all »), Prix (type, base price, one line per property with its
 * price and, for an hourly resource, « 1re heure offerte »), Horaires (the `resources.fields` plugin
 * slot, only when a plugin has something for this resource), Mails (the sentence once booked).
 *
 * Props: open, resourceId (null = new), properties, onClose, onSaved({ id, isNew })
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Checkbox, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, TextField, Typography,
} from '@mui/material';
import api from '../../api';
import SidePanel, { SidePanelSection } from '../../components/SidePanel';
import LoadingState from '../../components/LoadingState';
import ErrorAlert from '../../components/ErrorAlert';
import PropertiesMultiSelect from '../../components/PropertiesMultiSelect';
import TokenTextField from '../../components/TokenTextField';
import { useToast } from '../../components/DialogProvider';
import { usePlugin } from '../../hooks/usePlugins';
import { HOURLY_RESOURCES } from '../../constants/plugins';
import { RESOURCE_PRICE_TYPES, UNIT_BY_PRICE_TYPE } from '../../constants/optionsResourcesTexts';
import { useSlot } from '../../plugins/sdk';
import { emptyResource, formFromResource, toResourcePayload, validateResourceForm } from './resourceForm';
import { isBlank } from './optionForm';

const HOURLY_FIELDS = ['closeTime', 'hourlyEveningRate', 'hourlyExternalDayRate', 'hourlyExternalEveningRate'];
const SECTION_OF = { name: 'general', quantity: 'general', price: 'prices' };
const sectionOf = (field) => SECTION_OF[field] || (HOURLY_FIELDS.includes(field) ? 'hours' : 'prices');

function PropertyPriceLines({ form, setForm, properties, errors }) {
  const hourly = form.priceType === 'per_hour';
  const scope = form.propertyIds.length > 0 ? properties.filter((p) => form.propertyIds.includes(Number(p.id))) : properties;
  const lineOf = (pid) => (form.propertyPricing || {})[String(pid)] || { price: '', freeMinutes: 0 };
  const update = (pid, patch) => {
    const next = { ...(form.propertyPricing || {}), [String(pid)]: { ...lineOf(pid), ...patch } };
    const line = next[String(pid)];
    if (isBlank(line.price) && !Number(line.freeMinutes)) delete next[String(pid)];
    setForm({ ...form, propertyPricing: next });
  };
  if (scope.length === 0) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" fontWeight={600}>Prix par logement</Typography>
      <FormHelperText sx={{ mt: 0, mb: 1 }}>Vide : prix de base.</FormHelperText>
      {scope.map((p) => {
        const line = lineOf(p.id);
        const error = errors[`propertyPricing.${p.id}`];
        return (
          <Box
            key={p.id}
            role="group"
            aria-label={p.name}
            sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <Typography variant="body2" fontWeight={600} sx={{ flex: '1 1 120px', minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}</Typography>
            <TextField
              size="small"
              value={line.price}
              placeholder={isBlank(form.price) ? '' : String(form.price)}
              onChange={(e) => update(p.id, { price: e.target.value })}
              error={Boolean(error)}
              helperText={error || undefined}
              sx={{ width: 130, '& input': { fontSize: 16, textAlign: 'right' } }}
              slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': `Prix · ${p.name}` } }}
            />
            {hourly && (
              <FormControlLabel
                sx={{ m: 0, minHeight: 44 }}
                control={(
                  <Checkbox
                    size="small"
                    checked={Number(line.freeMinutes) >= 60}
                    onChange={(e) => update(p.id, { freeMinutes: e.target.checked ? 60 : 0 })}
                  />
                )}
                label={<Typography variant="body2">1re heure offerte</Typography>}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export default function ResourceEditorPanel({ open, resourceId, properties, onClose, onSaved }) {
  const hourlyOn = usePlugin(HOURLY_RESOURCES);
  const { showError } = useToast();
  const pluginFields = useSlot('resources.fields');
  const [form, setFormState] = useState(null);
  const [saved, setSaved] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setServerErrors({});
    setLoadError(false);
    if (resourceId == null) {
      setFormState(emptyResource);
      setSaved(JSON.stringify(emptyResource));
      return undefined;
    }
    setFormState(null);
    api.getResource(resourceId)
      .then((item) => {
        if (cancelled) return;
        const loaded = formFromResource(item);
        setFormState(loaded);
        setSaved(JSON.stringify(loaded));
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [open, resourceId, attempt]);

  const setForm = (next) => {
    setServerErrors({});
    setFormState(typeof next === 'function' ? next(form) : next);
  };
  const clientErrors = useMemo(() => (form ? validateResourceForm(form) : {}), [form]);
  const errors = { ...clientErrors, ...serverErrors };
  const errorFields = Object.keys(errors);
  const dirty = Boolean(form) && JSON.stringify(form) !== saved;

  const handleSave = async () => {
    if (!form || errorFields.length > 0) return;
    setSaving(true);
    try {
      const payload = toResourcePayload(form);
      if (resourceId == null) {
        const created = await api.createResource(payload);
        onSaved({ id: created.id, isNew: true });
      } else {
        await api.updateResource(resourceId, payload);
        onSaved({ id: resourceId, isNew: false });
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

  const hourly = Boolean(form) && form.priceType === 'per_hour';
  const contributions = form ? pluginFields.filter((c) => c.appliesTo(form)) : [];
  const priceTypes = hourlyOn ? RESOURCE_PRICE_TYPES : RESOURCE_PRICE_TYPES.filter((t) => t.value !== 'per_hour');
  const hasError = (section) => errorFields.some((field) => sectionOf(field) === section);
  const hourErrors = HOURLY_FIELDS.filter((field) => errors[field]);

  const sections = form ? [
    { id: 'general', label: 'Général', hasError: hasError('general') },
    { id: 'prices', label: 'Prix', hasError: hasError('prices') },
    ...(contributions.length > 0 ? [{ id: 'hours', label: 'Horaires', hasError: hasError('hours') }] : []),
    { id: 'mails', label: 'Mails' },
  ] : [];

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
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={Boolean(errors.name)}
              helperText={errors.name || undefined}
              required
              fullWidth
              autoFocus={resourceId == null}
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              fullWidth
              multiline
              minRows={2}
            />
            <TextField
              label={hourly ? 'En service' : 'En stock'}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              error={Boolean(errors.quantity)}
              helperText={errors.quantity || undefined}
              sx={{ maxWidth: 160 }}
              slotProps={{ htmlInput: { inputMode: 'numeric', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } } }}
            />
            <PropertiesMultiSelect
              properties={properties}
              value={form.propertyIds}
              onChange={(ids) => setForm({ ...form, propertyIds: ids })}
            />
          </Box>
        </SidePanelSection>

        <SidePanelSection id="prices" title="Prix">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="resource-price-type">Type de prix</InputLabel>
              <Select
                labelId="resource-price-type"
                label="Type de prix"
                value={form.priceType || 'per_stay'}
                onChange={(e) => setForm({ ...form, priceType: e.target.value })}
              >
                {priceTypes.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>
            {form.priceType !== 'free' && (
              <TextField
                label="Prix de base"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                error={Boolean(errors.price)}
                helperText={errors.price || undefined}
                sx={{ maxWidth: 240 }}
                slotProps={{
                  htmlInput: { inputMode: 'decimal', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
                  input: { endAdornment: <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 1 }}>€ {UNIT_BY_PRICE_TYPE[form.priceType]}</Typography> },
                }}
              />
            )}
          </Box>
          {form.priceType !== 'free' && <PropertyPriceLines form={form} setForm={setForm} properties={properties} errors={errors} />}
        </SidePanelSection>

        {contributions.length > 0 && (
          <SidePanelSection id="hours" title="Horaires">
            {contributions.map(({ key, pluginId, Component }) => (
              <React.Suspense key={`${pluginId}:${key}`} fallback={null}>
                <Component draft={form} onChange={(patch) => setForm({ ...form, ...patch })} />
              </React.Suspense>
            ))}
            {hourErrors.map((field) => (
              <FormHelperText key={field} error>{errors[field]}</FormHelperText>
            ))}
          </SidePanelSection>
        )}

        <SidePanelSection id="mails" title="Mails">
          <TokenTextField
            label="Phrase une fois réservée"
            fr={form.emailBookedText || ''}
            en={form.emailBookedTextEn || ''}
            onChange={(lang, value) => setForm({ ...form, [lang === 'fr' ? 'emailBookedText' : 'emailBookedTextEn']: value })}
            tokens={[{ name: 'slots', label: 'Créneaux' }]}
          />
        </SidePanelSection>
      </>
    );
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={(form && form.name) || (resourceId == null ? 'Nouvelle ressource' : 'Ressource')}
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
