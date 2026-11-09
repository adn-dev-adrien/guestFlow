/**
 * ResourceArrivalDialog — the arrival of a guest who comes only for the resource, on one screen
 * (specs/resource-booking-pricing-and-invoicing.md rules 28-33): his session and its price, the offered time (by 15 min,
 * the slot itself never moves here — Q10), the payment with the fiches' tender lines or « Pas maintenant », and the Qonto
 * invoice with its optional address. One commit: the server records the arrival and the payment, then asks the invoice;
 * a refused invoice keeps both (rule 25).
 *
 * Specific: it renders one booking payload. Full screen on a phone, the total kept at the top (phone only: on a wider
 * screen the summary's own total is in view), « Valider l'arrivée »
 * last at the bottom under the thumb (rule 33).
 *
 * Props: open, bookingId, onClose, onDone (called after a successful commit)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { api, formatCurrency, LoadingState, ErrorAlert } from '../sdk';
import ResourceBookingSummary from './ResourceBookingSummary';
import OfferedTimeField from './OfferedTimeField';
import BookingPaymentFields, { paymentBody, allOnTheBooks, hasCard } from './BookingPaymentFields';
import BookingInvoiceBlock from './BookingInvoiceBlock';
import useResourceBookingPreview from './useResourceBookingPreview';
import resourceBookingDraft from './resourceBookingDraft';

const toMinutes = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayMonth = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
const EMPTY_BILLING = { street: '', postcode: '', city: '' };

export default function ResourceArrivalDialog({ open, bookingId, onClose, onDone }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [booking, setBooking] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [offeredMinutes, setOfferedMinutes] = useState(0);
  const [mode, setMode] = useState('now');
  const [payment, setPayment] = useState(null);
  const [invoiceChecked, setInvoiceChecked] = useState(false);
  const [billing, setBilling] = useState(EMPTY_BILLING);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [invoiceOutcome, setInvoiceOutcome] = useState(null);

  const load = () => {
    setLoadError(null);
    return api.getResourceBooking(bookingId).then((b) => {
      setBooking(b);
      setOfferedMinutes(Number(b.offeredMinutes || 0));
      setBilling(b.billing || EMPTY_BILLING);
      return b;
    }).catch((e) => setLoadError(e.message || 'Réservation introuvable.'));
  };
  useEffect(() => {
    if (!open || !bookingId) return;
    setBooking(null);
    setMode('now');
    setPayment(null);
    setInvoiceChecked(false);
    setError(null);
    setInvoiceOutcome(null);
    load();
  }, [open, bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = Boolean(booking && (booking.paid || booking.frozen));
  const draft = useMemo(() => (booking && !locked ? resourceBookingDraft({
    resourceId: booking.resourceId, bookingId: booking.id, date: booking.date, startTime: booking.startTime, endTime: booking.endTime,
    propertyId: booking.propertyId, offeredMinutes,
  }) : null), [booking, locked, offeredMinutes]);
  const preview = useResourceBookingPreview({ draft, enabled: open && Boolean(draft) });
  const price = locked ? null : preview.price;
  const total = price ? Number(price.total) : Number(booking?.totalPrice || 0);
  const qontoReady = Boolean(price ? price.invoiceReady : booking?.invoiceReady);
  const payNow = !locked && mode === 'now' && total > 0;
  const invoiceOffered = payNow && allOnTheBooks(payment);
  const wantsInvoice = invoiceOffered && invoiceChecked && qontoReady;
  const canValidate = Boolean(booking) && !busy && (locked || mode === 'later' || total === 0 || Boolean(payment && payment.canSubmit)) && (locked || (preview.fresh && !preview.refusal));

  async function validate() {
    setBusy(true);
    setError(null);
    try {
      if (invoiceOutcome || (locked && booking.paid && !booking.frozen && wantsInvoiceLater())) {
        await api.issueResourceBookingInvoice(booking.id, booking.external ? { billing } : {});
        setInvoiceOutcome(null);
        onDone();
        return;
      }
      const res = await api.recordResourceBookingArrival(booking.id, {
        offeredMinutes: locked ? undefined : offeredMinutes,
        payment: payNow ? paymentBody(payment) : null,
        invoice: wantsInvoice,
        billing: booking.external ? billing : undefined,
      });
      setBooking(res.booking);
      if (res.invoice && !res.invoice.ok) {
        setInvoiceOutcome({ code: res.invoice.code, message: res.invoice.error });
        return;
      }
      onDone();
    } catch (e) {
      if (invoiceOutcome) setInvoiceOutcome({ code: e.code || null, message: e.message });
      else setError(e.message || "Impossible d'enregistrer l'arrivée.");
    } finally {
      setBusy(false);
    }
  }
  // An arrival paid earlier, still without its invoice: the button makes it.
  function wantsInvoiceLater() { return Boolean(booking && booking.payment && booking.payment.onTheBooks && !booking.invoice && qontoReady); }

  const summaryPrice = price || (booking ? {
    total: Number(booking.totalPrice), lines: booking.lines || [], vat: booking.vat || null, rateGrid: 'external',
  } : null);
  const heading = booking ? `${booking.startTime} → ${booking.endTime}` : '';
  const primaryLabel = invoiceOutcome ? 'Créer la facture' : (locked ? (wantsInvoiceLater() ? 'Créer la facture' : 'Fermer') : "Valider l'arrivée");

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Arrivée{booking ? ` · ${booking.displayName}` : ''}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {booking ? `${booking.resourceName || 'Ressource'} · ${dayLabel(booking.date)} · client sans séjour` : ''}
        </Typography>
      </DialogTitle>
      {booking && (
        <Box sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', px: 3, py: 1, borderBottom: 1, borderColor: 'divider', display: { xs: 'flex', sm: 'none' }, justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography variant="body2">Total TTC</Typography>
          <Typography sx={{ fontFamily: (t) => t.typography.pageTitle.fontFamily, fontWeight: 700, fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(total)}</Typography>
        </Box>
      )}
      <DialogContent sx={{ display: 'grid', gap: 2.5, pt: 2 }}>
        {!booking && !loadError && <LoadingState />}
        {loadError && <ErrorAlert message={loadError} onRetry={load} />}
        {booking && (
          <>
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Typography variant="subtitle2">Sa séance</Typography>
              {price || locked ? (
                <Box sx={{ border: 1, borderColor: preview.refusal ? 'error.main' : 'divider', borderRadius: 1.5, p: 1.5 }}>
                  {price ? (
                    <ResourceBookingSummary
                      price={price}
                      heading={heading}
                      pending={preview.pending}
                      offerSlot={(
                        <OfferedTimeField
                          value={offeredMinutes}
                          max={toMinutes(booking.endTime) - toMinutes(booking.startTime) - Number(price.freeMinutesApplied || 0)}
                          onChange={setOfferedMinutes}
                          refusal={preview.refusal}
                        />
                      )}
                    />
                  ) : (
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {heading} · {formatCurrency(Number(booking.totalPrice))}{Number(booking.offeredMinutes) > 0 ? ` · dont ${booking.offeredMinutes} min offertes` : ''}
                    </Typography>
                  )}
                </Box>
              ) : (summaryPrice && <LoadingState />)}
            </Box>

            <Box sx={{ display: 'grid', gap: 1 }}>
              <Typography variant="subtitle2">Paiement</Typography>
              {booking.paid ? (
                <Alert severity="success">Encaissé : {booking.payment?.label || 'Moyen non saisi'}, {formatCurrency(Number(booking.totalPrice))}, le {dayMonth(booking.payment?.paidAt)}.</Alert>
              ) : total <= 0 ? (
                <Typography variant="caption" color="text.secondary">Tout est offert : rien à encaisser.</Typography>
              ) : (
                <>
                  <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, next) => { if (next) { setMode(next); setPayment(null); setInvoiceChecked(false); } }} aria-label="Paiement">
                    <ToggleButton value="now" sx={{ minHeight: 44, px: 2 }}>Encaisser</ToggleButton>
                    <ToggleButton value="later" sx={{ minHeight: 44, px: 2 }}>Pas maintenant</ToggleButton>
                  </ToggleButtonGroup>
                  {mode === 'now' ? (
                    <BookingPaymentFields
                      dueCents={Math.round(total * 100)}
                      value={payment}
                      onChange={(next) => {
                        setPayment(next);
                        if (!payment || hasCard(next) !== hasCard(payment)) setInvoiceChecked(hasCard(next));
                      }}
                    />
                  ) : (
                    <Alert severity="warning">Client arrivé, séance à encaisser : elle reste signalée au planning jusqu'au paiement.</Alert>
                  )}
                </>
              )}
            </Box>

            {(payNow || booking.invoice || booking.paid || invoiceOutcome) && (
              <Box sx={{ display: 'grid', gap: 1 }}>
                <Typography variant="subtitle2">Facture</Typography>
                {invoiceOutcome && invoiceOutcome.code !== 'QONTO_NEEDS_ADDRESS' && <Alert severity="error">{invoiceOutcome.message}</Alert>}
                <BookingInvoiceBlock
                  booking={booking}
                  qontoReady={qontoReady}
                  offered={invoiceOffered || Boolean(invoiceOutcome) || wantsInvoiceLater()}
                  checked={invoiceChecked || wantsInvoiceLater() || Boolean(invoiceOutcome)}
                  onCheck={setInvoiceChecked}
                  billing={billing}
                  onBilling={setBilling}
                  addressAsked={Boolean(invoiceOutcome && invoiceOutcome.code === 'QONTO_NEEDS_ADDRESS')}
                  internalCash={(payNow && Boolean(payment) && !allOnTheBooks(payment)) || Boolean(booking.payment && !booking.payment.onTheBooks)}
                  cardDay={dayMonth(booking.payment?.paidAt || payment?.paidAt)}
                  onIssue={validate}
                  onAttach={async () => { setBusy(true); try { setBooking(await api.attachResourceBookingInvoice(booking.id)); } finally { setBusy(false); } }}
                  onPickTransaction={async (transactionId) => { setBusy(true); try { setBooking(await api.attachResourceBookingInvoice(booking.id, { transactionId })); } finally { setBusy(false); } }}
                  showAddress={booking.external && !booking.clientId}
                  busy={busy}
                />
              </Box>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column', sm: 'row' }, gap: 1, p: 2, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } } }}>
        {!(locked && !wantsInvoiceLater()) && <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>Annuler</Button>}
        <Button
          variant="contained"
          onClick={locked && !wantsInvoiceLater() && !invoiceOutcome ? onClose : validate}
          disabled={!canValidate}
          sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
        >
          {busy ? 'Enregistrement…' : primaryLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
