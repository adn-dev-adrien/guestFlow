/**
 * NewVoucherPage — « Bons cadeaux › Nouveau bon » (specs/gift-vouchers/gift-voucher-campaigns.md rules 41, 46, 52): a voucher sold outside the site, through the same server path as the
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
  DateField, ErrorAlert, FocusKeeper, LoadingState, PageActionBar, PreviewFailure, useLatestPreview, useServerToday, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import AddOnsPicker from './AddOnsPicker';
import CompositionEditor from './CompositionEditor';
import ExtraTimeField from './ExtraTimeField';
import ExtrasFold from './ExtrasFold';
import FormSection from './FormSection';
import PriceRecap from './PriceRecap';
import ValidityField from './ValidityField';
import VisualPicker from './VisualPicker';
import useCatalogue from './useCatalogue';
import {
  centsToEuros, eurosToCents, formatCents, formatDay,
} from './giftVoucherFormat';
import { NEW_VOUCHER_ERROR_FIELDS, NEW_VOUCHER_TEXTS as T, PERIOD_LABELS } from './giftVoucherTexts';

const CUSTOM = '__custom__';
const BLANK_PEOPLE = {
  recipientFirstName: '', recipientLastName: '', senderName: '', message: '', email: '',
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
    composition: null, validityMonths: '12', period: 'week', voucherVisualId: null, offeredAddOns: [], extraTimeMaxMinutes: 0,
  });
  // The period the giver picks inside a campaign that sells two, and the validity of this voucher (prefilled with the campaign's, rules 11, 13).
  const [period, setPeriod] = useState('');
  const [validityMonths, setValidityMonths] = useState('');
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
  const campaignPeriods = (campaign && campaign.kind === 'resource' && campaign.periods) || [];
  const chosenPeriod = campaignPeriods.length === 1 ? campaignPeriods[0].period : period;
  const paymentMethods = offer ? offer.paymentMethods : [];
  const chosenMethod = method || (paymentMethods[0] ? paymentMethods[0].value : '');

  const request = useMemo(() => {
    if (isCustom) {
      return {
        composition: custom.composition, validityMonths: custom.validityMonths, period: custom.period, voucherVisualId: custom.voucherVisualId,
        offeredAddOns: custom.offeredAddOns, extraTimeMaxMinutes: custom.extraTimeMaxMinutes,
      };
    }
    if (!campaign) return null;
    const validity = validityMonths || String(campaign.validityMonths);
    if (campaign.kind === 'lodging') return { slug: campaign.slug, amountCents: eurosToCents(amount), validityMonths: validity };
    return {
      slug: campaign.slug,
      ...(chosenPeriod ? { period: chosenPeriod } : {}),
      validityMonths: validity,
      extraMinutes,
      addOns: Object.entries(addOns).filter(([, qty]) => qty > 0).map(([articleRef, qty]) => ({ articleRef, qty })),
    };
  }, [isCustom, custom, campaign, amount, extraMinutes, addOns, chosenPeriod, validityMonths]);

  const priceable = Boolean(request) && (isCustom ? Boolean(custom.composition && custom.composition.resourceId) : ((campaign.kind !== 'lodging' || request.amountCents !== null) && (campaign.kind === 'lodging' || campaignPeriods.length === 0 || Boolean(chosenPeriod))));
  // The price draft holds what changes the price only: a « Sur mesure » is priced on its composition (the campaign preview), so its validity,
  // its visual and what it offers the recipient never ask the server again (useLatestPreview, specs/plugins/plugins-phase-1-sdk.md rule 54).
  const priceDraft = useMemo(() => (request && isCustom ? { composition: request.composition, period: request.period, validityMonths: request.validityMonths } : request), [request, isCustom]);
  const recap = useLatestPreview({
    fetcher: (body, { signal }) => (body.composition
      ? giftVouchersApi.previewPrice({ composition: body.composition, period: body.period, validityMonths: body.validityMonths }, { signal })
      : giftVouchersApi.offerPrice(body, { signal })),
    draft: priceDraft, enabled: priceable, resetKey: choice,
  });

  const pricingField = recap.error ? NEW_VOUCHER_ERROR_FIELDS[recap.error.code] : null;
  const fieldError = (field) => errors[field] || (pricingField === field && recap.error ? recap.error.message : undefined);
  const refusalList = [...refusals, ...(recap.error && Array.isArray(recap.error.errors) ? recap.error.errors : [])];
  // The server's sentence about the validity goes as soon as the validity is changed, and comes back only if the new answer refuses again.
  const [validityDismissed, setValidityDismissed] = useState(false);
  useEffect(() => { setValidityDismissed(false); }, [recap.error, recap.data]);
  const validityRefusal = validityDismissed ? undefined : (refusalList.find((e) => e.field === 'validityMonths') || {}).message;
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
      {/* A stepper at its bound, an answer swapping the recap, « Réessayer » gone: the focus stays in the page (specs/plugins/plugins-phase-1-sdk.md rule 58, I4). */}
      <FocusKeeper>
        <Stack spacing={2.5} sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 760 }}>
          <FormSection title={T.steps.offer}>
            <Stack spacing={1} role="group" aria-label={T.steps.offer}>
              {offer.campaigns.map((c) => (
                <Button
                  key={c.slug} variant={choice === c.slug ? 'contained' : 'outlined'} aria-pressed={choice === c.slug} onClick={() => { setChoice(c.slug); setExtraMinutes(0); setAddOns({}); setPeriod(''); setValidityMonths(String(c.validityMonths)); setErrors({}); setRefusals([]); }}
                  sx={{ minHeight: 44, justifyContent: 'space-between', textAlign: 'left' }}
                >
                  <span>{c.title}</span>
                  {c.totalCents != null ? <span>{c.periods && c.periods.length > 1 ? `dès ${formatCents(c.totalCents)}` : formatCents(c.totalCents)}</span> : null}
                </Button>
              ))}
              <Button
                variant={isCustom ? 'contained' : 'outlined'} aria-pressed={isCustom} onClick={() => { setChoice(CUSTOM); setExtraMinutes(0); setAddOns({}); setPeriod(''); setErrors({}); setRefusals([]); }} sx={{ minHeight: 44, justifyContent: 'flex-start' }}
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
                {campaignPeriods.length > 1 ? (
                  <TextField
                    select label={T.period} value={period} onChange={(e) => { setPeriod(e.target.value); clear('period'); }} size="small" required sx={{ maxWidth: 320 }}
                    error={Boolean(fieldError('period'))} helperText={fieldError('period')}
                  >
                    {campaignPeriods.map((p) => <MenuItem key={p.period} value={p.period}>{`${p.label.charAt(0).toUpperCase()}${p.label.slice(1)} · ${formatCents(p.priceCents)}`}</MenuItem>)}
                  </TextField>
                ) : null}
                {campaignPeriods.length === 1 ? <Typography variant="body2">{T.periodFact(PERIOD_LABELS[campaignPeriods[0].period])}</Typography> : null}
                <ExtrasFold
                  key={campaign.slug}
                  campaign={campaign}
                  extraMinutes={extraMinutes}
                  quantities={addOns}
                  onExtraMinutes={(v) => { setExtraMinutes(v); clear('extraMinutes'); }}
                  onQuantity={(articleRef, v) => { setAddOns((m) => ({ ...m, [articleRef]: v })); clear('addOns'); }}
                  extrasCents={recap.error ? undefined : (recap.fresh && recap.data ? recap.data.extrasCents : null)}
                  extraTimeError={fieldError('extraMinutes')}
                  addOnsError={fieldError('addOns')}
                />
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
                    <CompositionEditor value={custom.composition} onChange={(composition) => { setCustom((c) => ({ ...c, composition })); setRefusals([]); }} elements={catalogue.elements} errors={refusalList} periods={[custom.period]} />
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
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                  {custom.composition && custom.composition.resourceId ? (
                    <TextField select label={T.period} value={custom.period} onChange={(e) => setCustom((c) => ({ ...c, period: e.target.value }))} size="small" fullWidth>
                      {Object.entries(PERIOD_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                    </TextField>
                  ) : null}
                  <ValidityField label={T.validity} value={custom.validityMonths} onChange={(months) => { setCustom((c) => ({ ...c, validityMonths: months })); setValidityDismissed(true); setRefusals((list) => list.filter((e) => e.field !== 'validityMonths')); }} error={validityRefusal} />
                </Box>
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr' }}>
                  <VisualPicker
                    label={T.visual} use="voucher" value={custom.voucherVisualId} onChange={(id) => setCustom((c) => ({ ...c, voucherVisualId: id }))} visuals={visuals}
                    onAdded={(v) => setVisuals((list) => [...list, v])} error={(refusalList.find((e) => e.field === 'voucherVisualId') || {}).message}
                  />
                </Box>
              </Stack>
            ) : null}

            {campaign ? (
              <Box sx={{ maxWidth: 280 }}>
                <ValidityField label={T.validity} value={validityMonths || String(campaign.validityMonths)} onChange={(months) => { setValidityMonths(months); setValidityDismissed(true); setRefusals((list) => list.filter((e) => e.field !== 'validityMonths')); clear('validityMonths'); }} error={fieldError('validityMonths') || validityRefusal} />
              </Box>
            ) : null}

            <FocusKeeper aria-live="polite" data-testid="recap">
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{T.recap}</Typography>
              {!priceable ? <Typography variant="body2" color="text.secondary">{T.recapIdle}</Typography> : null}
              {priceable && recap.error && !pricingField && !Array.isArray(recap.error.errors) ? <PreviewFailure error={recap.error} onRetry={recap.retry} fallback={T.recapFailed} /> : null}
              {priceable && !recap.error && recap.data ? <PriceRecap price={recap.data} texts={T} /> : null}
              {priceable && !recap.error && recap.data && recap.data.validUntil ? <Typography variant="body2" sx={{ mt: 1 }}>{T.validUntil(formatDay(recap.data.validUntil))}</Typography> : null}
              {priceable && !recap.error && !recap.data ? <LoadingState /> : null}
            </FocusKeeper>
          </FormSection>

          <FormSection title={T.steps.who}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              {person('recipientFirstName', T.recipientFirstName, { required: true, slotProps: { htmlInput: { maxLength: 40 } } })}
              {person('recipientLastName', T.recipientLastName, { required: true, slotProps: { htmlInput: { maxLength: 40 } } })}
            </Box>
            {person('senderName', T.sender, { slotProps: { htmlInput: { maxLength: 40 } } })}
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
              <Button variant="contained" onClick={submit} disabled={busy || !priceable || !recap.fresh} fullWidth={false} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>
                {outcome === 'link' ? T.submitLink : T.submit}
              </Button>
            </Box>
          </FormSection>
        </Stack>
      </FocusKeeper>
    </Box>
  );
}
