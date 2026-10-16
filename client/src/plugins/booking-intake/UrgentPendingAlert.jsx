/**
 * UrgentPendingAlert — the arrival-within-a-week half of PendingAlert, for the slot
 * `dashboard.alerts.urgent` (specs/booking-extranet-intake.md rule 24).
 */
import React from 'react';
import PendingAlert from './PendingAlert';

export default function UrgentPendingAlert() {
  return <PendingAlert urgent />;
}
