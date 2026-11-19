/**
 * StandaloneSaleDialog — « Vente hors séjour » (specs/pricing-components.md rules 53, 74; specs/outside-booking-sas.md rule 8a): a sale at the counter to someone with no stay. Articles marked
 * « Vendable hors séjour », quantities bounded by the server, the external customer's VAT, the client « Passage » by default (a record only on an exact e-mail match or « Enregistrer comme
 * client »), then the money taken now with the fiches' tender lines or a payment link. After saving, « Nouvelle vente » starts the next one.
 *
 * It renders the server's quote of the draft (`POST /api/standalone-sales/quote`) and its sale (`POST /api/standalone-sales`); it prices, sums and splits VAT nowhere (CLAUDE.md §6.0). The
 * draft is only what was typed: articles with a quantity, the customer, the tenders. Core: it needs no plugin; `SalePaymentLink` is the generic link block.
 *
 * Props: open, onClose, onSold (called with the sale row after each sale, to refresh the day's list), client (optional `{ id, label, kind }`: the sale is that client's —
 * the quote and the sale carry `customer: { clientId }` and no name/e-mail is asked; outside-booking-sas rule 24, « Nouvelle vente » of an invoiced visit, loop t1 AV-8)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Checkbox, Chip, FormControlLabel, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import api from '../api';
import FormDialog from './FormDialog';
import FocusKeeper from './FocusKeeper';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import SuggestedArticlesStep from './SuggestedArticlesStep';
import SalePaymentLink from './SalePaymentLink';
import TenderLines, { tendersForDue } from './TenderLines';
import useLatestPreview from '../hooks/useLatestPreview';
import { formatCurrency } from '../utils/formatters';

const TEXTS = Object.freeze({
  title: 'Vente hors séjour',
  articles: 'Articles',
  total: 'Total',
  vat: (rate, amount) => `dont TVA ${rate} % (client extérieur) : ${amount}`,
  client: 'Client',
  optional: 'facultatif',
  name: 'Nom',
  email: 'E-mail',
  emailInvalid: 'Adresse e-mail invalide.',
  register: 'Enregistrer comme client',
  nameForRegister: 'Un nom pour enregistrer le client.',
  matched: 'Même e-mail qu’une fiche client : la vente y est rattachée.',
  passageNamed: 'Nom et e-mail gardés sur le reçu.',
  passageAnonymous: 'Vente sans client nommé.',
  payment: 'Paiement',
  nothingDue: 'Rien à encaisser.',
  allOffered: 'Tout est offert : rien à encaisser.',
  now: 'Encaisser maintenant',
  link: 'Envoyer un lien',
  linkAfter: 'Le lien se crée à l’enregistrement.',
  emailRequired: 'Adresse e-mail requise.',
  passage: 'Passage',
  sameClient: 'Vente rattachée à ce client.',
  save: 'Enregistrer la vente',
  saveAndCollect: (amount) => `Enregistrer la vente · encaisser ${amount}`,
  saveAndLink: 'Enregistrer et créer le lien',
  cancel: 'Annuler',
  close: 'Fermer',
  again: 'Nouvelle vente',
  saved: (id, client) => `Vente n° ${id} enregistrée · ${client}`,
  saveFailed: 'Vente non enregistrée.',
  loadFailed: 'Articles indisponibles.',
  quoteFailed: 'Montant indisponible.',
  empty: 'Aucun article vendable hors séjour.',
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);
const REFUSAL_STATUSES = [400, 409, 422];
const NO_REFUSALS = [];

/**
 * The customer part of the quote — and of the sale, which is refused while it differs (`emailBad`, `nameMissing`): what the server can
 * take as typed (loop t26 UI26-1). An address is sent once it reads as one, « Enregistrer comme client » once a name is there: the server
 * refuses either otherwise (400 EMAIL_INVALID / NAME_REQUIRED), and a refused quote has no amount, so every keystroke of an address would
 * blank the Total and unmount the tender lines. The customer decides no amount: it only names who the sale is for (match, new, Passage).
 */
export function quoteCustomerOf({ clientId = null, name = '', email = '', register = false }) {
  if (clientId) return { clientId };
  const typedName = String(name || '').trim();
  const typedEmail = String(email || '').trim();
  return {
    ...(typedName ? { name: typedName } : {}),
    ...(EMAIL.test(typedEmail) ? { email: typedEmail } : {}),
    ...(register && typedName ? { registerAsClient: true } : {}),
  };
}

const emptyDraft = () => ({
  extras: [], name: '', email: '', register: false, mode: 'now',
});

export default function StandaloneSaleDialog({ open, onClose, onSold, client = null }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [catalogue, setCatalogue] = useState(null);
  const [catalogueError, setCatalogueError] = useState(false);
  const [payment, setPayment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [link, setLink] = useState({ busy: false, error: null, sentTo: null });

  const [catalogueTry, setCatalogueTry] = useState(0);
  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft());
    setSaved(null);
    setError(null);
    setPayment(null);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    setCatalogueError(false);
    api.getSuggestedArticlesCatalogue({ q: '' }).then((res) => { if (current) setCatalogue(res.articles); }).catch(() => { if (current) setCatalogueError(true); });
    return () => { current = false; };
  }, [open, catalogueTry]);

  const clientId = client ? client.id : null;
  const customer = useMemo(() => quoteCustomerOf({
    clientId, name: draft.name, email: draft.email, register: draft.register,
  }), [clientId, draft.name, draft.email, draft.register]);
  const body = useMemo(() => ({
    lines: draft.extras.map(({ articleRef, quantity, offered }) => ({ articleRef, quantity, offered: Boolean(offered) })),
    customer,
  }), [draft.extras, customer]);
  const emailBad = !client && draft.email.trim() !== '' && !EMAIL.test(draft.email.trim());
  const fetcher = useCallback((request, options) => api.quoteStandaloneSale(request, options), []);
  // Loop t26 UI26-1 — only the articles decide whether the quote can be asked: the customer fields never disable it (an e-mail being
  // typed, « Enregistrer comme client » without a name), so the Total, the payment and the typed tender lines stay on screen; those
  // fields block the SAVE only (`emailBad`, `nameMissing`).
  const preview = useLatestPreview({
    fetcher, draft: body, enabled: open && !saved && draft.extras.length > 0, resetKey: open ? 'open' : 'closed',
  });
  const refused = Boolean(preview.error) && REFUSAL_STATUSES.includes(preview.error.status);
  const quote = refused || draft.extras.length === 0 ? null : preview.data;
  const refusals = useMemo(() => (quote ? quote.refusals.map((r) => ({ field: r.articleRef, code: r.code, error: r.message })) : NO_REFUSALS), [quote]);
  const document = quote ? quote.document : null;

  // The entries the server refused come back with their refusal and no line; the others come back as lines, in the same order.
  const refusedRefs = new Set(refusals.map((r) => r.field));
  const priced = document ? document.lines.filter((line) => line.status !== 'cancelled') : [];
  const accepted = draft.extras.filter((entry) => !refusedRefs.has(entry.articleRef));
  let at = 0;
  const draftLines = priced.length === accepted.length ? draft.extras.map((entry) => (refusedRefs.has(entry.articleRef) ? null : priced[at++])) : draft.extras.map(() => null);

  const remainingCents = document ? document.totals.remainingCents : 0;
  const linkState = quote ? quote.paymentLink : null;
  const linkOffered = Boolean(linkState) && linkState.reason !== 'PROVIDER_NOT_READY' && remainingCents > 0;
  // A quote that stops offering the link (provider no longer ready) brings the sale back to « now »: the tender lines drawn are the ones collected.
  const mode = linkOffered ? draft.mode : 'now';
  const payNow = mode === 'now' && remainingCents > 0;
  const linkMode = mode === 'link';
  const nameMissing = !client && draft.register && !draft.name.trim();
  const customerKind = quote ? quote.customer.kind : 'passage';
  // Loop t25 — the lines' report counts only for the due on screen (`tendersForDue`), for the button and the request alike.
  const paymentNow = tendersForDue(payment, remainingCents);
  const ready = Boolean(document) && draft.extras.length > 0 && preview.fresh && refusals.length === 0 && !emailBad && !nameMissing && !busy
    && (!payNow || Boolean(paymentNow && paymentNow.canSubmit)) && (!linkMode || (linkState.reason === null));

  const patch = (changes) => setDraft((prev) => ({ ...prev, ...changes }));
  const addExtra = (article) => setDraft((prev) => {
    const at = prev.extras.findIndex((entry) => entry.articleRef === article.articleRef && !entry.offered);
    if (at < 0) return { ...prev, extras: [...prev.extras, { articleRef: article.articleRef, label: article.label, max: article.max, quantity: 1, offered: false }] };
    return { ...prev, extras: prev.extras.map((entry, i) => (i === at ? { ...entry, quantity: entry.quantity + 1 } : entry)) };
  });
  const search = useCallback((q) => api.getSuggestedArticlesCatalogue({ q }).then((res) => res.groups || []), []);

  async function save() {
    if (!ready || (payNow && !paymentNow.live())) return;
    setBusy(true);
    setError(null);
    try {
      const sold = await api.sellStandaloneSale({
        ...body,
        acceptedTotalCents: document.totals.totalCents,
        payment: payNow ? { tenders: paymentNow.tenders, shortfall: paymentNow.shortfall } : undefined,
      });
      let result = sold;
      if (linkMode) {
        try { result = await api.mintStandaloneSaleLink(sold.document.document.id, draft.email.trim() ? { email: draft.email.trim() } : {}); } catch (e) { setLink((state) => ({ ...state, error: e.message })); }
      }
      setSaved({ ...result, sale: result.sale || sold.sale, document: result.document || sold.document });
      setLink((state) => ({ ...state, busy: false, sentTo: null }));
      if (onSold) onSold(sold.sale);
    } catch (e) {
      setError(e.message || TEXTS.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  async function linkAction(work) {
    setLink((state) => ({ ...state, busy: true, error: null }));
    try {
      const res = await work();
      if (res && res.document) setSaved((prev) => ({ ...prev, ...res }));
      setLink((state) => ({ ...state, busy: false, sentTo: res && res.recipientEmail ? res.recipientEmail : null }));
    } catch (e) {
      setLink((state) => ({ ...state, busy: false, error: e.message }));
    }
  }

  const again = () => { setDraft(emptyDraft()); setSaved(null); setPayment(null); setError(null); setLink({ busy: false, error: null, sentTo: null }); };

  if (saved) {
    const { sale } = saved;
    const saleId = saved.document.document.id;
    return (
      <FormDialog open={open} onClose={onClose} title={TEXTS.title} cancelLabel={TEXTS.close} submitLabel={TEXTS.again} onSubmit={again} sheet>
        <Box sx={{ display: 'grid', gap: 1.25, pt: 0.5 }}>
          <Alert severity="success" role="status">{TEXTS.saved(sale.id, sale.clientLabel)}</Alert>
          {sale.lines.map((text) => <Typography key={text} variant="body2">{text}</Typography>)}
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>{TEXTS.total}</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{euros(sale.totalCents)}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">{sale.statusLabel}</Typography>
          <SalePaymentLink
            link={saved.paymentLink}
            busy={link.busy}
            error={link.error}
            sentTo={link.sentTo}
            onMint={(email) => linkAction(() => api.mintStandaloneSaleLink(saleId, email ? { email } : {}))}
            onSendEmail={(open) => linkAction(() => api.emailStandaloneSaleLink(saleId, open.id))}
            onWithdraw={(open) => linkAction(() => api.withdrawStandaloneSaleLink(saleId, open.id))}
          />
        </Box>
      </FormDialog>
    );
  }

  let submitLabel = TEXTS.save;
  if (linkMode) submitLabel = TEXTS.saveAndLink;
  // The lines remount on a new due with one card line of the whole due (`key={remainingCents}`): until they report it, the label already
  // names that due, so it never flickers (loop t21 commit-label rule); the button waits for the report (`ready`).
  else if (payNow && paymentNow && paymentNow.receivedCents > 0) submitLabel = TEXTS.saveAndCollect(euros(paymentNow.receivedCents));
  else if (payNow && !paymentNow) submitLabel = TEXTS.saveAndCollect(euros(remainingCents));

  return (
    // Loop t22 UI22-2 — a sheet: the payment the first answer draws under the Total fills room already there, so neither the content
    // nor the actions move (a centred dialog re-centres and moves everything). Loop t22 UI22-1 — the content keeps the focus.
    <FormDialog open={open} onClose={onClose} title={TEXTS.title} cancelLabel={TEXTS.cancel} submitLabel={submitLabel} onSubmit={save} submitDisabled={!ready} submitBusy={busy} sheet>
      <FocusKeeper sx={{ display: 'grid', gap: 2.5, pt: 0.5 }}>
        {!catalogue && !catalogueError && <LoadingState />}
        {/* Loop t22 UI22-3 — every failure of this dialog says so with its way out. */}
        {catalogueError && <ErrorAlert message={TEXTS.loadFailed} onRetry={() => setCatalogueTry((n) => n + 1)} />}
        {catalogue && catalogue.length === 0 && <Alert severity="info">{TEXTS.empty}</Alert>}
        {catalogue && catalogue.length > 0 && (
          <Box sx={{ display: 'grid', gap: 1, opacity: preview.pending ? 0.6 : 1, transition: 'opacity 120ms' }}>
            <SuggestedArticlesStep
              title={TEXTS.articles}
              suggestions={catalogue}
              search={search}
              draft={draft.extras}
              draftLines={draftLines}
              refusals={refusals}
              pending={preview.pending}
              onAdd={addExtra}
              onDraftChange={(index, changes) => patch({ extras: draft.extras.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)) })}
              onDraftRemove={(index) => patch({ extras: draft.extras.filter((_, i) => i !== index) })}
            />
            {/* Loop t21 UI21-1 — the Total row is drawn with the first article, « — » until the quote answers, so the answer fills it; loop t22
                UI22-2 — with the place of its VAT line kept, rates side by side, so the answer lands without moving anything. */}
            {(document || draft.extras.length > 0) && (
              <Box sx={{ display: 'grid', gap: 0.5, mt: 0.5 }} data-pending-block={document ? undefined : ''}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>{TEXTS.total}</Typography>
                  <Typography data-testid="sale-total" variant="body1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{document ? euros(document.totals.totalCents) : '—'}</Typography>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, minHeight: (t) => `calc(${t.typography.caption.fontSize} * ${t.typography.caption.lineHeight})` }}>
                  {document && document.vatByRate.filter((row) => row.vatCents > 0).map((row) => (
                    <Typography key={row.rate} variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{TEXTS.vat(String(row.rate).replace('.', ','), euros(row.vatCents))}</Typography>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {client ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Typography variant="subtitle2">{TEXTS.client}</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={client.label} sx={{ maxWidth: '100%' }} />
              <Typography variant="caption" color="text.secondary">{TEXTS.sameClient}</Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Typography variant="subtitle2">{TEXTS.client} <Typography component="span" variant="caption" color="text.secondary">{TEXTS.optional}</Typography></Typography>
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
              <TextField size="small" label={TEXTS.name} value={draft.name} onChange={(e) => patch({ name: e.target.value })} slotProps={{ htmlInput: { autoComplete: 'off', style: { fontSize: 16 } } }} />
              <TextField
                size="small"
                type="email"
                label={TEXTS.email}
                value={draft.email}
                onChange={(e) => patch({ email: e.target.value })}
                error={emailBad}
                // The line of the message is kept while the address is typed (loop t26): it appears and goes without moving the payment below.
                helperText={emailBad ? TEXTS.emailInvalid : ' '}
                slotProps={{ htmlInput: { autoComplete: 'off', style: { fontSize: 16 } } }}
              />
            </Box>
            {quote && customerKind === 'match' ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip size="small" color="success" variant="outlined" label={quote.customer.label} />
                <Typography variant="caption" color="text.secondary">{TEXTS.matched}</Typography>
              </Box>
            ) : (
              <>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Chip size="small" variant="outlined" label={quote ? quote.customer.label : TEXTS.passage} />
                  <Typography variant="caption" color="text.secondary">{draft.name.trim() || draft.email.trim() ? TEXTS.passageNamed : TEXTS.passageAnonymous}</Typography>
                </Box>
                <FormControlLabel
                  sx={{ m: 0, minHeight: 44 }}
                  control={<Checkbox checked={draft.register} onChange={(e) => patch({ register: e.target.checked })} />}
                  label={TEXTS.register}
                />
                {nameMissing && <Typography role="alert" variant="caption" color="error">{TEXTS.nameForRegister}</Typography>}
              </>
            )}
          </Box>
        )}

        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="subtitle2">{TEXTS.payment}</Typography>
          {/* Loop t23 S23-1 — after a failed quote the amount is unknown: no figure, no tender line, until a new answer; loop t25 UI25-1 — the
              same until the first answer (never the customer fields: loop t26 UI26-1): articles on the sale, « — », never « Rien à encaisser ». */}
          {!document ? (
            <Typography variant="caption" color="text.secondary">{draft.extras.length > 0 ? '—' : TEXTS.nothingDue}</Typography>
          ) : remainingCents <= 0 ? (
            <Typography variant="caption" color="text.secondary">{TEXTS.allOffered}</Typography>
          ) : (
            <>
              {linkOffered && (
                <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, next) => { if (next) { patch({ mode: next }); setPayment(null); } }} aria-label={TEXTS.payment}>
                  <ToggleButton value="now" sx={{ minHeight: 44, px: 2 }}>{TEXTS.now}</ToggleButton>
                  <ToggleButton value="link" sx={{ minHeight: 44, px: 2 }}>{TEXTS.link}</ToggleButton>
                </ToggleButtonGroup>
              )}
              {mode === 'now' ? (
                <TenderLines
                  key={remainingCents}
                  dueCents={remainingCents}
                  whole={false}
                  shortfallKinds={['due']}
                  initialTenders={[{ method: 'card', amountCents: remainingCents, internal: false }]}
                  onChange={setPayment}
                />
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary">{TEXTS.linkAfter}</Typography>
                  {linkState.reason === 'NO_EMAIL' && !emailBad && <Typography variant="caption" color="error">{TEXTS.emailRequired}</Typography>}
                </>
              )}
            </>
          )}
        </Box>
        {preview.error && !refused && <ErrorAlert message={preview.error.message || TEXTS.quoteFailed} onRetry={preview.retry} />}
        {refused && <Alert severity="error">{preview.error.message}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
      </FocusKeeper>
    </FormDialog>
  );
}
