/**
 * CampaignEditor — one campaign (specs/gift-voucher-campaigns.md rules 2-10, 46-47, 49, 59, §4.2): general, content (a composition for a `resource` campaign, the free
 * amount, VAT and ideas for a `lodging` one), add-ons, extra time, visuals, permanent links, downloads. On `md+` the right column shows the price the server computes for the
 * content being edited; on `xs` everything is one column. The server judges the form: each refusal is shown on the field it names, and nothing here prices or validates.
 *
 * Route `/bons-cadeaux/campagnes/:id` (`nouvelle` creates). Admin only.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Alert, Box, Button, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import {
  ErrorAlert, FocusKeeper, LoadingState, PageActionBar, PreviewFailure, useLatestPreview, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import AddOnsPicker from './AddOnsPicker';
import CompositionEditor from './CompositionEditor';
import ExtraTimeField from './ExtraTimeField';
import FormSection from './FormSection';
import IdeasEditor from './IdeasEditor';
import PriceRecap from './PriceRecap';
import VisualPicker from './VisualPicker';
import useCatalogue from './useCatalogue';
import { centsToEuros, eurosToCents, vatRateHint } from './giftVoucherFormat';
import { CAMPAIGN_TEXTS, COMPOSITION_TEXTS, LODGING_TEXTS } from './giftVoucherTexts';

const T = CAMPAIGN_TEXTS.editor;
const L = LODGING_TEXTS;

const BLANK = {
  name: '', title: '', kind: 'resource', state: 'draft', validityMonths: '12', slug: '', composition: null, addOns: [], extraTimeMaxMinutes: 0,
  minAmount: '', maxAmount: '', vatRatePercent: '', ideas: [], voucherVisualId: null, merchantVisualId: null,
};

function draftOf(campaign) {
  return {
    name: campaign.name,
    title: campaign.title,
    kind: campaign.kind,
    state: campaign.state,
    validityMonths: String(campaign.validityMonths),
    slug: campaign.slug || '',
    composition: campaign.composition ? { ...campaign.composition, options: campaign.composition.options.map((o) => ({ ...o })) } : null,
    addOns: [...campaign.addOns],
    extraTimeMaxMinutes: campaign.extraTimeMaxMinutes || 0,
    minAmount: campaign.minAmountCents == null ? '' : centsToEuros(campaign.minAmountCents),
    maxAmount: campaign.maxAmountCents == null ? '' : centsToEuros(campaign.maxAmountCents),
    vatRatePercent: campaign.vatRatePercent == null ? '' : String(campaign.vatRatePercent).replace('.', ','),
    ideas: campaign.ideas.map((i) => ({ ...i })),
    voucherVisualId: campaign.voucherVisualId,
    merchantVisualId: campaign.merchantVisualId,
  };
}

function payloadOf(draft) {
  const toCents = (text) => { const c = eurosToCents(text); return c === null ? text : c; };
  const common = {
    name: draft.name,
    title: draft.title,
    kind: draft.kind,
    state: draft.state,
    validityMonths: draft.validityMonths,
    slug: draft.slug,
    voucherVisualId: draft.voucherVisualId,
    merchantVisualId: draft.merchantVisualId,
  };
  if (draft.kind === 'lodging') {
    return {
      ...common,
      minAmountCents: toCents(draft.minAmount),
      maxAmountCents: toCents(draft.maxAmount),
      vatRatePercent: draft.vatRatePercent,
      ideas: draft.ideas.map((i) => ({
        label: i.label, propertyId: Number(i.propertyId) || i.propertyId, nights: Number(i.nights) || i.nights, guests: Number(i.guests) || i.guests,
      })),
    };
  }
  return {
    ...common, composition: draft.composition, addOns: draft.addOns, extraTimeMaxMinutes: draft.extraTimeMaxMinutes,
  };
}

// The server's field names → the field of the page (amounts are typed in euros here).
const FIELD_ALIASES = { minAmountCents: 'minAmount', maxAmountCents: 'maxAmount' };

export default function CampaignEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const isNew = id === 'nouvelle';
  const catalogue = useCatalogue();
  const [campaign, setCampaign] = useState(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [visuals, setVisuals] = useState([]);
  const [properties, setProperties] = useState([]);
  const [errors, setErrors] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const load = useCallback(() => {
    setLoadError(false);
    const reading = isNew ? Promise.resolve(null) : giftVouchersApi.getCampaign(id);
    Promise.all([reading, giftVouchersApi.listVisuals()])
      .then(([found, library]) => {
        const next = found ? draftOf(found) : BLANK;
        setCampaign(found);
        setSaved(next);
        setDraft(next);
        setVisuals(library.items);
        setErrors([]);
      })
      .catch(() => setLoadError(true));
  }, [id, isNew]);
  useEffect(load, [load]);

  const lodging = draft && draft.kind === 'lodging';
  useEffect(() => {
    if (lodging) giftVouchersApi.getProperties().then((list) => setProperties(Array.isArray(list) ? list : [])).catch(() => {});
  }, [lodging]);

  const dirty = Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(saved);
  const errorOf = (field) => (errors.find((e) => (FIELD_ALIASES[e.field] || e.field) === field) || {}).message;
  const set = (key) => (event) => { setDraft((d) => ({ ...d, [key]: event.target.value })); setErrors((list) => list.filter((e) => (FIELD_ALIASES[e.field] || e.field) !== key)); };
  const setValue = (key) => (value) => { setDraft((d) => ({ ...d, [key]: value })); setErrors((list) => list.filter((e) => !(FIELD_ALIASES[e.field] || e.field).startsWith(key))); };

  const composition = draft ? draft.composition : null;
  const previewDraft = useMemo(() => ({ composition }), [composition]);
  const previewable = Boolean(draft) && draft.kind === 'resource' && Boolean(composition && composition.resourceId);
  const preview = useLatestPreview({
    fetcher: (body, { signal }) => giftVouchersApi.previewPrice({ composition: body.composition }, { signal }),
    draft: previewDraft, enabled: previewable, resetKey: id,
  });

  async function save() {
    setBusy(true);
    try {
      const body = payloadOf(draft);
      const result = isNew ? await giftVouchersApi.createCampaign(body) : await giftVouchersApi.updateCampaign(id, body);
      const next = draftOf(result);
      setCampaign(result);
      setSaved(next);
      setDraft(next);
      setErrors([]);
      showSuccess(T.saved);
      if (isNew) navigate(`/bons-cadeaux/campagnes/${result.id}`, { replace: true });
    } catch (err) {
      if (err && Array.isArray(err.errors) && err.errors.length) setErrors(err.errors);
      else showError((err && err.message) || 'La campagne n’a pas pu être enregistrée.');
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    try {
      const copy = await giftVouchersApi.duplicateCampaign(id);
      showSuccess(T.duplicated);
      navigate(`/bons-cadeaux/campagnes/${copy.id}`);
    } catch (err) {
      showError((err && err.message) || 'La campagne n’a pas pu être dupliquée.');
    }
  }

  async function download(action) {
    setDownloadError(null);
    try {
      await action();
      load();
    } catch (err) {
      setDownloadError((err && err.message) || T.downloadFailed);
    }
  }

  const saveable = campaign && !isNew;
  const actionsBefore = saveable ? [
    { icon: <ContentCopyOutlinedIcon />, tooltip: T.duplicate, onClick: duplicate },
    { icon: <FileDownloadOutlinedIcon />, tooltip: T.exportRecipe, onClick: () => download(() => giftVouchersApi.downloadRecipe(campaign.id, campaign.slug)), disabled: dirty || campaign.kind !== 'resource' },
  ] : [];
  const bar = (
    <PageActionBar
      title={isNew ? T.newTitle : (campaign ? campaign.name : CAMPAIGN_TEXTS.title)} backTo="/bons-cadeaux/campagnes" actionsBefore={actionsBefore}
      onSave={save} saveDisabled={!dirty} saveBusy={busy} onCancel={() => { setDraft(saved); setErrors([]); }} cancelDisabled={!dirty}
    />
  );

  if (loadError) return <Box>{bar}<Box sx={{ p: 3 }}><ErrorAlert message={T.loadError} onRetry={load} /></Box></Box>;
  if (!draft || !catalogue.elements) {
    return <Box>{bar}{catalogue.error ? <Box sx={{ p: 3 }}><ErrorAlert message={COMPOSITION_TEXTS.loadError} onRetry={catalogue.retry} /></Box> : <LoadingState />}</Box>;
  }

  const elements = catalogue.elements;
  const resource = composition ? elements.find((e) => e.kind === 'resource' && e.id === composition.resourceId) : null;
  const mode = resource ? resource.modes.find((m) => m.band === composition.band) : null;
  const vatHint = lodging ? vatRateHint(draft.vatRatePercent, L.vat) : null;
  const text = (key, label, props = {}) => (
    <TextField label={label} value={draft[key]} onChange={set(key)} error={Boolean(errorOf(key))} helperText={errorOf(key)} size="small" fullWidth {...props} />
  );
  const links = campaign ? campaign.links : null;

  let previewBody;
  if (draft.kind === 'lodging') previewBody = <Typography variant="body2" color="text.secondary">{T.previewLodging}</Typography>;
  else if (!previewable) previewBody = <Typography variant="body2" color="text.secondary">{T.previewIdle}</Typography>;
  else if (preview.error) previewBody = <PreviewFailure error={preview.error} onRetry={preview.retry} fallback={T.previewFailed} />;
  else if (preview.data) previewBody = <PriceRecap price={preview.data} texts={T} />;
  else previewBody = <LoadingState />;

  return (
    <Box>
      {bar}
      <Box sx={{ p: { xs: 1.5, sm: 3 }, display: 'grid', gap: 2.5, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' }, alignItems: 'start' }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          {campaign && campaign.pricing && !campaign.pricing.priceable ? <Alert severity="warning">{`${T.notPriceable}${campaign.pricing.reason}`}</Alert> : null}

          <FormSection title={T.general}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
              {text('name', T.name, { slotProps: { htmlInput: { maxLength: 80 } } })}
              <TextField select label={T.state} value={draft.state} onChange={set('state')} size="small" error={Boolean(errorOf('state'))} helperText={errorOf('state')} fullWidth>
                {T.states.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
              </TextField>
            </Box>
            {text('title', T.publicTitle, { helperText: errorOf('title') || T.publicTitleHelp, slotProps: { htmlInput: { maxLength: 80 } } })}
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' } }}>
              {text('validityMonths', T.validity, { slotProps: { htmlInput: { inputMode: 'numeric' } } })}
              {isNew ? (
                <TextField select label={T.kind} value={draft.kind} onChange={set('kind')} size="small" error={Boolean(errorOf('kind'))} helperText={errorOf('kind')} fullWidth>
                  {T.kinds.map((k) => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
                </TextField>
              ) : <TextField label={T.kind} value={(T.kinds.find((k) => k.value === draft.kind) || {}).label} size="small" fullWidth disabled />}
            </Box>
          </FormSection>

          {draft.kind === 'resource' ? (
            <>
              <FormSection title={T.content}>
                <CompositionEditor value={composition} onChange={setValue('composition')} elements={elements} errors={errors} />
              </FormSection>
              <FormSection title={T.addOns} help={T.addOnsHelp}>
                <AddOnsPicker value={draft.addOns} onChange={setValue('addOns')} elements={elements} errors={errors} label={T.addOnsLabel} />
              </FormSection>
              <FormSection title={T.extraTime}>
                <ExtraTimeField
                  value={draft.extraTimeMaxMinutes} onChange={setValue('extraTimeMaxMinutes')} step={mode ? mode.slotMinutes : 60}
                  error={errorOf('extraTimeMaxMinutes')} offeredLabel={T.extraTimeOffered} maxLabel={T.extraTimeMax}
                />
              </FormSection>
            </>
          ) : (
            <FormSection title={L.title} help={L.help}>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
                {text('minAmount', L.min, { slotProps: { htmlInput: { inputMode: 'decimal' } } })}
                {text('maxAmount', L.max, { slotProps: { htmlInput: { inputMode: 'decimal' } } })}
                <TextField
                  label={L.vat.rate} value={draft.vatRatePercent} onChange={set('vatRatePercent')} size="small" fullWidth
                  error={Boolean(vatHint || errorOf('vatRatePercent'))} helperText={vatHint || errorOf('vatRatePercent') || L.vat.help}
                  slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-invalid': Boolean(vatHint) } }}
                />
              </Box>
              <IdeasEditor ideas={draft.ideas} properties={properties} onChange={setValue('ideas')} error={errorOf('ideas')} />
            </FormSection>
          )}

          <FormSection title={T.visuals} help={T.visualsNote}>
            <VisualPicker
              label={T.voucherFront} use="voucher" value={draft.voucherVisualId} onChange={setValue('voucherVisualId')} visuals={visuals}
              onAdded={(v) => setVisuals((list) => [...list, v])} error={errorOf('voucherVisualId')}
            />
            <VisualPicker
              label={T.merchantFront} use="merchant" value={draft.merchantVisualId} onChange={setValue('merchantVisualId')} visuals={visuals}
              onAdded={(v) => setVisuals((list) => [...list, v])} error={errorOf('merchantVisualId')}
            />
          </FormSection>

          <FormSection title={T.links}>
            <TextField
              label={T.slug} value={draft.slug} onChange={set('slug')} size="small" fullWidth disabled={Boolean(campaign && campaign.slugLockedAt)}
              error={Boolean(errorOf('slug'))} helperText={errorOf('slug') || (campaign && campaign.slugLockedAt ? T.slugLocked : undefined)}
            />
            <Stack spacing={0.5}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{`${T.linkOffer} : `}<b>{links && links.offer ? links.offer : T.linkNone}</b></Typography>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{`${T.linkUse} : `}<b>{links ? links.use : '—'}</b></Typography>
            </Stack>
          </FormSection>

          <FormSection title={T.downloads}>
            <Box>
              <Button
                variant="outlined" startIcon={<FileDownloadOutlinedIcon />} disabled={!campaign || dirty} sx={{ minHeight: 44 }}
                onClick={() => download(async () => { await giftVouchersApi.downloadMerchantCard(campaign.id, campaign.slug); showSuccess(T.merchantCardDone); })}
              >
                {T.merchantCard}
              </Button>
            </Box>
            <Typography variant="body2" color="text.secondary">{T.merchantCardNote}</Typography>
            {downloadError ? <Typography variant="body2" color="error" role="alert">{downloadError}</Typography> : null}
          </FormSection>
        </Stack>

        <Box sx={{ position: { md: 'sticky' }, top: { md: 'calc(var(--gf-page-bar-bottom, 120px) + 16px)' } }}>
          <FormSection title={T.preview}>
            <FocusKeeper aria-live="polite">{previewBody}</FocusKeeper>
          </FormSection>
        </Box>
      </Box>
    </Box>
  );
}
