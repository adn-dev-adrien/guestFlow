// Arrivée et départ guidés (SAS) — client module (specs/plugins-phase-2-hosts.md §3.C).
import { lazy } from 'react';

export default {
  id: 'sas',
  contributes: {
    // Rule 9 — the core renders <Slot name="sas.dialog" … /> where it used to render the dialog.
    'sas.dialog': [{ key: 'dialog', Component: lazy(() => import('./ReservationSasDialog')) }],
    // Rule 8 — the « Facturables au SAS » tab of Options & ressources, after the two core tabs.
    'optionsResources.tabs': [{
      key: 'sas', value: 'sas', label: 'Facturables au SAS', order: 30, Component: lazy(() => import('./BillableAmountsTab')),
    }],
    // The gate code handed out at arrival, in Paramètres › Établissement, and the word that finds it
    // there (specs/platform-settings-relay-and-review.md rule 11).
    'settings.etablissement': [{ key: 'portal-code', order: 10, Component: lazy(() => import('./SettingsPortalCodeField')) }],
    'settings.keywords': [{ key: 'portal-code', path: '/settings/etablissement', keywords: ['Code portail'] }],
  },
};
