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
 * Props: open, bookingId, onClose, onDone (called after a successful commit)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import {
  api, formatCurrency, LoadingState, ErrorAlert, ConfirmDialog, SuggestedArticlesStep, SalePaymentLink, StatusBadge,
} from '../sdk';
import OfferedTimeField from './OfferedTimeField';
import BookingPaymentFields, { paymentBody, allOnTheBooks, hasCard } from './BookingPaymentFields';
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
  linkAfterSave: 'Enregistrer d’abord les articles ajoutés.',
  refundTitle: 'Remboursement',
  refundAsk: 'Ligne payée : remboursement à confirmer.',
  confirm: 'Confirmer',
  validate: 'Valider l’arrivée',
  save: 'Enregistrer',
  makeInvoice: 'Créer la facture',
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

function SessionLine({ line, disabled, onOffer, busy }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.75 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'baseline' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{line.label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {line.offered && line.catalogueCents > 0 && <Box component="del" sx={{ color: 'text.secondary', fontWeight: 400, mr: 0.75 }}>{euros(line.catalogueCents)}</Box>}
          {euros(line.totalCents)}
        </Typography>
      </Box>
      {(line.components || []).map((part) => (
        <Box key={part.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{[part.label, part.detail].filter(Boolean).join(' · ')}</Typography>
          <Typography variant="body2" color={part.amountCents < 0 ? 'success.main' : 'text.secondary'} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {part.amountCents < 0 ? `−${euros(-part.amountCents)}` : euros(part.amountCents)}
          </Typography>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge status={STATUS_TONE[line.status] || 'neutral'} label={line.statusLabel} />
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
  const [link, setLink] = useState({ busy: false, error: null, sentTo: null });

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

  const remainingCents = view ? view.totals.remainingCents : 0;
  const payNow = !readOnly && mode === 'now' && remainingCents > 0;
  const hasChanges = dirty || payNow;
  const quoteReady = !dirty || (quote.fresh && !quote.refusal && refusals.length === 0);
  const qontoReady = Boolean(view && view.invoiceReady);
  const onTheBooks = Boolean(booking && booking.payment && booking.payment.onTheBooks);
  const invoiceOffered = !reception && payNow && allOnTheBooks(payment) && Boolean(payment) && payment.gapCents === 0;
  // Money already on the books (paid at booking time, or at an earlier opening) and no invoice yet: « Créer la facture » is offered (invoicing rules 13, 44).
  const invoiceStored = Boolean(visit) && !reception && remainingCents === 0 && view.totals.totalCents > 0 && onTheBooks && !invoiced && qontoReady;
  const wantsInvoice = invoiceOffered && invoiceChecked && qontoReady;
  const commitMode = !invoiceOutcome && (!booking || !booking.arrived || hasChanges);
  const primaryLabel = invoiceOutcome ? TEXTS.makeInvoice : (!booking || !booking.arrived ? TEXTS.validate : (hasChanges ? TEXTS.save : (invoiceStored ? TEXTS.makeInvoice : TEXTS.close)));
  const closesOnly = !commitMode && !invoiceOutcome && !invoiceStored;
  const paymentReady = !payNow || Boolean(payment && payment.canSubmit);
  const canValidate = Boolean(visit) && !busy && (closesOnly || Boolean(invoiceOutcome) || (commitMode ? quoteReady && paymentReady : invoiceStored));

  const adopt = (next) => { setVisit(next); setOfferedMinutes(Number(next.session.offeredMinutes || 0)); };

  // `issue` — the invoice block's « Créer la facture »: the explicit choice of an invoice for money already taken (invoicing rule 45).
  async function validate({ issue = false } = {}) {
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
        payment: payNow ? paymentBody(payment) : null,
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
      if (e.code === 'LINE_PAID' && !reception) setRefundAsk({ line, body });
      else setError(e.message);
    } finally {
      setBusyLine(null);
    }
  }

  const search = useCallback((q) => api.searchResourceVisitArticles(bookingId, q).then((res) => res.articles), [bookingId]);
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

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth={wide ? 'md' : 'sm'} fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Arrivée{booking ? ` · ${booking.displayName}` : ''}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{heading}</Typography>
      </DialogTitle>
      {view && (
        <Box sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', px: 3, py: 1, borderBottom: 1, borderColor: 'divider', display: { xs: 'flex', sm: 'none' }, justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography variant="body2">{TEXTS.remaining}</Typography>
          <Typography data-testid="sticky-remaining" sx={{ fontFamily: (t) => t.typography.pageTitle?.fontFamily, fontWeight: 700, fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums', opacity: dirty && quote.pending ? 0.6 : 1 }}>{euros(remainingCents)}</Typography>
        </Box>
      )}
      <DialogContent sx={{ pt: 2 }}>
        {!visit && !loadError && <LoadingState />}
        {loadError && <ErrorAlert message={loadError} onRetry={load} />}
        {view && (
          <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.2fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
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
                refusals={refusals}
                pending={dirty && quote.pending}
                disabled={readOnly}
                busyId={busyLine}
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
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{euros(view.totals.totalCents)}</Typography>
                </Box>
                {view.totals.paidCents > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{TEXTS.paid}</Typography>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{euros(view.totals.paidCents)}</Typography>
                  </Box>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>{TEXTS.remaining}</Typography>
                  <Typography data-testid="remaining" sx={{ fontFamily: (t) => t.typography.pageTitle?.fontFamily, fontWeight: 700, fontSize: '1.6rem', fontVariantNumeric: 'tabular-nums' }}>{euros(view.totals.remainingCents)}</Typography>
                </Box>
                {(view.vatByRate || []).filter((row) => row.vatCents > 0).map((row) => (
                  <Typography key={row.rate} variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{TEXTS.vat(String(row.rate).replace('.', ','), euros(row.vatCents))}</Typography>
                ))}
                {view.totals.refundOwedCents > 0 && <Alert severity="warning">{TEXTS.refund(euros(view.totals.refundOwedCents))}</Alert>}
              </Box>

              {!readOnly && (
                <Box sx={{ display: 'grid', gap: 1 }}>
                  <Typography variant="subtitle2">{TEXTS.payment}</Typography>
                  {remainingCents <= 0 ? (
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
                      {dirty && view.paymentLink && view.paymentLink.available && <Typography variant="caption" color="text.secondary">{TEXTS.linkAfterSave}</Typography>}
                    </>
                  )}
                </Box>
              )}

              {!reception && (invoiceOffered || invoiced || invoiceOutcome || invoiceStored) && (
                <Box sx={{ display: 'grid', gap: 1 }}>
                  <Typography variant="subtitle2">{TEXTS.invoice}</Typography>
                  {invoiceOutcome && invoiceOutcome.code !== 'QONTO_NEEDS_ADDRESS' && <Alert severity="error">{invoiceOutcome.message}</Alert>}
                  <BookingInvoiceBlock
                    booking={booking}
                    qontoReady={qontoReady}
                    offered={invoiceOffered || Boolean(invoiceOutcome) || invoiceStored}
                    checked={invoiceChecked || invoiceStored || Boolean(invoiceOutcome)}
                    onCheck={setInvoiceChecked}
                    billing={billing}
                    onBilling={setBilling}
                    addressAsked={Boolean(invoiceOutcome && invoiceOutcome.code === 'QONTO_NEEDS_ADDRESS')}
                    internalCash={(payNow && Boolean(payment) && !allOnTheBooks(payment)) || Boolean(booking.payment && !booking.payment.onTheBooks)}
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
            {quote.error && <ErrorAlert message={quote.error.message} onRetry={quote.retry} />}
            {error && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{error}</Alert>}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column', sm: 'row' }, gap: 1, p: 2, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } } }}>
        {!closesOnly && !readOnly && <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>{TEXTS.cancel}</Button>}
        <Button
          variant="contained"
          onClick={closesOnly || readOnly ? onClose : () => validate()}
          disabled={!canValidate && !readOnly}
          sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
        >
          {busy ? TEXTS.saving : (readOnly ? TEXTS.close : primaryLabel)}
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={Boolean(refundAsk)}
        title={TEXTS.refundTitle}
        message={TEXTS.refundAsk}
        confirmLabel={TEXTS.confirm}
        onClose={() => setRefundAsk(null)}
        onConfirm={() => { const ask = refundAsk; setRefundAsk(null); changeLine(ask.line, { ...ask.body, confirmRefund: true }); }}
      />
    </Dialog>
  );
}
