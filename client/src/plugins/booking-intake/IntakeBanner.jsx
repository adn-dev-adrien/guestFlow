/**
 * IntakeBanner — what the Booking page did to this fiche (specs/booking-extranet-intake.md rules 17–18),
 * at the top of the reservation page (slot `reservation.banners`).
 *
 * States, all decided server-side: `applied` (the fiche was filled; can be hidden) and `proposed` (the
 * fiche was already filled and differs: Appliquer / Ignorer). Renders nothing otherwise. A guest message
 * still unanswered on Booking is mentioned in both.
 *
 * Props:
 *   reservationId          number
 *   onReservationChanged   () => void   the fiche reloads after the server wrote it
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, IntakeBanner as Banner } from '../sdk';

const show = (value) => (value === null || value === undefined || value === '' ? 'vide' : String(value));

export default function IntakeBanner({ reservationId, onReservationChanged }) {
  const [intake, setIntake] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getBookingIntakeForReservation(reservationId)
      .then((r) => setIntake(r && r.intake))
      .catch(() => setIntake(null));
  }, [reservationId]);

  useEffect(() => { load(); }, [load]);

  const run = async (action, reloadFiche) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (reloadFiche && onReservationChanged) onReservationChanged();
      load();
    } catch (err) {
      setError(err.message || 'Échec');
    } finally {
      setBusy(false);
    }
  };

  if (!intake) return null;

  const guestWaiting = intake.guestMessagePending ? 'Message client sans réponse sur Booking.' : null;

  if (intake.status === 'applied') {
    return (
      <Banner severity="success" busy={busy} notes={[guestWaiting]} onClose={() => run(() => api.hideBookingIntake(intake.id), false)}>
        Rempli depuis l’extranet Booking le {intake.appliedLabel}.
      </Banner>
    );
  }

  if (intake.status === 'proposed') {
    const count = intake.differences.length;
    return (
      <Banner
        severity="info"
        busy={busy}
        error={error}
        details={intake.differences.map((d) => ({ key: d.field, text: `${d.label} : ${show(d.from)} → ${show(d.to)}` }))}
        notes={[guestWaiting]}
        actions={[
          { key: 'apply', label: 'Appliquer', variant: 'contained', onClick: () => run(() => api.applyBookingIntake(intake.id), true) },
          { key: 'ignore', label: 'Ignorer', onClick: () => run(() => api.ignoreBookingIntake(intake.id), false) },
        ]}
      >
        La page Booking propose {count} valeur{count > 1 ? 's' : ''} différente{count > 1 ? 's' : ''} de la fiche.
      </Banner>
    );
  }

  return null;
}
