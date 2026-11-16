/**
 * GiftVoucherSettings — Paramètres › Bons cadeaux (specs/gift-vouchers.md rules 6, 7, 14, 22, 23): validity, amount
 * bounds, the ideas of the site's purchase screen (each a stay to price: label + lodging + nights + guests, never a bare
 * amount), the two addresses and the e-mail text in French and English. Saved by the page bar through the plugin's
 * settings route; the server judges every key and its message is shown on the field.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, CardContent, IconButton, InputAdornment, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import {
  ErrorAlert, HelpedTextField, LoadingState, PageActionBar, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import { centsToEuros, eurosToCents, vatRateHint } from './giftVoucherFormat';
import { SETTINGS_TEXTS as T } from './giftVoucherTexts';

const MAX_IDEAS = 6;
const MAIL_KEYS = ['mailSubjectFr', 'mailBodyFr', 'mailSubjectEn', 'mailBodyEn'];

function parseIdeas(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.map((i) => ({ ...i })) : [];
  } catch {
    return [];
  }
}

function draftOf(values) {
  return {
    validityMonths: String(values.validityMonths ?? ''),
    vatRatePercent: String(values.vatRatePercent ?? '').replace('.', ','),
    minAmount: centsToEuros(values.minAmountCents),
    maxAmount: centsToEuros(values.maxAmountCents),
    pageUrl: values.pageUrl || '',
    bookingUrl: values.bookingUrl || '',
    ideas: parseIdeas(values.ideas),
    ...Object.fromEntries(MAIL_KEYS.map((k) => [k, values[k] || ''])),
  };
}

function payloadOf(draft) {
  const toCents = (text) => { const c = eurosToCents(text); return c === null ? text : String(c); };
  return {
    validityMonths: draft.validityMonths,
    vatRatePercent: draft.vatRatePercent,
    minAmountCents: toCents(draft.minAmount),
    maxAmountCents: toCents(draft.maxAmount),
    pageUrl: draft.pageUrl,
    bookingUrl: draft.bookingUrl,
    ideas: JSON.stringify(draft.ideas.map((i) => ({
      label: i.label, propertyId: Number(i.propertyId) || i.propertyId, nights: Number(i.nights) || i.nights, guests: Number(i.guests) || i.guests,
    }))),
    ...Object.fromEntries(MAIL_KEYS.map((k) => [k, draft[k]])),
  };
}

// The server's message for a key, shown on the field it names.
const ERROR_FIELDS = {
  validityMonths: 'validityMonths', vatRatePercent: 'vatRatePercent', minAmountCents: 'minAmount', maxAmountCents: 'maxAmount', ideas: 'ideas', pageUrl: 'pageUrl', bookingUrl: 'bookingUrl',
};

function IdeaRow({
  idea, properties, onChange, onRemove, index,
}) {
  const set = (key) => (event) => onChange({ ...idea, [key]: event.target.value });
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: '2fr 2fr 1fr 1fr auto' }, alignItems: 'center' }}>
      <TextField
        label={T.ideas.label} size="small" value={idea.label || ''} onChange={set('label')} sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}
        slotProps={{ htmlInput: { maxLength: 60, 'aria-label': `${T.ideas.label} ${index + 1}` } }}
      />
      <TextField
        select label={T.ideas.property} size="small" value={idea.propertyId || ''} onChange={set('propertyId')} sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}
        slotProps={{ htmlInput: { 'aria-label': `${T.ideas.property} ${index + 1}` } }}
      >
        {properties.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
      </TextField>
      <TextField
        label={T.ideas.nights} size="small" type="number" value={idea.nights || ''} onChange={set('nights')}
        slotProps={{ htmlInput: { min: 1, max: 60, 'aria-label': `${T.ideas.nights} ${index + 1}` } }}
      />
      <TextField
        label={T.ideas.guests} size="small" type="number" value={idea.guests || ''} onChange={set('guests')}
        slotProps={{ htmlInput: { min: 1, max: 30, 'aria-label': `${T.ideas.guests} ${index + 1}` } }}
      />
      <Tooltip title={T.ideas.remove}>
        <IconButton onClick={onRemove} aria-label={`${T.ideas.remove} ${index + 1}`} sx={{ width: 44, height: 44 }}><DeleteOutlineIcon /></IconButton>
      </Tooltip>
    </Box>
  );
}

function Section({ title, help, children }) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">{title}</Typography>
            {help ? <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{help}</Typography> : null}
          </Box>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function GiftVoucherSettings() {
  const { showSuccess, showError } = useToast();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [properties, setProperties] = useState([]);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    Promise.all([giftVouchersApi.getSettings(), giftVouchersApi.getProperties().catch(() => [])])
      .then(([values, list]) => {
        const next = draftOf(values);
        setSaved(next);
        setDraft(next);
        setProperties(Array.isArray(list) ? list : []);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const vatHint = draft ? vatRateHint(draft.vatRatePercent, T.vat) : null;
  const dirty = Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (key) => (event) => {
    setDraft((d) => ({ ...d, [key]: event.target.value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const setValue = (key) => (value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const setIdea = (index, idea) => { setDraft((d) => ({ ...d, ideas: d.ideas.map((x, i) => (i === index ? idea : x)) })); setErrors((e) => ({ ...e, ideas: undefined })); };
  const addIdea = () => setDraft((d) => ({ ...d, ideas: [...d.ideas, { label: '', propertyId: '', nights: 2, guests: 2 }] }));
  const removeIdea = (index) => setDraft((d) => ({ ...d, ideas: d.ideas.filter((_, i) => i !== index) }));

  async function save() {
    setBusy(true);
    try {
      const view = await giftVouchersApi.saveSettings(payloadOf(draft));
      const next = draftOf(view);
      setSaved(next);
      setDraft(next);
      setErrors({});
      showSuccess(T.saved);
    } catch (err) {
      const fields = {};
      Object.entries((err && err.errors) || {}).forEach(([key, message]) => {
        const field = ERROR_FIELDS[key] || key;
        fields[field] = message;
      });
      setErrors(fields);
      if (!Object.keys(fields).length) showError((err && err.message) || 'Les réglages n’ont pas pu être enregistrés.');
    } finally {
      setBusy(false);
    }
  }

  const bar = (
    <PageActionBar
      title={T.title} onSave={save} saveDisabled={!dirty || Boolean(vatHint)} saveBusy={busy} onCancel={() => { setDraft(saved); setErrors({}); }} cancelDisabled={!dirty}
    />
  );

  if (loadError) return <Box>{bar}<Box sx={{ p: 3 }}><ErrorAlert message={T.loadError} onRetry={load} /></Box></Box>;
  if (!draft) return <Box>{bar}<LoadingState /></Box>;

  const field = (key, label, props = {}) => (
    <TextField label={label} value={draft[key]} onChange={set(key)} error={Boolean(errors[key])} helperText={errors[key]} size="small" fullWidth {...props} />
  );

  return (
    <Box>
      {bar}
      <Stack spacing={2.5} sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 960 }}>
        <Section title={T.validity.title}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
            {field('validityMonths', T.validity.months, { type: 'number', slotProps: { htmlInput: { min: 1, inputMode: 'numeric' } } })}
            {field('minAmount', T.validity.min, { slotProps: { htmlInput: { inputMode: 'decimal' } } })}
            {field('maxAmount', T.validity.max, { slotProps: { htmlInput: { inputMode: 'decimal' } } })}
          </Box>
        </Section>

        <Section title={T.vat.title}>
          <Box sx={{ maxWidth: 280 }}>
            <TextField
              label={T.vat.rate} value={draft.vatRatePercent} onChange={set('vatRatePercent')} size="small" fullWidth
              error={Boolean(vatHint || errors.vatRatePercent)} helperText={vatHint || errors.vatRatePercent || T.vat.help}
              slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-invalid': Boolean(vatHint) }, input: { endAdornment: <InputAdornment position="end">{T.vat.unit}</InputAdornment> } }}
            />
          </Box>
        </Section>

        <Section title={T.ideas.title} help={T.ideas.help}>
          {draft.ideas.length === 0 ? <Typography variant="body2" color="text.secondary">{T.ideas.empty}</Typography> : null}
          {draft.ideas.map((idea, index) => (
            <IdeaRow key={index} index={index} idea={idea} properties={properties} onChange={(next) => setIdea(index, next)} onRemove={() => removeIdea(index)} />
          ))}
          {errors.ideas ? <Typography variant="body2" color="error" role="alert">{errors.ideas}</Typography> : null}
          {draft.ideas.length < MAX_IDEAS ? (
            <Box><Button startIcon={<AddIcon />} onClick={addIdea} sx={{ minHeight: 44 }}>{T.ideas.add}</Button></Box>
          ) : null}
        </Section>

        <Section title={T.pages.title}>
          <HelpedTextField label={T.pages.pageUrl} helperText={T.pages.pageUrlHelp} error={errors.pageUrl} value={draft.pageUrl} onChange={setValue('pageUrl')} size="small" fullWidth />
          <HelpedTextField label={T.pages.bookingUrl} helperText={T.pages.bookingUrlHelp} error={errors.bookingUrl} value={draft.bookingUrl} onChange={setValue('bookingUrl')} size="small" fullWidth />
        </Section>

        <Section title={T.mail.title} help={T.mail.help}>
          {field('mailSubjectFr', T.mail.subjectFr)}
          {field('mailBodyFr', T.mail.bodyFr, { multiline: true, minRows: 5 })}
          {field('mailSubjectEn', T.mail.subjectEn)}
          {field('mailBodyEn', T.mail.bodyEn, { multiline: true, minRows: 5 })}
        </Section>
      </Stack>
    </Box>
  );
}
