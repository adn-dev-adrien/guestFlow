/**
 * ResourceEditorPanel — the resource editor, in a SidePanel (specs/options/options-resources-ux.md rule 20).
 *
 * Sections: Général (name, description, stock — « En service » for a resource sold by the hour — and its
 * properties, legacy « none selected = all »), Prix (type, base price, one line per property with its
 * price and, for an hourly resource, « 1re heure offerte »), Horaires (the `resources.fields` plugin
 * slot, only when a plugin has something for this resource), Mails (the sentence once booked), then the sections
 * a live plugin adds with its own rows (a `resources.fields` contribution carrying `section`, usePluginFields); one
 * « Enregistrer » saves the resource, then each of them.
 *
 * Props: open, resourceId (null = new), properties, onClose, onSaved({ id, isNew })
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Checkbox, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, TextField, Typography,
} from '@mui/material';
import api from '../../api';
import SidePanel, { SidePanelSection } from '../../components/SidePanel';
import LoadingState from '../../components/LoadingState';
import ErrorAlert from '../../components/ErrorAlert';
import PropertiesMultiSelect from '../../components/PropertiesMultiSelect';
import ExternalSaleFields from '../../components/ExternalSaleFields';
import useExternalVatRates from '../../hooks/useExternalVatRates';
import useOutsideSellability from '../../hooks/useOutsideSellability';
import TokenTextField from '../../components/TokenTextField';
import { useToast } from '../../components/DialogProvider';
import { usePlugin } from '../../hooks/usePlugins';
import { HOURLY_RESOURCES } from '../../constants/plugins';
import { RESOURCE_PRICE_TYPES, TEXTS, UNIT_BY_PRICE_TYPE } from '../../constants/optionsResourcesTexts';
import { Contribution } from '../../plugins/sdk/Slot';
import { useSlot } from '../../plugins/sdk';
import usePluginFields from './usePluginFields';
import {
  emptyResourceFor, formFromResource, toResourcePayload, validateResourceForm, withScope,
} from './resourceForm';
import { isBlank } from './optionForm';
import { EXTERNAL_FIELDS } from './externalSaleForm';

const HOURLY_FIELDS = ['closeTime', 'bookingHorizonMonths'];
const SECTION_OF = { name: 'general', quantity: 'general', price: 'prices' };
// The fields a plugin's price grids own are pinned to « Prix » (`ownedFields`); the rest by the core's own map.
const sectionOf = (field, ownedFields = []) => SECTION_OF[field] || (ownedFields.includes(field) ? 'prices' : (EXTERNAL_FIELDS.includes(field) || field === 'sessionMaxPeople' ? 'external' : (HOURLY_FIELDS.includes(field) ? 'hours' : 'prices')));

function PropertyPriceLines({ form, setForm, properties, errors }) {
  const hourly = form.priceType === 'per_hour' && Boolean(form.showsPlanningCard);
  const scope = form.propertyIds.length > 0 ? properties.filter((p) => form.propertyIds.includes(Number(p.id))) : properties;
  const lineOf = (pid) => (form.propertyPricing || {})[String(pid)] || { price: '', freeMinutes: 0 };
  const update = (pid, patch) => {
    const next = { ...(form.propertyPricing || {}), [String(pid)]: { ...lineOf(pid), ...patch } };
    const line = next[String(pid)];
    if ((hourly || isBlank(line.price)) && !Number(line.freeMinutes)) delete next[String(pid)];
    setForm({ ...form, propertyPricing: next });
  };
  if (scope.length === 0) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" fontWeight={600}>{hourly ? 'Heure offerte par logement' : 'Prix par logement'}</Typography>
      {!hourly && <FormHelperText sx={{ mt: 0, mb: 1 }}>Vide : prix de base.</FormHelperText>}
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
            {!hourly && (
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
            )}
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
  const priceContributions = useSlot('resources.priceFields');
  const priceForms = useMemo(() => priceContributions.filter((c) => c.form).map((c) => c.form), [priceContributions]);
  const ownedFields = useMemo(() => priceForms.flatMap((f) => f.fields || []), [priceForms]);
  // Read when the resource loads: the contributions do not change while the panel is open, and the load must not restart for them.
  const priceFormsRef = useRef(priceForms);
  priceFormsRef.current = priceForms;
  const { showError } = useToast();
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
      const blank = emptyResourceFor(priceFormsRef.current);
      setFormState(blank);
      setSaved(JSON.stringify(blank));
      return undefined;
    }
    setFormState(null);
    api.getResource(resourceId)
      .then((item) => {
        if (cancelled) return;
        const loaded = formFromResource(item, priceFormsRef.current);
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
  const clientErrors = useMemo(() => (form ? validateResourceForm(form, priceForms) : {}), [form, priceForms]);
  const vatClasses = useExternalVatRates(open);
  const sellability = useOutsideSellability(open && Boolean(form), 'resource', { ...(form || {}), id: resourceId });
  const plugins = usePluginFields('resources.fields', form);
  const coreDirty = Boolean(form) && JSON.stringify(form) !== saved;
  const dirty = coreDirty || plugins.dirty;
  const errors = coreDirty ? { ...clientErrors, ...serverErrors } : serverErrors;
  const errorFields = Object.keys(errors);

  const handleSave = async () => {
    if (!form || errorFields.length > 0) return false;
    setSaving(true);
    try {
      const payload = toResourcePayload(form, priceForms);
      if (resourceId == null) {
        const created = await api.createResource(payload);
        onSaved({ id: created.id, isNew: true });
        return true;
      }
      if (coreDirty) {
        await api.updateResource(resourceId, payload);
        setSaved(JSON.stringify(form));
      }
      await plugins.saveAll(resourceId);
      onSaved({ id: resourceId, isNew: false });
      return true;
    } catch (err) {
      if (err.status === 422 && Array.isArray(err.details)) {
        setServerErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else {
        showError(err.message || TEXTS.saveFailed);
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const hourly = Boolean(form) && form.priceType === 'per_hour';
  const contributions = plugins.inline;
  const priceTypes = hourlyOn ? RESOURCE_PRICE_TYPES : RESOURCE_PRICE_TYPES.filter((t) => t.value !== 'per_hour');
  const hasError = (section) => errorFields.some((field) => sectionOf(field, ownedFields) === section);
  const hourErrors = HOURLY_FIELDS.filter((field) => errors[field]);
  const priceGrids = form ? priceContributions.filter((c) => !c.appliesTo || c.appliesTo(form)) : [];

  const sections = form ? [
    { id: 'general', label: 'Général', hasError: hasError('general') },
    { id: 'prices', label: 'Prix', hasError: hasError('prices') },
    { id: 'external', label: 'Vente hors séjour', hasError: hasError('external') },
    ...(contributions.length > 0 ? [{ id: 'hours', label: 'Horaires', hasError: hasError('hours') }] : []),
    { id: 'mails', label: 'Mails' },
    ...plugins.sections.map((c) => ({ id: `plugin-${c.pluginId}-${c.key}`, label: c.section.title })),
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
              onChange={(ids) => setForm(withScope(form, ids))}
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
                // A resource that becomes hourly starts with its guests' price empty (required), not the « 0 » of a fresh form: every hourly price is typed.
                onChange={(e) => setForm({ ...form, priceType: e.target.value, ...(e.target.value === 'per_hour' && form.price === '0' ? { price: '' } : {}) })}
              >
                {priceTypes.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>
            {priceGrids.map(({ key, pluginId, Component }) => (
              <Contribution key={`${pluginId}:${key}`} pluginId={pluginId}>
                <Component
                  draft={form}
                  onChange={(patch) => setForm({ ...form, ...patch })}
                  errors={errors}
                  lodgingLines={form.priceType !== 'free' ? <PropertyPriceLines form={form} setForm={setForm} properties={properties} errors={errors} /> : null}
                />
              </Contribution>
            ))}
            {form.priceType !== 'free' && priceGrids.length === 0 && (
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
          {form.priceType !== 'free' && priceGrids.length === 0 && <PropertyPriceLines form={form} setForm={setForm} properties={properties} errors={errors} />}
        </SidePanelSection>

        <SidePanelSection id="external" title="Vente hors séjour">
          <ExternalSaleFields
            value={form}
            onChange={(patch) => setForm({ ...form, ...patch })}
            classes={vatClasses}
            defaultClass="resources"
            errors={errors}
            sellability={sellability}
          />
          {hourlyOn && form.priceType === 'per_hour' && form.showsPlanningCard && form.sellableExternally && (
            <TextField
              label={TEXTS.sessionMaxPeople}
              value={form.sessionMaxPeople ?? ''}
              onChange={(e) => setForm({ ...form, sessionMaxPeople: e.target.value })}
              error={Boolean(errors.sessionMaxPeople)}
              helperText={errors.sessionMaxPeople || TEXTS.sessionMaxPeopleHelp}
              size="small"
              fullWidth
              sx={{ mt: 2 }}
              slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 100, style: { fontSize: 16 } } }}
            />
          )}
        </SidePanelSection>

        {contributions.length > 0 && (
          <SidePanelSection id="hours" title="Horaires">
            {contributions.map(({ key, pluginId, Component }) => (
              <Contribution key={`${pluginId}:${key}`} pluginId={pluginId}>
                <Component draft={form} onChange={(patch) => setForm({ ...form, ...patch })} errors={errors} />
              </Contribution>
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

        {plugins.sections.map((c) => (
          <SidePanelSection key={`${c.pluginId}:${c.key}`} id={`plugin-${c.pluginId}-${c.key}`} title={c.section.title}>
            <Contribution pluginId={c.pluginId}>
              <c.Component kind="resource" itemId={resourceId} draft={form} {...plugins.bind(c)} />
            </Contribution>
          </SidePanelSection>
        ))}
      </>
    );
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={(form && form.name) || (resourceId == null ? TEXTS.newResourceTitle : TEXTS.resourceFallbackTitle)}
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
