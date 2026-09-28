// Built-in plugin catalogue (specs/plugins-phase-0-foundation.md §3.A). The twelve optional features
// the owner arbitrated on 2026-09-28 (specs/plugins-inventory.md §5.3); everything else is core.
// Mirrored client-side in client/src/constants/plugins.js (ids only).

const HOURLY_RESOURCES = 'hourly-resources';
const LINEN = 'linen';
const WEBSITE_BOOKING = 'website-booking';
const GATE_ACCESS = 'gate-access';
const NEAT = 'neat';
const ONLINE_PAYMENT = 'online-payment';
const GOOGLE_CALENDAR = 'google-calendar';
const ACCOUNTING_EXPORT = 'accounting-export';
const SAS = 'sas';
const TARIFF_RECIPES = 'tariff-recipes';
const SCHOOL_HOLIDAYS = 'school-holidays';
const WEATHER_ALERTS = 'weather-alerts';

const PLUGIN_CATALOG = Object.freeze([
  {
    id: HOURLY_RESOURCES,
    name: 'Ressources à l’heure',
    description: 'Louer un équipement par créneau : bain nordique, sauna.',
    icon: 'hot-tub',
    surfaces: ['Calendrier › Ressources', 'Le sélecteur de séances de la fiche', 'L’allumage et les séances du planning', 'L’étape « créneaux » du sas', 'Le type de prix « à l’heure »'],
  },
  {
    id: LINEN,
    name: 'Linge et blanchisserie',
    description: 'Stock de linge, tournées de blanchisserie, lits à préparer.',
    icon: 'laundry',
    surfaces: ['Paramètres › Linge', 'L’alerte de manque de linge', 'Les cartes et le bouton blanchisserie du planning', 'Les étapes linge du sas'],
  },
  {
    id: WEBSITE_BOOKING,
    name: 'Réservation depuis le site',
    description: 'Le moteur de réservation de ton site WordPress.',
    icon: 'language',
    surfaces: ['L’alerte « Demandes du site »', 'Le badge et le filtre « Site internet » des devis', 'La ligne d’acceptation des CGV de la fiche', 'L’API publique appelée par le site'],
  },
  {
    id: GATE_ACCESS,
    name: 'Accès au portail (Sowel)',
    description: 'Codes et clés du portail envoyés à Sowel.',
    icon: 'key',
    surfaces: ['Intégrations › Accès portail', 'Le champ « Code portail »', 'L’alerte des clés du portail', 'La carte portail de la fiche', 'L’étape portail du sas'],
  },
  {
    id: NEAT,
    name: 'Assurance annulation Neat',
    description: 'Souscription automatique de l’assurance annulation.',
    icon: 'umbrella',
    surfaces: ['Intégrations › Neat', 'La puce Neat et ses actions sur la ligne d’assurance'],
  },
  {
    id: ONLINE_PAYMENT,
    name: 'Paiement en ligne (Qonto)',
    description: 'Liens de paiement envoyés aux voyageurs.',
    icon: 'payments',
    surfaces: ['Paramètres › Paiements en ligne', 'Les boutons « Envoyer la demande de paiement / de solde »'],
  },
  {
    id: GOOGLE_CALENDAR,
    name: 'Google Agenda',
    description: 'Copie les séjours dans un agenda Google.',
    icon: 'event',
    surfaces: ['Intégrations › Google Agenda'],
  },
  {
    id: ACCOUNTING_EXPORT,
    name: 'Export comptable',
    description: 'Écritures, plan comptable et export pour ton comptable.',
    icon: 'book',
    surfaces: ['Suivi financier › Comptabilité et Plateformes comptables', 'Le rôle « Comptable »'],
  },
  {
    id: SAS,
    name: 'Arrivée et départ guidés',
    description: 'Le sas pas à pas de l’accueil, objets trouvés, liste de départ.',
    icon: 'door',
    surfaces: ['Le bouton sas des cartes du planning', 'L’onglet « Facturables au SAS »', 'La carte objets trouvés', 'Le rôle « Accueil » et son écran d’accueil'],
  },
  {
    id: TARIFF_RECIPES,
    name: 'Recettes tarifaires',
    description: 'Génère les saisons et les prix à partir d’une recette.',
    icon: 'trending-up',
    surfaces: ['Paramètres › Recettes tarifaires', 'L’alerte des exécutions', 'La carte recette du logement'],
  },
  {
    id: SCHOOL_HOLIDAYS,
    name: 'Vacances scolaires',
    description: 'Zones A, B, C récupérées sur education.gouv.fr.',
    icon: 'school',
    surfaces: ['L’onglet Vacances scolaires', 'Les bandes de zones du calendrier'],
  },
  {
    id: WEATHER_ALERTS,
    name: 'Vigilance Météo-France',
    description: 'Prévient le voyageur d’une alerte météo à l’arrivée.',
    icon: 'thunderstorm',
    surfaces: ['Intégrations › Météo', 'L’étape météo du sas'],
  },
].map((p) => Object.freeze({ ...p, surfaces: Object.freeze(p.surfaces), requires: Object.freeze([]) })));

const PLUGIN_IDS = Object.freeze(PLUGIN_CATALOG.map((p) => p.id));

function findPlugin(id) {
  return PLUGIN_CATALOG.find((p) => p.id === id) || null;
}

module.exports = {
  HOURLY_RESOURCES,
  LINEN,
  WEBSITE_BOOKING,
  GATE_ACCESS,
  NEAT,
  ONLINE_PAYMENT,
  GOOGLE_CALENDAR,
  ACCOUNTING_EXPORT,
  SAS,
  TARIFF_RECIPES,
  SCHOOL_HOLIDAYS,
  WEATHER_ALERTS,
  PLUGIN_CATALOG,
  PLUGIN_IDS,
  findPlugin,
};
