/**
 * ResourceArrivalDialog — the mini SAS of an outside client (specs/outside-booking-sas.md rules 1-34, §6): « Sa séance » (the session, its offered time), « Proposés à l'arrivée »
 * (the generic suggested-articles step), « Récapitulatif » (Total, Déjà payé, Reste à payer), « Paiement » (the fiches' tender lines on the reste, « Pas maintenant »,
 * « Envoyer un lien ») and « Facture ». One commit: the server records the session, the extras, the payment and the arrival together, then asks the invoice; a refused invoice
 * keeps the rest (invoicing rule 25).
 *
 * It renders `GET /:id/visit` and the quotes of the draft (`useVisitQuote`) and never prices, sums or splits VAT: the draft is only what the operator typed (extras, offered
 * time, tenders). Stored lines change through explicit actions (« Offrir », « Retirer »), a paid one asking the administrator's confirmation of the refund it owes.
 * Specific: it composes the generic components. Full screen on a phone with the « Reste à payer » kept at the top and « Valider l'arrivée » last under the thumb;
 * two columns from `lg` (lines and picker left, recap and payment right).
 *
 * Whether the money on the books can be invoiced now is the server's `invoiceable` ({ ok, code, reason, silent }, admin only): « Créer la facture » iff `ok`, its `reason`
 * otherwise — unless `silent`, or while a draft or a payment is typed (the reason reads the stored visit).
 * At « Payé maintenant » the checkbox « Créer la facture dans Qonto » reads the same answer from the quote of the draft with the payment typed (loop t2 B2-7);
 * the block is drawn with the content, pending (checkbox disabled, same height) until that answer comes (loop t21 UI21-1).
 * Each line names its VAT rate (`line.vatRate`). An invoiced visit offers « Nouvelle vente » on its client (`newSale.client`, rule 24): the counter's dialog seeded with it.
 *
 * Props: open, bookingId, onClose, onDone (called after a successful commit)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import {
  api, formatCurrency, LoadingState, ErrorAlert, ConfirmDialog, SuggestedArticlesStep, SalePaymentLink, StatusBadge, StandaloneSaleDialog,
  useSaleComponentsReady, FocusKeeper,
} from '../sdk';
import OfferedTimeField from './OfferedTimeField';
import BookingPaymentFields, { paymentBody, paymentForDue, hasCard } from './BookingPaymentFields';
import BookingInvoiceBlock from './BookingInvoiceBlock';
import useVisitQuote from './useVisitQuote';

const TEXTS = Object.freeze({
  session: 'Sa séance',
  recap: 'Récapitulatif',
  payment: 'Paiement',
  invoice: 'Facture',
  total: 'Total',
  paid: 'Déjà payé',
  remaining: 'Reste à payer',
  refund: (amount) => `${amount} à rembourser`,
  vat: (rate, amount) => `dont TVA ${rate} % : ${amount}`,
  nothingDue: 'Rien à encaisser.',
  collect: 'Encaisser',
  later: 'Pas maintenant',
  laterHint: 'La séance reste signalée au planning jusqu’au paiement.',
  offer: 'Offrir',
  offered: 'Offert',
  vatRate: (rate) => `TVA ${rate} %`,
  newSale: 'Nouvelle vente',
  linkAfterSave: 'Enregistrer d’abord les articles ajoutés.',
  rowsAfterSave: 'Enregistrer d’abord les modifications.',
  refundTitle: 'Remboursement',
  refundAsk: 'Ligne payée : remboursement à confirmer.',
  refundAskAmount: (amount) => `Ligne payée : remboursement à confirmer. ${amount} à rembourser.`,
  refunded: 'Marquer remboursé',
  refundedAsk: 'Marquer comme remboursé ?',
  refundedFailed: 'Clôture impossible.',
  confirm: 'Confirmer',
  validate: 'Valider l’arrivée',
  save: 'Enregistrer',
  makeInvoice: 'Créer la facture',
  invoiceQuoteFailed: 'Facture non vérifiée pour ce paiement.',
  close: 'Fermer',
  cancel: 'Annuler',
  saving: 'Enregistrement…',
  notFound: 'Réservation introuvable.',
  saveFailed: 'Impossible d’enregistrer l’arrivée.',
});

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);
const toMinutes = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayMonth = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
const NO_REFUSALS = [];
const EMPTY_BILLING = { street: '', postcode: '', city: '' };
const STATUS_TONE = { paid: 'success', due: 'warning', offered: 'neutral', cancelled: 'neutral' };

// `unknown` — the draft's quote failed (loop t23 S23-1): the stored line keeps its place, its amounts read « — ».
function SessionLine({ line, disabled, onOffer, busy, unknown = false }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.75 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'baseline' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{line.label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {!unknown && line.offered && line.catalogueCents > 0 && <Box component="del" sx={{ color: 'text.secondary', fontWeight: 400, mr: 0.75 }}>{euros(line.catalogueCents)}</Box>}
          {unknown ? '—' : euros(line.totalCents)}
        </Typography>
      </Box>
      {(line.components || []).map((part) => (
        <Box key={part.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{[part.label, part.detail].filter(Boolean).join(' · ')}</Typography>
          <Typography variant="body2" color={part.amountCents < 0 ? 'success.main' : 'text.secondary'} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {unknown ? '—' : (part.amountCents < 0 ? `−${euros(-part.amountCents)}` : euros(part.amountCents))}
          </Typography>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge status={STATUS_TONE[line.status] || 'neutral'} label={line.statusLabel} />
        {line.vatRate != null && <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{TEXTS.vatRate(String(line.vatRate).replace('.', ','))}</Typography>}
        {!line.legacy && line.status !== 'cancelled' && (
          <Button size="small" variant={line.offered ? 'contained' : 'outlined'} aria-pressed={line.offered} disabled={disabled || busy} onClick={onOffer} sx={{ minHeight: 44, minWidth: 44, textTransform: 'none' }}>
            {line.offered ? TEXTS.offered : TEXTS.offer}
          </Button>
        )}
      </Box>
    </Box>
  );
}

export default function ResourceArrivalDialog({ open, bookingId, onClose, onDone }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const wide = useMediaQuery(theme.breakpoints.up('lg'));
  const [visit, setVisit] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [offeredMinutes, setOfferedMinutes] = useState(0);
  const [sessionOffered, setSessionOffered] = useState(false);
  const [extras, setExtras] = useState([]);
  const [mode, setMode] = useState('now');
  const [payment, setPayment] = useState(null);
  const [invoiceChecked, setInvoiceChecked] = useState(false);
  const [billing, setBilling] = useState(EMPTY_BILLING);
  const [busy, setBusy] = useState(false);
  const [busyLine, setBusyLine] = useState(null);
  const [error, setError] = useState(null);
  const [invoiceOutcome, setInvoiceOutcome] = useState(null);
  const [refundAsk, setRefundAsk] = useState(null);
  const [obligationAsk, setObligationAsk] = useState(null);
  const [link, setLink] = useState({ busy: false, error: null, sentTo: null });
  const [newSaleOpen, setNewSaleOpen] = useState(false);
  // The sale blocks' code is fetched with the visit; the content shows once both are there, so nothing lands under it later (plugins-phase-1-sdk rule 54, loop t20 UI20-1).
  const salesReady = useSaleComponentsReady(open);

  const load = useCallback(() => {
    setLoadError(null);
    return api.getResourceVisit(bookingId).then((v) => {
      setVisit(v);
      setOfferedMinutes(Number(v.session.offeredMinutes || 0));
      setBilling(v.booking.billing || EMPTY_BILLING);
      setMode(v.booking.arrived ? 'later' : 'now');
      return v;
    }).catch((e) => setLoadError(e.message || TEXTS.notFound));
  }, [bookingId]);
  useEffect(() => {
    if (!open || !bookingId) return;
    setVisit(null);
    setSessionOffered(false);
    setExtras([]);
    setPayment(null);
    setInvoiceChecked(false);
    setError(null);
    setInvoiceOutcome(null);
    setLink({ busy: false, error: null, sentTo: null });
    load();
  }, [open, bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const booking = visit ? visit.booking : null;
  // What this caller may do now is the server's answer (`access`: the day window, the role, an invoiced or absent visit — rules 5, 7, 24, 27).
  const readOnly = Boolean(visit) && !visit.access.writable;
  const reception = Boolean(visit && visit.access.reception);
  const invoiced = Boolean(visit && visit.invoice && !visit.invoice.cancelled);

  // The server is asked only when the draft says something the loaded visit does not: an extra, the session offered, another offered time.
  const dirty = Boolean(visit) && !readOnly && (extras.length > 0 || sessionOffered || offeredMinutes !== Number(visit.session.offeredMinutes || 0));
  const draft = useMemo(() => (dirty ? {
    ...(visit.session.editable ? { offeredMinutes, sessionOffered } : {}),
    extras: extras.map(({ articleRef, quantity, offered }) => ({ articleRef, quantity, offered: Boolean(offered) })),
  } : null), [dirty, visit, offeredMinutes, sessionOffered, extras]);
  const quote = useVisitQuote({ bookingId, draft, enabled: open, version: visit ? visit.document.version : 0 });
  const view = dirty ? (quote.visit || visit) : visit;
  // Loop t23 S23-1 — after a failed quote of the draft its amounts are unknown: the stored visit still gives the layout, but no total,
  // remainder or VAT of it is drawn and no payment can be typed until a new answer (« Réessayer »).
  const amountsUnknown = dirty && quote.failed;
  const refusals = dirty ? quote.refusals : NO_REFUSALS;

  const sessionLines = view ? view.lines.filter((line) => line.kind === 'session') : [];
  const storedExtras = view ? view.lines.filter((line) => line.kind === 'extra' && !line.draft) : [];
  // The draft entries the server did not refuse come back as draft lines, in the same order (a refused one is shown with its refusal and no figures).
  const draftLines = useMemo(() => {
    if (!view) return [];
    const refused = new Set(refusals.map((r) => r.field));
    const priced = view.lines.filter((line) => line.kind === 'extra' && line.draft);
    const accepted = extras.filter((entry) => !refused.has(entry.articleRef));
    if (priced.length !== accepted.length) return extras.map(() => null);
    let at = 0;
    return extras.map((entry) => (refused.has(entry.articleRef) ? null : priced[at++]));
  }, [view, extras, refusals]);

  const remainingCents = view && !amountsUnknown ? view.totals.remainingCents : 0;
  const payNow = !readOnly && mode === 'now' && remainingCents > 0;
  const hasChanges = dirty || payNow;
  const quoteReady = !dirty || (quote.fresh && !quote.refusal && refusals.length === 0);
  const qontoReady = Boolean(view && view.invoiceReady);
  // Loop t2 B2-7 (rule 54) — with « Payé maintenant », whether this commit could make the invoice is the server's answer for the payment typed.
  // Loop t24 — asked only for the payment typed against the remainder of the draft on screen: while a newer quote is on its way, or the
  // tenders have not yet followed it, the pair (draft, payment) is stale and its answer would be a false refusal drawn on the nominal
  // path. Meanwhile the block is drawn pending (`invoiceAwaiting`, loop t25).
  const paymentTyped = !reception && payNow && Boolean(paymentBody(payment));
  const draftCurrent = !dirty || quote.fresh;
  const paymentDraft = useMemo(
    () => (paymentTyped && draftCurrent && payment.dueCents === remainingCents ? { ...(draft || {}), payment: paymentBody(payment) } : null),
    [paymentTyped, draftCurrent, payment, remainingCents, draft],
  );
  const invoiceAwaiting = paymentTyped && !paymentDraft;
  const invoiceQuote = useVisitQuote({ bookingId, draft: paymentDraft, enabled: open, version: visit ? visit.document.version : 0 });
  // Loop t3 UI3-4/UI3-5 — no caption ↔ checkbox flip per keystroke: the pending block keeps the place of the answer (loop t21 `reserve`); the commit
  // still waits for the answer to the payment typed (`paymentReady`). « Caisse interne » and any other refusal are the server's words too.
  const draftAnswerFailed = Boolean(quote.refusal || quote.error);
  // Loop t25 — while the typed payment waits (`invoiceAwaiting`) or its answer is on its way, no answer is current for it: the block is drawn
  // pending (checkbox disabled, as ticked as the operator left it, at the reserved height) instead of an older payment's answer (owner
  // decision: no action on an unknown value).
  const invoiceAnswer = paymentDraft && invoiceQuote.fresh && invoiceQuote.visit ? invoiceQuote.visit.invoiceable || null : null;
  const invoiceOffered = Boolean(invoiceAnswer && invoiceAnswer.ok);
  const draftInternalCash = Boolean(invoiceAnswer && invoiceAnswer.code === 'INTERNAL_CASH');
  const draftRefusal = invoiceAnswer && !invoiceAnswer.ok && !invoiceAnswer.silent && !draftInternalCash ? invoiceAnswer.reason : null;
  // Loop t21 UI21-1 — the block is drawn with the content whenever « Payé maintenant » can invoice, in a pending state of the offered
  // block's height until the server answers for the payment typed (the tenders report it on mount, so that answer always comes one quote
  // after the content); the answer then fills it, and every outcome keeps that height (`reserve`): a refusal's caption, « Caisse interne »,
  // and a `silent` answer, which shows nothing (UI3-5) — its section is hidden in place. A payment no longer readable shows the block's own
  // « une fois le paiement saisi » caption. Before the tenders' first report the box reads as their default card line will set it.
  const invoiceSilenced = Boolean(invoiceAnswer && !invoiceAnswer.ok && invoiceAnswer.silent);
  const invoicePending = !reception && payNow && qontoReady && !invoiceAnswer && (!payment || Boolean(paymentDraft) || invoiceAwaiting);
  const invoiceAsked = !reception && payNow && qontoReady;
  // Money already on the books, invoiceable now: the server's `invoiceable` (invoicing rules 13, 44; loop t1 UI-10 / AV-11). It reads the stored visit, so a draft waits for its save.
  const invoiceable = visit && !reception ? visit.invoiceable : null;
  const invoiceStored = !dirty && Boolean(invoiceable && invoiceable.ok);
  // Loop t2 UI2-5 — the reason is the STORED visit's: it is shown only while nothing is typed (no draft, no payment being taken, whose save answers
  // its own invoice), and never for a refusal the server marks `silent` (no Qonto, nothing to invoice, no payment yet).
  const invoiceReason = !invoiced && !invoiceOutcome && !hasChanges && invoiceable && !invoiceable.ok && !invoiceable.silent ? invoiceable.reason : null;
  const wantsInvoice = invoiceOffered && invoiceChecked && qontoReady;
  const commitMode = !invoiceOutcome && (!booking || !booking.arrived || hasChanges);
  const primaryLabel = invoiceOutcome ? TEXTS.makeInvoice : (!booking || !booking.arrived ? TEXTS.validate : (hasChanges ? TEXTS.save : (invoiceStored ? TEXTS.makeInvoice : TEXTS.close)));
  const closesOnly = !commitMode && !invoiceOutcome && !invoiceStored;
  // The invoice question is answered before the commit, so the checkbox the operator sees is the one the commit carries.
  const paymentNow = paymentForDue(payment, remainingCents);
  const paymentReady = !payNow || (Boolean(paymentNow && paymentNow.canSubmit) && !invoiceAwaiting && (!paymentDraft || invoiceQuote.fresh));
  const canValidate = Boolean(visit) && !busy && (closesOnly || Boolean(invoiceOutcome) || (commitMode ? quoteReady && paymentReady : invoiceStored));

  const adopt = (next) => { setVisit(next); setOfferedMinutes(Number(next.session.offeredMinutes || 0)); };

  // `issue` — the invoice block's « Créer la facture »: the explicit choice of an invoice for money already taken (invoicing rule 45).
  async function validate({ issue = false } = {}) {
    if (!canValidate) return;
    setBusy(true);
    setError(null);
    try {
      if (invoiceOutcome || (!commitMode && invoiceStored)) {
        await api.issueResourceBookingInvoice(booking.id, booking.external ? { billing } : {});
        setInvoiceOutcome(null);
        onDone();
        return;
      }
      const res = await api.commitResourceVisit(booking.id, {
        ...draft,
        acceptedTotalCents: view.totals.totalCents,
        ...(visit.document.id ? { version: visit.document.version } : {}),
        payment: payNow ? paymentBody(paymentNow) : null,
        invoice: wantsInvoice || (issue && invoiceStored),
        billing: booking.external ? billing : undefined,
      });
      adopt(res.visit);
      setExtras([]);
      setSessionOffered(false);
      if (res.invoice && !res.invoice.ok) {
        setInvoiceOutcome({ code: res.invoice.code, message: res.invoice.error });
        return;
      }
      onDone();
    } catch (e) {
      if (invoiceOutcome) setInvoiceOutcome({ code: e.code || null, message: e.message });
      else setError(e.message || TEXTS.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  const attachWith = async (body) => {
    setBusy(true);
    setError(null);
    try { setVisit({ ...visit, booking: await api.attachResourceBookingInvoice(booking.id, body) }); } catch (e) { setError(e.message || 'Pièce non jointe.'); } finally { setBusy(false); }
  };

  // An explicit action on a line already stored (rules 13, 23, 25): the answer is the new visit.
  async function changeLine(line, body) {
    setBusyLine(line.id);
    setError(null);
    try {
      const res = await api.patchResourceVisitLine(booking.id, line.id, { ...body, version: visit.document.version });
      adopt(res.visit);
    } catch (e) {
      if (e.code === 'LINE_PAID' && !reception) setRefundAsk({ line, body, refundCents: Number(e.refundCents) || 0 });
      else setError(e.message);
    } finally {
      setBusyLine(null);
    }
  }

  // Rule 41 (V-4) — « Marquer remboursé » closes an open obligation of the document; the visit is read again.
  async function closeObligation(row) {
    setBusy(true);
    setError(null);
    try {
      await api.closeStandaloneSaleObligation(visit.document.id, row.id, 'settled');
      await load();
    } catch (e) {
      setError(e.message || TEXTS.refundedFailed);
    } finally {
      setBusy(false);
    }
  }

  const search = useCallback((q) => api.searchResourceVisitArticles(bookingId, q).then((res) => res.groups || []), [bookingId]);
  const addExtra = (article) => setExtras((prev) => {
    const at = prev.findIndex((entry) => entry.articleRef === article.articleRef && !entry.offered);
    if (at < 0) return [...prev, { articleRef: article.articleRef, label: article.label, max: article.max, quantity: 1, offered: false }];
    return prev.map((entry, i) => (i === at ? { ...entry, quantity: entry.quantity + 1 } : entry));
  });

  async function linkAction(work) {
    setLink((state) => ({ ...state, busy: true, error: null }));
    try {
      const res = await work();
      if (res && res.visit) adopt(res.visit);
      setLink((state) => ({ ...state, busy: false, sentTo: res && res.recipientEmail ? res.recipientEmail : null }));
    } catch (e) {
      setLink((state) => ({ ...state, busy: false, error: e.message }));
    }
  }

  const heading = booking ? `${booking.resourceName || 'Ressource'} · ${dayLabel(booking.date)} · client sans séjour` : '';
  const maxOffered = booking ? toMinutes(booking.endTime) - toMinutes(booking.startTime) : 0;
  const offerRefusal = refusals.find((r) => r.field === 'offeredMinutes');

  const linkBlock = view && (
    <SalePaymentLink
      link={view.paymentLink}
      busy={link.busy}
      error={link.error}
      sentTo={link.sentTo}
      disabled={dirty}
      onMint={(email) => linkAction(() => api.mintVisitPaymentLink(booking.id, email ? { email } : {}))}
      onSendEmail={(open) => linkAction(() => api.emailVisitPaymentLink(booking.id, open.id))}
      onWithdraw={(open) => linkAction(() => api.withdrawVisitPaymentLink(booking.id, open.id))}
    />
  );

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth={wide ? 'md' : 'sm'} fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Arrivée{booking ? ` · ${booking.displayName}` : ''}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{heading}</Typography>
      </DialogTitle>
      {view && salesReady && (
        <Box sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', px: 3, py: 1, borderBottom: 1, borderColor: 'divider', display: { xs: 'flex', sm: 'none' }, justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography variant="body2">{TEXTS.remaining}</Typography>
          <Typography data-testid="sticky-remaining" sx={{ fontFamily: (t) => t.typography.pageTitle?.fontFamily, fontWeight: 700, fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums', opacity: dirty && quote.pending ? 0.6 : 1 }}>{amountsUnknown ? '—' : euros(remainingCents)}</Typography>
        </Box>
      )}
      <DialogContent sx={{ pt: 2 }}>
        {(!visit || !salesReady) && !loadError && <LoadingState />}
        {loadError && <ErrorAlert message={loadError} onRetry={load} />}
        {view && salesReady && (
          // Loop t22 UI22-1 — an answer that removes or hides the control holding the focus (the « Facture » address on a refusal, its whole
          // section on a silent one) leaves the focus in the dialog, on the nearest region still drawn.
          <FocusKeeper sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.2fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
            <Box sx={{ display: 'grid', gap: 2.5, minWidth: 0 }}>
              {readOnly && <Alert severity="info">{visit.access.reason}</Alert>}
              <Box sx={{ display: 'grid', gap: 1 }}>
                <Typography variant="subtitle2">{TEXTS.session}</Typography>
                <Box sx={{ border: 1, borderColor: offerRefusal ? 'error.main' : 'divider', borderRadius: 1.5, p: 1.5, display: 'grid', gap: 1.5, opacity: dirty && quote.pending ? 0.6 : 1, transition: 'opacity 120ms' }}>
                  {sessionLines.map((line) => (
                    <SessionLine
                      key={line.ref || 'session'}
                      line={line}
                      disabled={readOnly}
                      busy={busyLine != null && busyLine === line.id}
                      unknown={amountsUnknown}
                      onOffer={() => (line.draft ? setSessionOffered((v) => !v) : changeLine(line, { offered: !line.offered }))}
                    />
                  ))}
                  {visit.session.editable && !readOnly && (
                    <OfferedTimeField value={offeredMinutes} max={maxOffered} onChange={setOfferedMinutes} refusal={offerRefusal ? offerRefusal.error : null} />
                  )}
                </Box>
              </Box>
              <SuggestedArticlesStep
                suggestions={view.suggestions}
                search={readOnly ? null : search}
                draft={extras}
                draftLines={draftLines}
                storedLines={storedExtras}
                storedGroups={view.groups || []}
                refusals={refusals}
                pending={dirty && quote.pending}
                disabled={readOnly}
                busyId={busyLine}
                showVatRate
                onAdd={addExtra}
                onDraftChange={(index, patch) => setExtras((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))}
                onDraftRemove={(index) => setExtras((prev) => prev.filter((_, i) => i !== index))}
                onStoredOffer={(line, offered) => changeLine(line, { offered })}
                onStoredRemove={(line) => changeLine(line, { remove: true })}
              />
            </Box>

            <Box sx={{ display: 'grid', gap: 2.5, minWidth: 0, position: { lg: 'sticky' }, top: { lg: 0 } }}>
              <Box sx={{ display: 'grid', gap: 0.75, opacity: dirty && quote.pending ? 0.6 : 1, transition: 'opacity 120ms' }}>
                <Typography variant="subtitle2">{TEXTS.recap}</Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">{TEXTS.total}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{amountsUnknown ? '—' : euros(view.totals.totalCents)}</Typography>
                </Box>
                {view.totals.paidCents > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{TEXTS.paid}</Typography>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{euros(view.totals.paidCents)}</Typography>
                  </Box>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>{TEXTS.remaining}</Typography>
                  <Typography data-testid="remaining" sx={{ fontFamily: (t) => t.typography.pageTitle?.fontFamily, fontWeight: 700, fontSize: '1.6rem', fontVariantNumeric: 'tabular-nums' }}>{amountsUnknown ? '—' : euros(view.totals.remainingCents)}</Typography>
                </Box>
                {/* Loop t22 UI22-2 — the rates sit side by side on one line: an article of another rate adds its VAT beside the first one
                    instead of a row that would push the payment down when the answer lands. */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5 }}>
                  {(amountsUnknown ? [] : view.vatByRate || []).filter((row) => row.vatCents > 0).map((row) => (
                    <Typography key={row.rate} variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{TEXTS.vat(String(row.rate).replace('.', ','), euros(row.vatCents))}</Typography>
                  ))}
                </Box>
                {(view.refundObligations || []).map((row) => (
                  <Alert
                    key={row.id}
                    severity="warning"
                    action={<Button color="inherit" size="small" disabled={busy || dirty} aria-describedby={`obligation-${row.id}`} onClick={() => setObligationAsk(row)} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.refunded}</Button>}
                  >
                    <span id={`obligation-${row.id}`}>{row.label}{row.detail ? ` · ${row.detail}` : ''}</span>
                  </Alert>
                ))}
                {dirty && (view.refundObligations || []).length > 0 && <Typography variant="caption" color="text.secondary">{TEXTS.rowsAfterSave}</Typography>}
                {view.totals.refundUnheldCents > 0 && <Alert severity="warning">{TEXTS.refund(euros(view.totals.refundUnheldCents))}</Alert>}
              </Box>

              {!readOnly && (
                <Box sx={{ display: 'grid', gap: 1 }}>
                  <Typography variant="subtitle2">{TEXTS.payment}</Typography>
                  {amountsUnknown ? (
                    <Typography variant="caption" color="text.secondary">—</Typography>
                  ) : remainingCents <= 0 ? (
                    <Typography variant="caption" color="text.secondary">{TEXTS.nothingDue}</Typography>
                  ) : (
                    <>
                      <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, next) => { if (next) { setMode(next); setPayment(null); setInvoiceChecked(false); } }} aria-label={TEXTS.payment}>
                        <ToggleButton value="now" sx={{ minHeight: 44, px: 2 }}>{TEXTS.collect}</ToggleButton>
                        <ToggleButton value="later" sx={{ minHeight: 44, px: 2 }}>{TEXTS.later}</ToggleButton>
                      </ToggleButtonGroup>
                      {mode === 'now' ? (
                        <BookingPaymentFields
                          dueCents={remainingCents}
                          whole={false}
                          shortfallKinds={['due']}
                          value={payment}
                          onChange={(next) => {
                            setPayment(next);
                            if (!payment || hasCard(next) !== hasCard(payment)) setInvoiceChecked(hasCard(next));
                          }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.secondary">{TEXTS.laterHint}</Typography>
                      )}
                      {linkBlock}
                      {dirty && view.paymentLink && view.paymentLink.available && <Typography variant="caption" color="text.secondary">{extras.length > 0 ? TEXTS.linkAfterSave : TEXTS.rowsAfterSave}</Typography>}
                    </>
                  )}
                </Box>
              )}

              {(readOnly || remainingCents <= 0) && !amountsUnknown && !reception && view.paymentLink && view.paymentLink.open && (
                <Box sx={{ display: 'grid', gap: 1 }}>
                  <Typography variant="subtitle2">{TEXTS.payment}</Typography>
                  {linkBlock}
                </Box>
              )}

              {!reception && invoiceReason && (
                <Box sx={{ display: 'grid', gap: 1 }}>
                  <Typography variant="subtitle2">{TEXTS.invoice}</Typography>
                  <Typography variant="caption" color="text.secondary">{invoiceReason}</Typography>
                </Box>
              )}
              {!reception && !invoiceReason && (invoiceAsked || invoiceOffered || invoiced || invoiceOutcome || invoiceStored || draftInternalCash || draftRefusal) && (
                <Box sx={{ display: 'grid', gap: 1, ...(invoiceSilenced ? { visibility: 'hidden' } : {}) }} aria-hidden={invoiceSilenced || undefined} data-testid="invoice-section">
                  <Typography variant="subtitle2">{TEXTS.invoice}</Typography>
                  {invoiceOutcome && invoiceOutcome.code !== 'QONTO_NEEDS_ADDRESS' && <Alert severity="error">{invoiceOutcome.message}</Alert>}
                  <BookingInvoiceBlock
                    booking={booking}
                    qontoReady={qontoReady}
                    offered={invoiceOffered || Boolean(invoiceOutcome) || invoiceStored}
                    checked={invoiceChecked || invoiceStored || Boolean(invoiceOutcome) || (invoicePending && !payment)}
                    onCheck={setInvoiceChecked}
                    billing={billing}
                    onBilling={setBilling}
                    addressAsked={Boolean(invoiceOutcome && invoiceOutcome.code === 'QONTO_NEEDS_ADDRESS')}
                    internalCash={draftInternalCash || Boolean(booking.payment && !booking.payment.onTheBooks)}
                    reason={draftRefusal}
                    pending={invoicePending}
                    reserve={invoiceAsked}
                    cardDay={dayMonth((booking.payment && booking.payment.paidAt) || (payment && payment.paidAt))}
                    onIssue={() => validate({ issue: true })}
                    onAttach={() => attachWith({})}
                    onPickTransaction={(transactionId) => attachWith({ transactionId })}
                    showAddress={booking.external && !booking.clientId}
                    busy={busy}
                  />
                </Box>
              )}
            </Box>
            {quote.refusal && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{quote.refusal}</Alert>}
            {quote.error && <ErrorAlert message={quote.error.message} onRetry={() => { quote.retry(); if (paymentDraft) invoiceQuote.retry(); }} sx={{ gridColumn: '1 / -1' }} />}
            {/* Loop t4 UI4-3 — the payment request carries the draft: its refusal or failure is shown once, by the draft's own answer. */}
            {paymentDraft && !draftAnswerFailed && invoiceQuote.refusal && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{invoiceQuote.refusal}</Alert>}
            {paymentDraft && !draftAnswerFailed && invoiceQuote.error && <ErrorAlert message={TEXTS.invoiceQuoteFailed} onRetry={invoiceQuote.retry} sx={{ gridColumn: '1 / -1' }} />}
            {error && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{error}</Alert>}
          </FocusKeeper>
        )}
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column', sm: 'row' }, gap: 1, p: 2, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } } }}>
        {visit && visit.newSale && salesReady && (
          <Button variant="outlined" onClick={() => setNewSaleOpen(true)} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' }, mr: { sm: 'auto' } }}>{TEXTS.newSale}</Button>
        )}
        {!closesOnly && !readOnly && <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>{TEXTS.cancel}</Button>}
        <Button
          variant="contained"
          onClick={closesOnly || readOnly ? onClose : () => validate()}
          disabled={!salesReady || (!canValidate && !readOnly)}
          sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
        >
          {busy ? TEXTS.saving : (readOnly ? TEXTS.close : primaryLabel)}
        </Button>
      </DialogActions>
      {visit && visit.newSale && (
        <StandaloneSaleDialog open={newSaleOpen} client={visit.newSale.client} onClose={() => setNewSaleOpen(false)} onSold={() => {}} />
      )}
      <ConfirmDialog
        open={Boolean(refundAsk)}
        title={TEXTS.refundTitle}
        message={refundAsk && refundAsk.refundCents > 0 ? TEXTS.refundAskAmount(euros(refundAsk.refundCents)) : TEXTS.refundAsk}
        confirmLabel={TEXTS.confirm}
        onClose={() => setRefundAsk(null)}
        onConfirm={() => { const ask = refundAsk; setRefundAsk(null); changeLine(ask.line, { ...ask.body, confirmRefund: true }); }}
      />
      <ConfirmDialog
        open={Boolean(obligationAsk)}
        title={TEXTS.refundedAsk}
        message={obligationAsk ? [obligationAsk.label, obligationAsk.detail].filter(Boolean).join(' · ') : ''}
        confirmLabel={TEXTS.refunded}
        confirmColor="primary"
        onClose={() => setObligationAsk(null)}
        onConfirm={() => { const row = obligationAsk; setObligationAsk(null); closeObligation(row); }}
      />
    </Dialog>
  );
}
