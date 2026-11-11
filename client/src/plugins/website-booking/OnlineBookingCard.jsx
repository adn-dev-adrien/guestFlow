/**
 * Paramètres › Conditions générales — what the website booking adds to the page (slot
 * `terms.settings`, specs/plugins-phase-2-hosts.md rule 25; specs/terms-acceptance-record.md rules
 * 16-18). Rendered twice by the page:
 *
 *   placement="alerts"  the two blocking alerts, at the top: no published version, outdated plugin
 *   placement="card"    the « Réservation en ligne » card: the emergency switch, the last plugin seen
 *
 * Props: placement ('alerts' | 'card'), currentVersion (number | null — the published CGV version,
 * so a publication refreshes the closed-booking alert).
 */
import React, { useState } from 'react';
import { Alert, Card, CardContent, FormControlLabel, Switch, Typography } from '@mui/material';
import { ConfirmDialog, ErrorAlert, useToast } from '../sdk';
import { useOnlineBooking } from './useOnlineBooking';

function OnlineBookingAlerts({ view }) {
  return (
    <>
      {view.bookingClosed && (
        <Alert severity="error">
          Aucune version publiée : réservation en ligne fermée jusqu’à la publication des conditions générales.
        </Alert>
      )}
      {view.outdatedPluginBlocks && (
        <Alert severity="error">
          Le site utilise le plugin {view.lastSeenPluginVersion}, qui n’envoie pas l’acceptation : toutes les demandes de réservation sont refusées.
          Mettez-le à jour en {view.minPluginVersion} ou désactivez l’exigence ci-dessous.
        </Alert>
      )}
    </>
  );
}

function OnlineBookingSwitchCard({ view, setEnforcement }) {
  const { showSuccess, showError } = useToast();
  const [confirmDisable, setConfirmDisable] = useState(false);

  const apply = async (value) => {
    setConfirmDisable(false);
    try {
      await setEnforcement(value);
      showSuccess(value ? 'Acceptation des CGV exigée' : 'Exigence désactivée');
    } catch (e) {
      showError(e.message || 'Échec de l’enregistrement.');
    }
  };

  return (
    <>
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
          <Typography variant="sectionHeader" component="h2">Réservation en ligne</Typography>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={(
              <Switch
                checked={view.requireTermsAcceptance}
                onChange={(e) => (e.target.checked ? apply(true) : setConfirmDisable(true))}
              />
            )}
            label="Exiger l’acceptation des CGV sur le site"
          />
          <Typography variant="body2" color="text.secondary">
            {view.requireTermsAcceptance
              ? 'Une demande de réservation sans case cochée, ou acceptée sur une version dépassée, est refusée.'
              : 'Exigence désactivée : les demandes sans acceptation sont créées, sans preuve. À réserver aux urgences.'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {view.lastSeenPluginVersion
              ? `Dernière demande reçue du plugin WordPress ${view.lastSeenPluginVersion}.`
              : 'Version du plugin WordPress : pas encore vue sur une demande.'}
          </Typography>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        onConfirm={() => apply(false)}
        title="Désactiver l’exigence ?"
        message="Les demandes de réservation seront acceptées même sans case cochée, et sans preuve d’acceptation. Réservez ce réglage aux urgences."
        confirmLabel="Désactiver"
      />
    </>
  );
}

export default function OnlineBookingCard({ placement, currentVersion = null }) {
  const { view, failed, reload, setEnforcement } = useOnlineBooking(currentVersion);
  if (failed && placement !== 'alerts') return <ErrorAlert message="Réservation en ligne : état illisible." onRetry={reload} />;
  if (!view) return null;
  if (placement === 'alerts') return <OnlineBookingAlerts view={view} />;
  return <OnlineBookingSwitchCard view={view} setEnforcement={setEnforcement} />;
}
