/**
 * NewVoucherPage — « Bons cadeaux › Nouveau bon » (specs/gift-voucher-campaigns.md rules 41, 46, 52): a voucher sold outside the site, through the same server path as the
 * giver's tunnel and in the same order — the offer (a campaign on sale, or « Sur mesure »), who it is for, then one of three outcomes: « Payé », « Offert »,
 * « Envoyer un lien de paiement ». Nothing is priced or judged here: the contents, the band, the extra time, the add-ons, the recap with its VAT per rate and every refusal
 * come from the server, and a refusal is shown on the field it names. Admin only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Box, Button, Chip, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import {
  DateField, ErrorAlert, LoadingState, PageActionBar, QuantityField, useLatestPreview, useServerToday, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import AddOnsPicker from './AddOnsPicker';
import CompositionEditor from './CompositionEditor';
import ExtraTimeField from './ExtraTimeField';
import FormSection from './FormSection';
import PriceRecap from './PriceRecap';
import VisualPicker from './VisualPicker';
import useCatalogue from './useCatalogue';
import { centsToEuros, eurosToCents, formatCents } from './giftVoucherFormat';
import { NEW_VOUCHER_ERROR_FIELDS, NEW_VOUCHER_TEXTS as T } from './giftVoucherTexts';

const CUSTOM = '__custom__';
const BLANK_PEOPLE = {
  recipientName: '', senderName: '', message: '', email: '',
};

export default function NewVoucherPage() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const today = useServerToday();
  const catalogue = useCatalogue();
  const [offer, setOffer] = useState(null);
  const [visuals, setVisuals] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [choice, setChoice] = useState(null);
  const [amount, setAmount] = useState('');
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [addOns, setAddOns] = useState({});
  const [custom, setCustom] = useState({
    composition: null, validityMonths: '12', voucherVisualId: null, offeredAddOns: [], extraTimeMaxMinutes: 0,
  });
  const [people, setPeople] = useState(BLANK_PEOPLE);
  const [outcome, setOutcome] = useState('paid');
  const [method, setMethod] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState({});
  const [refusals, setRefusals] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoadError(false);
    Promise.all([giftVouchersApi.getOffer(), giftVouchersApi.listVisuals()])
      .then(([result, library]) => {
        setOffer(result);
        setVisuals(library.items);
        setChoice((current) => current || (result.campaigns[0] ? result.campaigns[0].slug : CUSTOM));
      })
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const campaign = offer && choice !== CUSTOM ? offer.campaigns.find((c) => c.slug === choice) : null;
  const isCustom = choice === CUSTOM;
  const paymentMethods = offer ? offer.paymentMethods : [];
  const chosenMethod = method || (paymentMethods[0] ? paymentMethods[0].value : '');

  const request = useMemo(() => {
    if (isCustom) {
      return {
        composition: custom.composition, validityMonths: custom.validityMonths, voucherVisualId: custom.voucherVisualId,
        offeredAddOns: custom.offeredAddOns, extraTimeMaxMinutes: custom.extraTimeMaxMinutes,
      };
    }
    if (!campaign) return null;
    if (campaign.kind === 'lodging') return { slug: campaign.slug, amountCents: eurosToCents(amount) };
    return {
      slug: campaign.slug, extraMinutes, addOns: Object.entries(addOns).filter(([, qty]) => qty > 0).map(([articleRef, qty]) => ({ articleRef, qty })),
    };
  }, [isCustom, custom, campaign, amount, extraMinutes, addOns]);

  const priceable = Boolean(request) && (isCustom ? Boolean(custom.composition && custom.composition.resourceId) : (campaign.kind !== 'lodging' || request.amountCents !== null));
  const recap = useLatestPreview({
    fetcher: (body, { signal }) => giftVouchersApi.offerPrice(body, { signal }), draft: request, enabled: priceable, resetKey: choice,
  });

  const pricingField = recap.error ? NEW_VOUCHER_ERROR_FIELDS[recap.error.code] : null;
  const fieldError = (field) => errors[field] || (pricingField === field && recap.error ? recap.error.message : undefined);
  const refusalList = [...refusals, ...(recap.error && Array.isArray(recap.error.errors) ? recap.error.errors : [])];
  const validityRefusal = (refusalList.find((e) => e.field === 'validityMonths') || {}).message;
  const clear = (key) => setErrors((e) => ({ ...e, [key]: undefined }));
  const setPerson = (key) => (event) => { setPeople((p) => ({ ...p, [key]: event.target.value })); clear(key === 'message' ? 'message' : key); };

  async function submit() {
    if (outcome === 'link' && !people.email.trim()) { setErrors({ email: T.emailRequired }); return; }
    setBusy(true);
    setRefusals([]);
    try {
      const body = {
        ...request, ...people, outcome, ...(outcome === 'paid' ? { paymentMethod: chosenMethod } : {}), ...(outcome !== 'link' && date ? { date } : {}),
      };
      const created = await giftVouchersApi.create(body);
      if (outcome === 'link') {
        showSuccess(T.linkSent(created.emailedTo));
        navigate('/bons-cadeaux');
      } else {
        showSuccess(T.created);
        navigate(`/bons-cadeaux?bon=${created.id}`);
      }
    } catch (err) {
      const field = NEW_VOUCHER_ERROR_FIELDS[err && err.code];
      if (err && Array.isArray(err.errors) && err.errors.length) setRefusals(err.errors);
      else if (field) setErrors({ [field]: err.message });
      else showError((err && err.message) || T.failed);
    } finally {
      setBusy(false);
    }
  }

  const bar = <PageActionBar title={T.title} backTo="/bons-cadeaux" />;
  if (loadError) return <Box>{bar}<Box sx={{ p: 3 }}><ErrorAlert message={T.loadError} onRetry={load} /></Box></Box>;
  if (!offer) return <Box>{bar}<LoadingState /></Box>;

  const person = (key, label, props = {}) => (
    <TextField label={label} value={people[key]} onChange={setPerson(key)} error={Boolean(errors[key])} helperText={errors[key]} size="small" fullWidth {...props} />
  );
  const modeOfCustom = (() => {
    const element = catalogue.elements && custom.composition ? catalogue.elements.find((e) => e.kind === 'resource' && e.id === custom.composition.resourceId) : null;
    return element ? element.modes.find((m) => m.band === custom.composition.band) : null;
  })();

  return (
    <Box>
      {bar}
      <Stack spacing={2.5} sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 760 }}>
        <FormSection title={T.steps.offer}>
          <Stack spacing={1} role="group" aria-label={T.steps.offer}>
            {offer.campaigns.map((c) => (
              <Button
                key={c.slug} variant={choice === c.slug ? 'contained' : 'outlined'} aria-pressed={choice === c.slug} onClick={() => { setChoice(c.slug); setErrors({}); setRefusals([]); }}
                sx={{ minHeight: 44, justifyContent: 'space-between', textAlign: 'left' }}
              >
                <span>{c.title}</span>
                {c.totalCents != null ? <span>{formatCents(c.totalCents)}</span> : null}
              </Button>
            ))}
            <Button
              variant={isCustom ? 'contained' : 'outlined'} aria-pressed={isCustom} onClick={() => { setChoice(CUSTOM); setErrors({}); setRefusals([]); }} sx={{ minHeight: 44, justifyContent: 'flex-start' }}
            >
              {T.custom}
            </Button>
          </Stack>
          {!offer.campaigns.length ? <Typography variant="body2" color="text.secondary">{T.noCampaign}</Typography> : null}
          {offer.omitted && offer.omitted.length ? offer.omitted.map((o) => (
            <Typography key={o.id} variant="body2" color="text.secondary">{`${T.omitted}${o.name} — ${o.reason}`}</Typography>
          )) : null}

          {campaign && campaign.kind === 'resource' ? (
            <Stack spacing={2}>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {campaign.contents.map((line, i) => (
                  <li key={i}><Typography variant="body2">{[line.qty > 1 ? `${line.qty} × ${line.label}` : line.label, line.detail].filter(Boolean).join(' — ')}</Typography></li>
                ))}
              </Box>
              {campaign.extraTime ? (
                <QuantityField
                  label={T.extraTime} value={extraMinutes} step={campaign.extraTime.stepMinutes} min={0} max={campaign.extraTime.maxMinutes} size="small"
                  onCommit={(v) => { setExtraMinutes(v); clear('extraMinutes'); }} error={Boolean(fieldError('extraMinutes'))}
                  helperText={fieldError('extraMinutes') || T.extraTimeHelp(`${campaign.extraTime.maxMinutes} min`)} sx={{ maxWidth: 260 }}
                />
              ) : null}
              {campaign.addOns.length ? (
                <Stack spacing={1}>
                  <Typography variant="subtitle2">{T.addOns}</Typography>
                  {campaign.addOns.map((a) => (
                    <Stack key={a.articleRef} direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{a.label}</Typography>
                      <QuantityField
                        label={T.quantity} value={addOns[a.articleRef] || 0} min={0} max={a.maxQty} size="small" onCommit={(v) => { setAddOns((m) => ({ ...m, [a.articleRef]: v })); clear('addOns'); }}
                        sx={{ maxWidth: 170 }}
                      />
                    </Stack>
                  ))}
                  {fieldError('addOns') ? <Typography variant="body2" color="error" role="alert">{fieldError('addOns')}</Typography> : null}
                </Stack>
              ) : null}
            </Stack>
          ) : null}

          {campaign && campaign.kind === 'lodging' ? (
            <Stack spacing={1.5}>
              <TextField
                label={T.amount} value={amount} onChange={(e) => { setAmount(e.target.value); clear('amount'); }} size="small" fullWidth required
                error={Boolean(fieldError('amount'))} helperText={fieldError('amount') || T.amountRange(formatCents(campaign.minAmountCents), formatCents(campaign.maxAmountCents))}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }} sx={{ maxWidth: 280 }}
              />
              {(campaign.ideas || []).length ? (
                <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} aria-label={T.ideas}>
                  {campaign.ideas.flatMap((idea) => idea.amounts.map((a) => (
                    <Chip
                      key={`${idea.label}-${a.label}`} clickable label={`${idea.label} · ${a.label} · ${formatCents(a.amountCents)}`} onClick={() => { setAmount(centsToEuros(a.amountCents)); clear('amount'); }} sx={{ minHeight: 32 }}
                    />
                  )))}
                </Stack>
              ) : null}
            </Stack>
          ) : null}

          {isCustom ? (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">{T.customHelp}</Typography>
              {catalogue.error ? <ErrorAlert message="Le catalogue n’a pas pu être chargé." onRetry={catalogue.retry} /> : null}
              {catalogue.elements ? (
                <>
                  <CompositionEditor value={custom.composition} onChange={(composition) => { setCustom((c) => ({ ...c, composition })); setRefusals([]); }} elements={catalogue.elements} errors={refusalList} />
                  <AddOnsPicker
                    value={custom.offeredAddOns} onChange={(next) => setCustom((c) => ({ ...c, offeredAddOns: next }))} elements={catalogue.elements}
                    errors={refusalList} label={T.offeredAddOns}
                  />
                  <ExtraTimeField
                    value={custom.extraTimeMaxMinutes} onChange={(v) => setCustom((c) => ({ ...c, extraTimeMaxMinutes: v }))} step={modeOfCustom ? modeOfCustom.slotMinutes : 60}
                    error={(refusalList.find((e) => e.field === 'extraTimeMaxMinutes') || {}).message} offeredLabel={T.extraTime} maxLabel={T.offeredExtra}
                  />
                </>
              ) : <LoadingState />}
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' } }}>
                <TextField
                  label={T.validity} value={custom.validityMonths} onChange={(e) => setCustom((c) => ({ ...c, validityMonths: e.target.value }))} size="small" fullWidth
                  error={Boolean(validityRefusal)} helperText={validityRefusal} slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                />
                <VisualPicker
                  label={T.visual} use="voucher" value={custom.voucherVisualId} onChange={(id) => setCustom((c) => ({ ...c, voucherVisualId: id }))} visuals={visuals}
                  onAdded={(v) => setVisuals((list) => [...list, v])} error={(refusalList.find((e) => e.field === 'voucherVisualId') || {}).message}
                />
              </Box>
            </Stack>
          ) : null}

          <Box aria-live="polite" data-testid="recap">
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{T.recap}</Typography>
            {!priceable ? <Typography variant="body2" color="text.secondary">{T.recapIdle}</Typography> : null}
            {priceable && recap.error && !pricingField && !Array.isArray(recap.error.errors) ? <Typography variant="body2" color="error" role="alert">{recap.error.message}</Typography> : null}
            {priceable && !recap.error && recap.data ? <PriceRecap price={recap.data} texts={T} /> : null}
            {priceable && !recap.error && !recap.data ? <LoadingState /> : null}
          </Box>
        </FormSection>

        <FormSection title={T.steps.who}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            {person('recipientName', T.recipient, { slotProps: { htmlInput: { maxLength: 40 } } })}
            {person('senderName', T.sender, { slotProps: { htmlInput: { maxLength: 40 } } })}
          </Box>
          {person('message', T.message, { multiline: true, minRows: 2, helperText: errors.message || `${people.message.length} / 200`, slotProps: { htmlInput: { maxLength: 200 } } })}
          {person('email', `${T.email} ${outcome === 'link' ? '' : T.emailOptional}`.trim(), { type: 'email' })}
        </FormSection>

        <FormSection title={T.steps.outcome}>
          <ToggleButtonGroup
            exclusive value={outcome} onChange={(_, next) => { if (next) { setOutcome(next); setErrors({}); } }} aria-label={T.steps.outcome} size="small"
            sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignSelf: { sm: 'flex-start' } }}
          >
            {Object.entries(T.outcomes).map(([value, label]) => <ToggleButton key={value} value={value} sx={{ minHeight: 44, px: 2 }}>{label}</ToggleButton>)}
          </ToggleButtonGroup>

          {outcome === 'paid' ? (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <TextField select label={T.method} value={chosenMethod} onChange={(e) => { setMethod(e.target.value); clear('method'); }} error={Boolean(errors.method)} helperText={errors.method} size="small" fullWidth>
                {paymentMethods.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
              </TextField>
              <DateField
                label={T.date} value={date || today || ''} onChange={(e) => { setDate(e.target.value); clear('date'); }} error={Boolean(errors.date)} helperText={errors.date} size="small"
                fullWidth slotProps={{ htmlInput: { max: today || undefined }, inputLabel: { shrink: true } }}
              />
            </Box>
          ) : null}
          {outcome === 'offered' ? <Typography variant="body2" color="text.secondary">{T.offeredNote}</Typography> : null}
          {outcome === 'link' ? <Typography variant="body2" color="text.secondary">{T.linkNote}</Typography> : null}

          <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-start' } }}>
            <Button variant="contained" onClick={submit} disabled={busy || !priceable} fullWidth={false} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>
              {outcome === 'link' ? T.submitLink : T.submit}
            </Button>
          </Box>
        </FormSection>
      </Stack>
    </Box>
  );
}
