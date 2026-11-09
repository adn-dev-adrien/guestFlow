import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Alert, TextField, FormControl, InputLabel, Select, MenuItem,
  FormControlLabel, Typography, Divider, Switch, Autocomplete, LinearProgress, ToggleButton, ToggleButtonGroup, useMediaQuery, useTheme,
} from '@mui/material';
import MiniDayPlanner from './MiniDayPlanner';
import { api, formatCurrency, ConfirmDialog } from '../sdk';
import resourceBookingDraft from './resourceBookingDraft';
import useResourceBookingPreview from './useResourceBookingPreview';
import { localIsoDate } from './localDate';
import ResourceBookingSummary from './ResourceBookingSummary';
import OfferedTimeField from './OfferedTimeField';
import BookingPaymentFields, { paymentBody, allOnTheBooks, hasCard } from './BookingPaymentFields';
import BookingInvoiceBlock from './BookingInvoiceBlock';

const EMPTY_BILLING = { street: '', postcode: '', city: '' };
const dayMonth = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');

function timeToMinutes(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

// Check if a time slot range overlaps with any occupied slots (including turnover)
function isSlotAvailable(slotStart, slotEnd, occupiedSlots) {
  return !occupiedSlots.some(occupied => {
    const occupiedStart = timeToMinutes(occupied.startTime);
    const occupiedEnd = timeToMinutes(occupied.endTime) + (occupied.turnover || 0);
    const newStart = timeToMinutes(slotStart);
    const newEnd = timeToMinutes(slotEnd);
    const newEndWithTurnover = newEnd + (occupied.turnover || 0);
    return newStart < occupiedEnd && newEndWithTurnover > occupiedStart;
  });
}

const BOOKING_STEP_MINUTES = 5;

export default function ResourceBookingDialog({
  open,
  resource,
  initialDate,
  initialTime,
  booking: bookingProp,
  onClose,
  onSave,
  onDelete,
  onArrival,
  onCommitted = () => {},
}) {
  // The booking as last answered by the server: a payment taken back or an invoice made here updates it in place,
  // without resetting what is being typed (specs/resource-booking-pricing-and-invoicing.md rule 44).
  const [stored, setStored] = useState(bookingProp);
  // A booking created by this dialog whose payment step was refused: the next click edits it, never creates it again.
  const [createdId, setCreatedId] = useState(null);
  const booking = stored;
  // The booking this dialog edits: the one it opened on, or the one it created (rule 44) — previewed and excluded as itself.
  const ownId = booking?.id || createdId;
  const slotDuration = resource?.slotDuration || 5;
  const turnoverMinutes = Number(resource?.turnoverMinutes || 0);
  const minimumUsageMinutes = Number(resource?.minimumUsageMinutes || 0);
  const isHourlyResource = Boolean(resource?.isComplex) || resource?.priceType === 'per_hour';
  const openTime = resource?.openTime || '08:00';
  const closeTime = resource?.closeTime || '22:00';
  const minimumDurationMinutes = Math.max(
    isHourlyResource ? slotDuration : 0,
    isHourlyResource ? minimumUsageMinutes : 0,
    BOOKING_STEP_MINUTES,
  );

  // Full screen on a phone, like every dialog (specs/ds-components.md rule 22).
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [date, setDate] = useState('');
  const [selectedStart, setSelectedStart] = useState('');
  const [selectedEnd, setSelectedEnd] = useState('');
  const [externalMode, setExternalMode] = useState(true);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [propertyId, setPropertyId] = useState('');
  const [properties, setProperties] = useState([]);
  const [notes, setNotes] = useState('');
  const [offeredMinutes, setOfferedMinutes] = useState(0);
  // Rule 11 (Q9) — paying is a moment of its own: « À l'arrivée » by default.
  const [payWhen, setPayWhen] = useState('arrival');
  const [payment, setPayment] = useState(null);
  const [invoiceChecked, setInvoiceChecked] = useState(false);
  const [billing, setBilling] = useState(EMPTY_BILLING);
  const [invoiceOutcome, setInvoiceOutcome] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedWarning, setSavedWarning] = useState(null);
  const [occupiedSlots, setOccupiedSlots] = useState([]);
  const [paymentError, setPaymentError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const openMinutes = timeToMinutes(openTime);
  const closeMinutes = timeToMinutes(closeTime);

  const timeOptions = useMemo(() => {
    const options = [];
    for (let m = openMinutes; m <= closeMinutes; m += BOOKING_STEP_MINUTES) {
      options.push(minutesToTime(m));
    }
    return options;
  }, [openMinutes, closeMinutes]);

  const endTimeOptions = useMemo(() => {
    if (!selectedStart) return [];
    const selectedStartMinutes = timeToMinutes(selectedStart);
    return timeOptions.filter((time) => timeToMinutes(time) >= selectedStartMinutes);
  }, [selectedStart, timeOptions]);

  // Derived
  const startTime = selectedStart;
  const endTime = selectedEnd;
  const durationMinutes = selectedStart && selectedEnd
    ? timeToMinutes(selectedEnd) - timeToMinutes(selectedStart)
    : 0;
  const isChronological = selectedStart && selectedEnd
    ? timeToMinutes(selectedEnd) > timeToMinutes(selectedStart)
    : true;
  const meetsMinimumDuration = selectedStart && selectedEnd
    ? durationMinutes >= minimumDurationMinutes
    : true;

  function isStartOptionDisabled(time) {
    const mins = timeToMinutes(time);
    if (selectedEnd && mins >= timeToMinutes(selectedEnd)) return true;
    if (selectedEnd) return !isSlotAvailable(time, selectedEnd, occupiedSlots);
    const candidateEnd = minutesToTime(Math.min(closeMinutes, mins + minimumDurationMinutes));
    if ((mins + minimumDurationMinutes) > closeMinutes) return true;
    return !isSlotAvailable(time, candidateEnd, occupiedSlots);
  }

  function isEndOptionDisabled(time) {
    const mins = timeToMinutes(time);
    if (selectedStart && mins <= timeToMinutes(selectedStart)) return true;
    if (selectedStart && (mins - timeToMinutes(selectedStart)) < minimumDurationMinutes) return true;
    if (selectedStart) return !isSlotAvailable(selectedStart, time, occupiedSlots);
    return occupiedSlots.some((occupied) => {
      const occupiedStart = timeToMinutes(occupied.startTime);
      const occupiedEnd = timeToMinutes(occupied.endTime) + (occupied.turnover || 0);
      return mins > occupiedStart && mins < occupiedEnd;
    });
  }

  // The price is the server's: the draft below is all the dialog sends, and the answer is rendered as is
  // (specs/resource-supplements-total-server-side.md rules 8-14).
  const draft = useMemo(() => resourceBookingDraft({
    resourceId: resource?.id, bookingId: ownId, date, startTime: selectedStart, endTime: selectedEnd, propertyId, offeredMinutes,
  }), [resource?.id, ownId, date, selectedStart, selectedEnd, propertyId, offeredMinutes]);
  const preview = useResourceBookingPreview({ draft, enabled: open });
  const price = preview.price;

  // Check if current selection has conflicts
  const slotAvailable = useMemo(() => {
    if (!date || !selectedStart || !selectedEnd) return true;
    return meetsMinimumDuration && isSlotAvailable(selectedStart, selectedEnd, occupiedSlots);
  }, [date, selectedStart, selectedEnd, occupiedSlots, meetsMinimumDuration]);

  // Load occupied slots when date changes
  useEffect(() => {
    if (!open || !date || !resource?.id) return;
    let current = true;
    api.getOccupiedSlots(resource.id, date)
      .then((result) => {
        if (!current) return;
        const slots = result.occupiedSlots || [];
        setOccupiedSlots(ownId ? slots.filter((slot) => Number(slot.id) !== Number(ownId)) : slots);
      })
      .catch(() => { if (current) setOccupiedSlots([]); });
    return () => { current = false; };
  }, [open, date, resource?.id, ownId]);

  useEffect(() => {
    if (open) {
      api.getClients().then(setClients).catch(() => {});
      api.getProperties().then(setProperties).catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStored(bookingProp);
    setCreatedId(null);
    setPaymentError(null);
    setActionError(null);
    setConfirming(null);
    setSavedWarning(null);
    const booking = bookingProp;
    if (booking) {
      setDate(booking.date || '');
      setSelectedStart(booking.startTime || '');
      setSelectedEnd(booking.endTime || '');
      setNotes(booking.notes || '');
      setOfferedMinutes(Number(booking.offeredMinutes || 0));
      setBilling(booking.billing || EMPTY_BILLING);
      setPropertyId(booking.propertyId ? String(booking.propertyId) : '');
      if (booking.clientId) {
        setExternalMode(false);
        setSelectedClient({ id: booking.clientId, firstName: booking.firstName || '', lastName: booking.lastName || '' });
      } else {
        setExternalMode(true);
        setClientName(booking.clientName || '');
        setClientPhone(booking.clientPhone || '');
        setSelectedClient(null);
      }
    } else {
      setDate(initialDate || localIsoDate());
      setSelectedStart('');
      setSelectedEnd('');
      setNotes('');
      setOfferedMinutes(0);
      setBilling(EMPTY_BILLING);
      setPropertyId('');
      setExternalMode(true);
      setClientName('');
      setClientPhone('');
      setSelectedClient(null);
    }
    setPayWhen('arrival');
    setPayment(null);
    setInvoiceChecked(false);
    setInvoiceOutcome(null);
  }, [bookingProp, initialDate, open]); // eslint-disable-line

  // Handle MiniDayPlanner time selection
  const handleTimeSelect = (time, type) => {
    if (type === 'start') {
      setSelectedStart(time);
      setSelectedEnd(''); // Reset end when changing start
      setOfferedMinutes(0);
    } else if (type === 'end') {
      setSelectedEnd(time);
    }
  };

  // Booking, then — when paid now — the payment and the invoice, each the server's own step: a refused invoice keeps the
  // booking and its payment (rule 25), and says why where the invoice is. A refused payment keeps the booking and says
  // why where the payment is; the next click edits that booking (rule 44). The planning reloads after the last step.
  async function handleSave() {
    if (invoiceOutcome) {
      setSaving(true);
      try {
        setStored(await api.issueResourceBookingInvoice(invoiceOutcome.id, externalMode ? { billing } : {}));
        onCommitted();
        onClose();
      } catch (err) {
        setInvoiceOutcome({ code: err.code || null, message: err.message, id: invoiceOutcome.id });
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!slotAvailable || !selectedStart || !selectedEnd || !isChronological || !meetsMinimumDuration) return; // Block save if invalid
    setSaving(true);
    setPaymentError(null);
    let wrote = false;
    try {
      const data = {
        date,
        startTime,
        endTime,
        notes,
        offeredMinutes,
        propertyId: propertyId || null,
        displayedTotal: price ? price.total : undefined,
        ...(externalMode ? { billing } : {}),
        ...(externalMode
          ? { clientId: null, clientName: clientName.trim() || null, clientPhone: clientPhone.trim() || null }
          : { clientId: selectedClient?.id || null, clientName: null, clientPhone: null }),
      };
      const saved = await onSave(data, ownId);
      if (!saved) return;
      wrote = true;
      const id = ownId || saved.id;
      if (!ownId && id) setCreatedId(id);
      if (payNow && id) {
        try {
          await api.recordResourceBookingPayment(id, paymentBody(payment));
        } catch (err) {
          setPaymentError(err.message || "Paiement non enregistré.");
          return;
        }
        if (wantsInvoice) {
          try {
            await api.issueResourceBookingInvoice(id, externalMode ? { billing } : {});
          } catch (err) {
            setInvoiceOutcome({ code: err.code || null, message: err.message, id });
            return;
          }
        }
      }
      if (saved.warning) setSavedWarning(saved.warning);
      else onClose();
    } finally {
      if (wrote) onCommitted();
      setSaving(false);
    }
  }

  // Rule 44 — the actions on a stored booking: take the payment back, make or join the invoice. Each answer is the
  // booking as the server now has it; a refusal is shown where the action is.
  async function act(run) {
    setSaving(true);
    setActionError(null);
    try {
      const next = await run();
      if (next && next.id) setStored({ ...booking, ...next });
      onCommitted();
    } catch (err) {
      setActionError(err.message || 'Action impossible.');
    } finally {
      setSaving(false);
    }
  }
  const takeBackPayment = () => act(() => api.clearResourceBookingPayment(booking.id));
  const issueLater = () => act(() => api.issueResourceBookingInvoice(booking.id, booking.external && !booking.clientId ? { billing } : {}));
  const attachInvoice = () => act(() => api.attachResourceBookingInvoice(booking.id));
  const pickTransaction = (transactionId) => act(() => api.attachResourceBookingInvoice(booking.id, { transactionId }));

  const editable = !booking?.frozen;
  const payNow = payWhen === 'now' && !booking?.paid && Boolean(price && price.total > 0);
  const qontoReady = Boolean(price ? price.invoiceReady : booking?.invoiceReady);
  // Rule 44 (R35-C-L1) — a payment on the books whose invoice is still to make, or was cancelled in Qonto (A2).
  const invoiceLater = Boolean(booking?.paid && booking.payment?.onTheBooks && (!booking.invoice || booking.invoice.cancelled));
  const invoiceOffered = (payNow && allOnTheBooks(payment)) || invoiceLater;
  const wantsInvoice = invoiceOffered && invoiceChecked && qontoReady;
  const durationForOffer = durationMinutes - Number(price?.freeMinutesApplied || 0);
  const canSave = Boolean(
    date
    && selectedStart
    && selectedEnd
    && isChronological
    && meetsMinimumDuration
    && (externalMode ? clientName.trim() : selectedClient)
    && slotAvailable
    && (!payNow || Boolean(payment && payment.canSubmit))
  );
  const shownPrice = draft ? price : null;
  const showRefusal = Boolean(draft && preview.refusal && !preview.pending);
  const showUnavailable = Boolean(draft && preview.error && !preview.pending);


  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>
        {booking ? 'Modifier la réservation' : 'Nouvelle réservation'}
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
          {resource?.name} · {openTime}–{closeTime}{minimumDurationMinutes > 0 ? ` · Min ${minimumDurationMinutes} min` : ''}{turnoverMinutes > 0 ? ` · Remise en état ${turnoverMinutes} min` : ''}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: { xs: 1.5, sm: 2 } }}>
        {savedWarning ? (
          <Alert severity="warning" role="status">
            Enregistré à {formatCurrency(savedWarning.stored)} — l'aperçu affichait {formatCurrency(savedWarning.displayed)}.
          </Alert>
        ) : (
        /* Planning left; on a phone the price summary comes first and stays in view while the planner is tapped */
        <Box
          sx={{
            display: 'grid',
            columnGap: 2.5,
            rowGap: 2,
            alignItems: 'start',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '240px minmax(0, 1fr)' },
            gridTemplateAreas: { xs: '"summary" "left" "form"', sm: '"left summary" "left form"' },
            gridTemplateRows: { sm: 'auto 1fr' },
          }}
        >

          {/* LEFT: date picker + day planner */}
          <Box sx={{ gridArea: 'left', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setSelectedStart(''); setSelectedEnd(''); }}
              disabled={!editable}
              fullWidth
              size="small"
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
            <MiniDayPlanner
              date={date}
              occupiedSlots={occupiedSlots}
              selectedStart={selectedStart}
              selectedEnd={selectedEnd}
              onTimeSelect={handleTimeSelect}
              openTime={openTime}
              closeTime={closeTime}
              slotDuration={BOOKING_STEP_MINUTES}
              minimumDuration={minimumDurationMinutes}
              disabled={!editable}
            />
          </Box>

          {/* Price summary — every figure is the server's answer */}
          <Box
            sx={{
              gridArea: 'summary',
              minWidth: 0,
              position: { xs: 'sticky', sm: 'static' },
              top: 0,
              zIndex: 2,
              bgcolor: 'background.paper',
            }}
          >
            {selectedStart && selectedEnd ? (
              <Box
                aria-busy={preview.pending}
                sx={{
                  position: 'relative', overflow: 'hidden', minHeight: 64,
                  px: 1.5, py: 1, borderRadius: 1,
                  border: 1,
                  borderColor: slotAvailable && !showRefusal ? 'divider' : 'error.main',
                  bgcolor: slotAvailable && !showRefusal ? 'background.paper' : 'error.light',
                }}
              >
                {shownPrice ? (
                  <ResourceBookingSummary
                    price={shownPrice}
                    pending={preview.pending}
                    heading={`${selectedStart} → ${selectedEnd} · ${formatDuration(durationMinutes)}`}
                    offerSlot={(
                      <OfferedTimeField
                        value={offeredMinutes}
                        max={durationForOffer}
                        onChange={setOfferedMinutes}
                        refusal={showRefusal && /offert/i.test(preview.refusal || '') ? preview.refusal : null}
                        disabled={!editable || Boolean(booking?.paid)}
                      />
                    )}
                  />
                ) : (
                  <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {selectedStart} → {selectedEnd} · {formatDuration(durationMinutes)}
                    {draft && preview.pending && (
                      <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}> · Calcul du prix…</Box>
                    )}
                    {showUnavailable && (
                      <>
                        <Box component="span" sx={{ fontWeight: 400, color: 'error.main' }}> · Prix indisponible</Box>
                        <Button size="small" onClick={preview.retry} sx={{ ml: 1, minHeight: 44, minWidth: 44 }}>Réessayer</Button>
                      </>
                    )}
                  </Typography>
                )}
                {showRefusal ? (
                  <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>{preview.refusal}</Typography>
                ) : (
                  <>
                    {!slotAvailable && (
                      <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>Chevauche une réservation ou une remise en état</Typography>
                    )}
                    {!meetsMinimumDuration && (
                      <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>Durée minimale {minimumDurationMinutes} min requise</Typography>
                    )}
                    {selectedStart && selectedEnd && !isChronological && (
                      <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>
                        L'heure de fin doit être après l'heure de début.
                      </Typography>
                    )}
                  </>
                )}
                {draft && preview.pending && (
                  <LinearProgress
                    aria-label="Calcul du prix"
                    sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, bgcolor: 'transparent' }}
                  />
                )}
              </Box>
            ) : (
              <Box sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">
                  Créneau à sélectionner dans le planning
                </Typography>
              </Box>
            )}
          </Box>

          {/* RIGHT: client + form */}
          <Box sx={{ gridArea: 'form', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.25 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Heure début</InputLabel>
                <Select
                  label="Heure début"
                  value={selectedStart}
                  disabled={!editable}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setSelectedStart(nextStart);
                    if (selectedEnd && nextStart && timeToMinutes(selectedEnd) <= timeToMinutes(nextStart)) {
                      setSelectedEnd('');
                    }
                  }}
                >
                  <MenuItem value="">
                    <em>Choisir</em>
                  </MenuItem>
                  {timeOptions.map((time) => {
                    const disabled = isStartOptionDisabled(time);
                    return (
                      <MenuItem key={`start-${time}`} value={time} disabled={disabled} sx={disabled ? { color: 'text.disabled' } : undefined}>
                        {time}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>Heure fin</InputLabel>
                <Select
                  label="Heure fin"
                  value={selectedEnd}
                  disabled={!selectedStart || !editable}
                  onChange={(e) => setSelectedEnd(e.target.value)}
                >
                  <MenuItem value="">
                    <em>Choisir</em>
                  </MenuItem>
                  {endTimeOptions.map((time) => {
                    const disabled = isEndOptionDisabled(time);
                    return (
                      <MenuItem key={`end-${time}`} value={time} disabled={disabled} sx={disabled ? { color: 'text.disabled' } : undefined}>
                        {time}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Box>

            <Divider />

            {/* Client toggle */}
            <FormControlLabel
              control={<Switch checked={!externalMode} onChange={(e) => setExternalMode(!e.target.checked)} size="small" disabled={!editable} />}
              label={<Typography variant="body2">Client enregistré</Typography>}
            />

            {externalMode ? (
              <>
                <TextField
                  label="Nom du client *"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  disabled={!editable}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Téléphone"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  disabled={!editable}
                  fullWidth
                  size="small"
                />
              </>
            ) : (
              <Autocomplete
                options={clients}
                getOptionLabel={(c) => `${c.firstName || ''} ${c.lastName || ''}`.trim()}
                value={selectedClient}
                onChange={(_, v) => setSelectedClient(v)}
                disabled={!editable}
                renderInput={(params) => <TextField {...params} label="Client *" size="small" />}
                isOptionEqualToValue={(o, v) => o.id === v?.id}
              />
            )}

            {/* Property (optional) */}
            <FormControl fullWidth size="small">
              <InputLabel>Logement (optionnel)</InputLabel>
              <Select
                value={propertyId}
                label="Logement (optionnel)"
                onChange={(e) => setPropertyId(e.target.value)}
                disabled={!editable}
              >
                <MenuItem value="">— Aucun —</MenuItem>
                {properties.map((p) => <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>)}
              </Select>
            </FormControl>

            {/* Notes */}
            <TextField
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              fullWidth
              multiline
              rows={2}
              size="small"
            />

            {/* Payment (rule 11, Q9): at the arrival by default, or now with the fiches' tender lines */}
            <Divider />
            <Box sx={{ display: 'grid', gap: 1.25 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>Paiement</Typography>
              {booking?.paid ? (
                <Alert
                  severity="success"
                  action={editable ? (
                    <Button size="small" color="inherit" onClick={() => setConfirming('payment')} disabled={saving} sx={{ minHeight: 44 }}>Retirer le paiement</Button>
                  ) : null}
                >
                  Encaissé : {booking.payment?.label || 'Moyen non saisi'}, {formatCurrency(booking.totalPrice)}, le {dayMonth(booking.payment?.paidAt)}.
                </Alert>
              ) : (
                <>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={payWhen}
                    onChange={(_, next) => { if (next) { setPayWhen(next); setPayment(null); setInvoiceChecked(false); } }}
                    aria-label="Moment du paiement"
                  >
                    <ToggleButton value="arrival" sx={{ minHeight: 44, px: 2 }}>À l'arrivée</ToggleButton>
                    <ToggleButton value="now" disabled={!price || !(price.total > 0)} sx={{ minHeight: 44, px: 2 }}>Maintenant</ToggleButton>
                  </ToggleButtonGroup>
                  {payWhen === 'arrival' ? (
                    <Typography variant="caption" color="text.secondary">Le paiement et la facture se feront dans le sas d'arrivée, le jour de la séance.</Typography>
                  ) : (price && price.total > 0 && (
                    <BookingPaymentFields
                      error={paymentError}
                      dueCents={Math.round(Number(price.total) * 100)}
                      value={payment}
                      onChange={(next) => {
                        setPayment(next);
                        if (!payment || hasCard(next) !== hasCard(payment)) setInvoiceChecked(hasCard(next));
                      }}
                    />
                  ))}
                </>
              )}
            </Box>

            {actionError && <Alert severity="error">{actionError}</Alert>}
            {(payNow || booking?.invoice || invoiceOutcome || invoiceLater) && (
              <Box sx={{ display: 'grid', gap: 1.25 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Facture</Typography>
                {invoiceOutcome && invoiceOutcome.code !== 'QONTO_NEEDS_ADDRESS' && <Alert severity="error">{invoiceOutcome.message}</Alert>}
                <BookingInvoiceBlock
                  booking={booking}
                  qontoReady={qontoReady}
                  offered={invoiceOffered || Boolean(invoiceOutcome)}
                  checked={invoiceChecked}
                  onCheck={setInvoiceChecked}
                  billing={billing}
                  onBilling={setBilling}
                  addressAsked={Boolean(invoiceOutcome && invoiceOutcome.code === 'QONTO_NEEDS_ADDRESS')}
                  internalCash={payNow && Boolean(payment) && !allOnTheBooks(payment)}
                  cardDay={dayMonth(booking?.payment?.paidAt || payment?.paidAt)}
                  onIssue={issueLater}
                  onAttach={attachInvoice}
                  onPickTransaction={pickTransaction}
                  showAddress={externalMode}
                  busy={saving}
                />
              </Box>
            )}
          </Box>
        </Box>
        )}
      </DialogContent>
      <DialogActions>
        {savedWarning ? (
          <Button variant="contained" onClick={onClose} sx={{ minHeight: 44 }}>Fermer</Button>
        ) : (
          <>
            {booking && (
              <Button color="error" onClick={() => setConfirming('delete')} disabled={saving || booking.frozen || booking.paid} sx={{ mr: 'auto', minHeight: 44 }}>
                Supprimer
              </Button>
            )}
            {booking && booking.external && onArrival && (booking.arrived || booking.date === localIsoDate()) && (
              <Button onClick={() => onArrival(booking)} disabled={saving} sx={{ minHeight: 44 }}>
                {booking.arrived ? "Voir l'arrivée" : 'Arrivée'}
              </Button>
            )}
            <Button onClick={onClose} disabled={saving}>Annuler</Button>
            <Button variant="contained" onClick={handleSave} disabled={invoiceOutcome ? saving : (!canSave || !preview.fresh || saving)} sx={{ minHeight: 44 }}>
              {saving ? 'Enregistrement…' : (invoiceOutcome ? 'Créer la facture' : (draft && preview.pending ? 'Calcul du prix…' : (wantsInvoice ? 'Enregistrer et facturer' : 'Enregistrer')))}
            </Button>
          </>
        )}
      </DialogActions>
      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const what = confirming;
          setConfirming(null);
          if (what === 'delete') onDelete(booking.id);
          else takeBackPayment();
        }}
        title={confirming === 'delete' ? 'Supprimer la réservation ?' : 'Retirer le paiement ?'}
        message={confirming === 'delete'
          ? 'La réservation quitte le planning.'
          : `${formatCurrency(Number(booking?.totalPrice || 0))} ne seront plus comptés comme encaissés.`}
        confirmLabel={confirming === 'delete' ? 'Supprimer' : 'Retirer'}
      />
    </Dialog>
  );
}
