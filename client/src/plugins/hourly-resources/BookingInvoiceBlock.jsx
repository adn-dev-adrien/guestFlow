/**
 * BookingInvoiceBlock — the Qonto invoice of a resource booking (specs/resource-booking-pricing-and-invoicing.md rules 2,
 * 13-19, 25). Before issue: « Créer la facture dans Qonto » (checked on a card payment) and the optional address. After:
 * the number, the attachment to the day's card credit, « Réessayer » / « Choisir la transaction » when it failed.
 * Every state is the server's (`booking.invoice`, `qontoReady`); this renders and forwards clicks.
 *
 * Props:
 *   booking       the stored booking, or null for a draft
 *   qontoReady    boolean — the instance can invoice now
 *   offered       boolean — rule 13 holds for the payment being typed
 *   checked       boolean — « Créer la facture » ticked
 *   onCheck       (bool) => void
 *   billing       { street, postcode, city } and onBilling(next) — the address of a guest with no client record
 *   addressAsked  boolean — Qonto refused without an address
 *   internalCash  boolean — the payment has a caisse-interne line
 *   cardDay       'JJ/MM' — the day of the card batch
 *   onIssue, onAttach  () => void — the buttons of a booking whose invoice is still to make / to join
 *   onPickTransaction (transactionId) => void
 *   busy          boolean
 *   showAddress   boolean — a guest with no client record
 */
import React, { useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import BillingAddressFields from './BillingAddressFields';

export default function BookingInvoiceBlock({
  booking = null, qontoReady, offered, checked, onCheck, billing, onBilling, addressAsked = false, internalCash = false,
  cardDay = '', onIssue, onAttach, onPickTransaction, busy = false, showAddress = true,
}) {
  const [picking, setPicking] = useState(false);
  const [transactionId, setTransactionId] = useState('');
  const invoice = booking && booking.invoice && !booking.invoice.cancelled ? booking.invoice : null;

  if (invoice) {
    const state = invoice.attachment.state;
    const paidByCard = Boolean(booking.payment && booking.payment.hasCard);
    return (
      <Box sx={{ display: 'grid', gap: 1 }}>
        {paidByCard && state === 'attached' && <Alert severity="success">Facture {invoice.number}, pièce jointe au lot CB du {cardDay} dans Qonto.</Alert>}
        {paidByCard && state === 'pending' && (
          <Alert severity="warning" action={<Button size="small" onClick={onAttach} disabled={busy} sx={{ minHeight: 44 }}>Réessayer</Button>}>
            Facture {invoice.number} créée dans Qonto. En attente du lot CB du {cardDay} pour y joindre la pièce.
          </Alert>
        )}
        {paidByCard && state === 'failed' && (
          <Alert severity="error">
            Facture {invoice.number} · pièce non rattachée : aucun lot CB du {cardDay} trouvé en 7 jours.
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
              <Button size="small" variant="outlined" onClick={onAttach} disabled={busy} sx={{ minHeight: 44 }}>Réessayer</Button>
              <Button size="small" onClick={() => setPicking((v) => !v)} sx={{ minHeight: 44 }}>Choisir la transaction</Button>
            </Box>
            {picking && (
              <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                <TextField size="small" label="Identifiant de la transaction Qonto" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} sx={{ flex: '1 1 220px' }} />
                <Button size="small" variant="contained" disabled={!transactionId.trim() || busy} onClick={() => onPickTransaction(transactionId.trim())} sx={{ minHeight: 44 }}>Joindre</Button>
              </Box>
            )}
          </Alert>
        )}
        {!paidByCard && <Alert severity="success">Facture {invoice.number} créée dans Qonto.</Alert>}
        <Alert severity="info">Facturée, donc à annuler dans Qonto avant de la modifier. Seule la note reste modifiable.</Alert>
      </Box>
    );
  }

  if (booking && booking.invoice && booking.invoice.cancelled && !qontoReady) {
    return <Alert severity="info">Facture annulée dans Qonto.</Alert>;
  }
  if (!qontoReady) {
    return <Alert severity="info">Facturation Qonto non connectée. Le paiement s'enregistre, et la facture pourra être créée plus tard depuis la réservation.</Alert>;
  }
  if (internalCash) {
    return <Alert severity="info">Caisse interne : hors comptabilité, pas de facture. Décocher « Caisse interne » pour la passer en compta et la facturer.</Alert>;
  }
  if (!offered) {
    return <Typography variant="caption" color="text.secondary">La facture se propose une fois le paiement saisi.</Typography>;
  }
  const stored = Boolean(booking && booking.payment);
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {addressAsked && <Alert severity="error">Paiement enregistré. La facture n'a pas été créée : Qonto demande l'adresse de facturation.</Alert>}
      {stored ? (
        <Box>
          <Button variant="outlined" onClick={onIssue} disabled={busy} sx={{ minHeight: 44 }}>Créer la facture</Button>
          {booking.invoice && booking.invoice.cancelled && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>La facture précédente a été annulée dans Qonto.</Typography>}
        </Box>
      ) : (
        <FormControlLabel
          control={<Checkbox checked={checked} onChange={(e) => onCheck(e.target.checked)} />}
          label={(
            <Box>
              <Typography variant="body2">Créer la facture dans Qonto</Typography>
              <Typography variant="caption" color="text.secondary">Cochée d'office pour la CB, à cocher pour les autres moyens.</Typography>
            </Box>
          )}
        />
      )}
      {showAddress && (checked || stored || addressAsked) && <BillingAddressFields value={billing} onChange={onBilling} required={addressAsked} disabled={busy} />}
    </Box>
  );
}
