/**
 * IntakeBanner — what the Airbnb booking mail did to this fiche (specs/airbnb-mail-intake.md rule 14), at
 * the top of the reservation page (slot `reservation.banners`).
 *
 * States, all decided server-side (a `proposed` intake whose sender is not authenticated warns « Expéditeur non vérifié »): `applied` (dismissible; the phone and e-mail are not in the mail),
 * `proposed` (the fiche was already edited: Appliquer / Ignorer), `error`. Each links to the reservation
 * on Airbnb. Renders nothing otherwise.
 *
 * Props:
 *   reservationId          number
 *   onReservationChanged   () => void   the fiche reloads after the server wrote it
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, IntakeBanner as Banner } from '../sdk';

export default function IntakeBanner({ reservationId, onReservationChanged }) {
  const [intake, setIntake] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getAirbnbIntakeForReservation(reservationId)
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

  if (!intake || !['applied', 'proposed', 'error'].includes(intake.status)) return null;

  const mail = `mail Airbnb du ${intake.receivedLabel}`;
  const dismiss = () => run(() => api.dismissAirbnbIntake(intake.id), false);
  const link = intake.airbnbUrl ? { href: intake.airbnbUrl, label: 'Voir sur Airbnb' } : null;

  if (intake.status === 'applied') {
    return (
      <Banner severity="success" onClose={dismiss} busy={busy} link={link} notes={[intake.taxLeftEmpty ? 'Taxe de séjour retenue laissée vide.' : null]}>
        Rempli depuis le {mail}. Téléphone et e-mail à reprendre sur Airbnb.
      </Banner>
    );
  }

  if (intake.status === 'error') {
    return <Banner severity="error" onClose={dismiss} busy={busy} link={link}>Le {mail} n’a pas pu être appliqué : {intake.error}</Banner>;
  }

  return (
    <Banner
      severity={intake.senderUnverified ? 'warning' : 'info'}
      title={intake.senderUnverified ? 'Expéditeur non vérifié' : undefined}
      busy={busy}
      error={error}
      link={link}
      actions={[
        { key: 'apply', label: 'Appliquer', variant: 'contained', onClick: () => run(() => api.applyAirbnbIntake(intake.id), true) },
        { key: 'ignore', label: 'Ignorer', onClick: dismiss },
      ]}
    >
      {intake.senderUnverified
        ? `Le ${mail} (${intake.code}) n’a pas été signé par Airbnb : rien n’est rempli sans accord.`
        : `Le ${mail} (${intake.code}) concerne cette fiche, déjà modifiée à la main.`}
    </Banner>
  );
}
