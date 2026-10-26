/**
 * IntakeBanner — what the Gîtes de France booking mail did to this fiche (specs/gites-de-france-mail-intake.md
 * rule 12), at the top of the reservation page (slot `reservation.banners`).
 *
 * States, all decided server-side: `applied` (dismissible), `needs_rent` (two rents fit the net: one button
 * each, with the commission it gives), `proposed` (the fiche was already edited: Appliquer / Ignorer),
 * `error`. Renders nothing otherwise.
 *
 * Props:
 *   reservationId          number
 *   onReservationChanged   () => void   the fiche reloads after the server wrote it
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, formatCurrency, IntakeBanner as Banner } from '../sdk';

export default function IntakeBanner({ reservationId, onReservationChanged }) {
  const [intake, setIntake] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getGdfIntakeForReservation(reservationId)
      .then((r) => setIntake(r && r.intake))
      .catch(() => setIntake(null));
  }, [reservationId]);

  useEffect(() => { load(); }, [load]);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (onReservationChanged) onReservationChanged();
      load();
    } catch (err) {
      setError(err.message || 'Échec');
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => run(() => api.dismissGdfIntake(intake.id));

  if (!intake || !['applied', 'needs_rent', 'proposed', 'error'].includes(intake.status)) return null;

  const mail = `mail Gîtes de France du ${intake.receivedLabel}`;
  const customNote = intake.customLines && intake.customLines.length > 0
    ? `Ajouté tel quel : ${intake.customLines.map((l) => `« ${l.label} » ${formatCurrency(l.amount)}`).join(', ')}.`
    : null;

  if (intake.status === 'applied') {
    return <Banner severity="success" onClose={dismiss} busy={busy} notes={[customNote]}>Rempli depuis le {mail}.</Banner>;
  }

  if (intake.status === 'error') {
    return <Banner severity="error" onClose={dismiss} busy={busy}>Le {mail} n’a pas pu être appliqué : {intake.error}</Banner>;
  }

  if (intake.status === 'proposed') {
    return (
      <Banner
        severity="info"
        busy={busy}
        error={error}
        actions={[
          { key: 'apply', label: 'Appliquer', variant: 'contained', onClick: () => run(() => api.applyGdfIntake(intake.id)) },
          { key: 'ignore', label: 'Ignorer', onClick: dismiss },
        ]}
      >
        Le {mail} (dossier {intake.dossierNumber}) concerne cette fiche, déjà modifiée à la main.
      </Banner>
    );
  }

  const rents = intake.rentCandidates || [];
  return (
    <Banner
      severity="warning"
      title={`Prix de location : ${rents.map((c) => formatCurrency(c.rent)).join(' ou ')} ?`}
      notes={[customNote]}
      choices={rents.map((c) => ({
        key: c.rent,
        label: formatCurrency(c.rent),
        caption: `commission ${formatCurrency(c.commission)}`,
        onClick: () => run(() => api.applyGdfIntake(intake.id, { rent: c.rent })),
      }))}
      link={intake.iteaUrl ? { href: intake.iteaUrl, label: 'Voir le dossier sur ITEA' } : null}
      busy={busy}
      error={error}
    >
      Le mail ne donne que le net ({formatCurrency(intake.netRent)}). Le reste de la fiche est rempli.
    </Banner>
  );
}
