/**
 * The variables and conditions of the guest emails, with their French labels
 * (specs/guest-email-texts-made-simple.md rules 10–11).
 *
 * One catalogue for the whole product: the chips of every editor come from here, per email, and the
 * one validator below refuses an unknown name the same way for a template, a stay text and a mention.
 * Every variable and flag `emailContextBuilder.buildContext` produces has an entry; a test pins it.
 *
 * `in` scopes a name to the emails where it means something (section ids of `SECTIONS`); `null`
 * means every email. A template still validates against the whole catalogue: a name outside its
 * scope renders, it simply gets no chip.
 */

const { unknownToken, structureError, STRUCTURE_MESSAGES } = require('./emailTemplateRenderer');

/**
 * The emails of the single page, in send order (rule 9), and the stored templates of each. Each is
 * named by what it is for, with its « Quand » (rule 44, UI/UX review 2026-10-18 decision 12).
 */
const SECTIONS = Object.freeze([
  { id: 'confirmation', title: 'Confirmation', when: 'Envoyé à la réservation', stableKeys: ['reservation_confirmation'] },
  { id: 'payment', title: 'Demandes de paiement', when: 'Envoyées à la demande et aux échéances', stableKeys: ['deposit_request', 'deposit_reminder', 'full_request', 'balance_request', 'balance_reminder', 'installment_request'] },
  { id: 'j7', title: 'Préparation du séjour', when: 'Envoyé 7 jours avant l’arrivée', stableKeys: ['arrival_reminder_7d'] },
  { id: 'j2', title: 'Accès et arrivée', when: 'Envoyé 2 jours avant l’arrivée', stableKeys: ['arrival_reminder_1d'] },
  { id: 'j1', title: 'Merci et avis', when: 'Envoyé le lendemain du départ', stableKeys: ['guest_thanks_j1'] },
  { id: 'season', title: 'Bons cadeaux, vœux et dates', when: 'Envoyés le 15 novembre et le 6 janvier', stableKeys: ['season_gift_vouchers', 'season_new_year'] },
  { id: 'cancellation', title: 'Avis d’annulation', when: 'Envoyé à l’annulation', stableKeys: ['cancellation_notice'] },
]);

/** The stay-text catalogue's email names (utils/stayTextCatalogue.js MAILS) → section ids. */
const SECTION_OF_MAIL = Object.freeze({ 'J-7': 'j7', 'J-2': 'j2', 'J+1': 'j1', Novembre: 'season' });

function sectionOfStableKey(stableKey) {
  const found = SECTIONS.find((s) => s.stableKeys.includes(stableKey));
  return found ? found.id : null;
}

const STAY = ['confirmation', 'payment', 'j7', 'j2', 'j1', 'cancellation'];

/* eslint-disable max-len */
const VARIABLES = Object.freeze([
  // Voyageur
  { name: 'clientFirstName', label: 'Prénom du voyageur', in: null },
  { name: 'clientLastName', label: 'Nom du voyageur', in: null },
  { name: 'clientFullName', label: 'Nom complet du voyageur', in: null },
  { name: 'clientEmail', label: 'Email du voyageur', in: STAY },
  { name: 'clientPhone', label: 'Téléphone du voyageur', in: STAY },
  { name: 'clientAddress', label: 'Adresse du voyageur', in: STAY },
  // Séjour
  { name: 'propertyName', label: 'Logement', in: null },
  { name: 'propertyWithArticle', label: 'Logement avec article', in: null },
  { name: 'propertyAddress', label: 'Adresse du logement', in: STAY },
  { name: 'reservationNumber', label: 'N° de réservation', in: STAY },
  { name: 'startDate', label: 'Date d’arrivée', in: STAY },
  { name: 'endDate', label: 'Date de départ', in: STAY },
  { name: 'arrivalDateLabel', label: 'Jour d’arrivée', in: STAY },
  { name: 'departureDateLabel', label: 'Jour de départ', in: STAY },
  { name: 'arrivalWeekday', label: 'Jour de la semaine d’arrivée', in: STAY },
  { name: 'checkInTime', label: 'Heure d’arrivée', in: STAY },
  { name: 'checkOutTime', label: 'Heure de départ', in: STAY },
  { name: 'checkInLabel', label: 'Heure d’arrivée (texte)', in: STAY },
  { name: 'checkOutLabel', label: 'Heure de départ (texte)', in: STAY },
  { name: 'nights', label: 'Nuits', in: STAY },
  { name: 'adultsCount', label: 'Adultes', in: STAY },
  { name: 'teensCount', label: 'Adolescents', in: STAY },
  { name: 'childrenCount', label: 'Enfants', in: STAY },
  { name: 'babiesCount', label: 'Bébés', in: STAY },
  { name: 'totalGuests', label: 'Voyageurs (nombre)', in: STAY },
  { name: 'guestCount', label: 'Voyageurs', in: STAY },
  { name: 'bedConfig', label: 'Lits', in: STAY },
  { name: 'optionsList', label: 'Options', in: STAY },
  { name: 'reservedOptionsList', label: 'Options réservées', in: STAY },
  { name: 'reservedOptionsLabel', label: 'Options réservées (texte)', in: STAY },
  { name: 'resourcesList', label: 'Ressources', in: STAY },
  { name: 'nordicBathSchedule', label: 'Créneaux réservés', in: STAY },
  { name: 'nordicBathReminder', label: 'Phrase des ressources réservées', in: STAY },
  { name: 'babyBedNotice', label: 'Phrase lit bébé', in: STAY },
  // Paiement
  { name: 'finalPrice', label: 'Montant du séjour', in: STAY },
  { name: 'depositAmount', label: 'Acompte', in: STAY },
  { name: 'depositDueDate', label: 'Échéance de l’acompte', in: STAY },
  { name: 'balanceAmount', label: 'Solde', in: STAY },
  { name: 'balanceDueDate', label: 'Échéance du solde', in: STAY },
  { name: 'validUntil', label: 'Validité du devis', in: ['payment'] },
  { name: 'cancelOnDate', label: 'Date d’annulation si impayé', in: ['payment', 'cancellation'] },
  { name: 'retainedDepositAmount', label: 'Acompte conservé', in: ['payment', 'cancellation'] },
  { name: 'paymentLink', label: 'Lien de paiement', in: ['payment'] },
  { name: 'paymentLinkValidUntil', label: 'Fin de validité du lien', in: ['payment'] },
  { name: 'paymentAmount', label: 'Montant demandé', in: ['payment'] },
  { name: 'installmentNumber', label: 'N° de l’échéance', in: ['payment'] },
  { name: 'installmentCount', label: 'Nombre d’échéances', in: ['payment'] },
  { name: 'installmentAmount', label: 'Montant de l’échéance', in: ['payment'] },
  { name: 'installmentDueDate', label: 'Date de l’échéance', in: ['payment'] },
  { name: 'installmentSchedule', label: 'Échéancier complet', in: ['payment'] },
  { name: 'cautionAmount', label: 'Caution', in: STAY },
  { name: 'complementAmount', label: 'Complément', in: STAY },
  { name: 'complementNotice', label: 'Détail du complément', in: STAY },
  // Entreprise
  { name: 'companyName', label: 'Entreprise', in: null },
  { name: 'companyPhone', label: 'Téléphone de l’entreprise', in: null },
  { name: 'companyEmail', label: 'Email de l’entreprise', in: null },
  { name: 'senderName', label: 'Nom d’expéditeur', in: null },
  { name: 'cgvUrl', label: 'Lien des CGV', in: ['confirmation', 'payment'] },
  // Paragraphes composés par le serveur
  { name: 'propertyHook', label: 'Accroche du logement', in: ['j7'] },
  { name: 'bathIncluded', label: 'Temps de ressource offert', in: ['j7', 'j2'] },
  { name: 'bedsParagraph', label: 'Paragraphe des lits', in: ['j7'] },
  { name: 'babyParagraph', label: 'Paragraphe lit bébé', in: ['j7'] },
  { name: 'bagList', label: 'Liste « À emporter »', in: ['j7'] },
  { name: 'travelLightParagraph', label: 'Paragraphe parking éloigné', in: ['j7'] },
  { name: 'wifiParagraph', label: 'Paragraphe « pas de wifi »', in: ['j7'] },
  { name: 'localProductsParagraph', label: 'Paragraphe des propositions', in: ['j7'] },
  { name: 'kidsParagraph', label: 'Paragraphe enfants', in: ['j7'] },
  { name: 'parkingLine', label: 'Ligne parking', in: ['j2'] },
  { name: 'addressParagraph', label: 'Adresse et carte', in: ['j2'] },
  { name: 'accessParagraph', label: 'Accès au logement', in: ['j2'] },
  { name: 'arrivalWifiParagraph', label: 'Wi-Fi', in: ['j2'] },
  { name: 'complementLine', label: 'Ligne complément', in: ['j2'] },
  { name: 'bookedOptionsParagraph', label: 'Confirmations des options', in: ['j2'] },
  { name: 'coffeeParagraph', label: 'Paragraphe « Dans le logement »', in: ['j2'] },
  { name: 'cleaningParagraph', label: 'Paragraphe ménage', in: ['j2'] },
  { name: 'reviewParagraph', label: 'Paragraphe avis', in: ['j1'] },
  { name: 'instagramParagraph', label: 'Paragraphe réseaux sociaux', in: ['j1'] },
  { name: 'quietSinceDeparture', label: 'Ouverture du lendemain', in: ['j1'] },
  { name: 'giftVoucherOffer', label: 'Offre de bons cadeaux', in: ['season'] },
  { name: 'giftDeadlineLabel', label: 'Date limite de commande', in: ['season'] },
  { name: 'seasonYear', label: 'Année', in: ['season'] },
  { name: 'lastStayLabel', label: 'Dernier séjour', in: ['season'] },
  { name: 'unsubscribeUrl', label: 'Lien de désabonnement', in: ['season'] },
]);

const FLAGS = Object.freeze([
  { name: 'hasReservationNumber', label: 'Si n° de réservation', in: STAY },
  { name: 'hasCgvUrl', label: 'Si CGV publiées', in: ['confirmation', 'payment'] },
  { name: 'hasCompanyPhone', label: 'Si téléphone de l’entreprise', in: null },
  { name: 'hasRetainedDeposit', label: 'Si acompte conservé', in: ['payment', 'cancellation'] },
  { name: 'hasPaymentLink', label: 'Si lien de paiement', in: ['payment'] },
  { name: 'hasPaymentLinkValidUntil', label: 'Si fin de validité du lien', in: ['payment'] },
  { name: 'hasBedLinenOption', label: 'Si linge de lit', in: STAY },
  { name: 'bedLinenProvidedByDefault', label: 'Si linge fourni par défaut', in: STAY },
  { name: 'bedLinenBringYourOwn', label: 'Si linge à apporter', in: STAY },
  { name: 'hasCleaningOption', label: 'Si ménage', in: STAY },
  { name: 'cautionNotBanked', label: 'Si caution non encaissée', in: STAY },
  { name: 'cautionNotReceived', label: 'Si caution non reçue', in: STAY },
  { name: 'complementToCollect', label: 'Si complément à percevoir', in: STAY },
  { name: 'hasOptions', label: 'Si options', in: STAY },
  { name: 'hasReservedOptions', label: 'Si options réservées', in: STAY },
  { name: 'hasReservedOptionsLabel', label: 'Si options réservées (texte)', in: STAY },
  { name: 'hasResources', label: 'Si ressources', in: STAY },
  { name: 'hasNordicBath', label: 'Si ressource avec phrase', in: STAY },
  { name: 'hasBabyBedNotice', label: 'Si bébé', in: STAY },
  { name: 'hasBedsMade', label: 'Si lits faits', in: STAY },
  { name: 'hasTowelsIncluded', label: 'Si serviettes fournies', in: STAY },
  { name: 'hasBathIncluded', label: 'Si temps de ressource offert', in: ['j7', 'j2'] },
  { name: 'stayOverlapsPool', label: 'Si saison piscine', in: ['j7', 'j2'] },
  { name: 'isLastMinute', label: 'Si dernière minute', in: STAY },
  { name: 'clientHasEmail', label: 'Si email du voyageur', in: null },
  { name: 'hasPropertyHook', label: 'Si accroche', in: ['j7'] },
  { name: 'hasBedsParagraph', label: 'Si paragraphe des lits', in: ['j7'] },
  { name: 'hasBabyParagraph', label: 'Si paragraphe lit bébé', in: ['j7'] },
  { name: 'hasBagList', label: 'Si liste « À emporter »', in: ['j7'] },
  { name: 'hasTravelLight', label: 'Si parking éloigné', in: ['j7'] },
  { name: 'hasWifiParagraph', label: 'Si pas de wifi', in: ['j7'] },
  { name: 'hasLocalProducts', label: 'Si propositions', in: ['j7'] },
  { name: 'hasKidsParagraph', label: 'Si paragraphe enfants', in: ['j7'] },
  { name: 'hasParkingLine', label: 'Si ligne parking', in: ['j2'] },
  { name: 'hasAddressParagraph', label: 'Si adresse', in: ['j2'] },
  { name: 'hasAccessParagraph', label: 'Si accès', in: ['j2'] },
  { name: 'hasArrivalWifiParagraph', label: 'Si Wi-Fi', in: ['j2'] },
  { name: 'hasComplementLine', label: 'Si ligne complément', in: ['j2'] },
  { name: 'hasBookedOptionsParagraph', label: 'Si confirmations', in: ['j2'] },
  { name: 'hasCoffeeParagraph', label: 'Si « Dans le logement »', in: ['j2'] },
  { name: 'hasCleaningParagraph', label: 'Si paragraphe ménage', in: ['j2'] },
  { name: 'hasReviewParagraph', label: 'Si paragraphe avis', in: ['j1'] },
  { name: 'hasInstagram', label: 'Si réseaux sociaux', in: ['j1'] },
  { name: 'hasQuietSinceDeparture', label: 'Si ouverture du lendemain', in: ['j1'] },
  { name: 'hasUnsubscribeUrl', label: 'Si lien de désabonnement', in: ['season'] },
]);

/** Labels of the stay-text and mention tokens (their own, narrower namespace). */
const STAY_TOKEN_LABELS = Object.freeze({
  bedConfig: 'Lits', price: 'Prix', distance: 'Distance (m)', propertyFrom: 'Depuis le logement',
  propertyName: 'Logement', PropertyWith: 'Logement avec article (majuscule)', propertyWith: 'Logement avec article',
  list: 'Liste', date: 'Date', amount: 'Montant', link: 'Lien', platform: 'Plateforme', slots: 'Créneaux',
  address: 'Adresse', mapUrl: 'Lien carte', access: 'Accès', code: 'Code', wifiName: 'Réseau Wi-Fi',
  wifiPassword: 'Mot de passe Wi-Fi',
});
const STAY_FLAG_LABELS = Object.freeze({
  linenOffered: 'Si linge proposé', hasPrice: 'Si prix', stayOverlapsPool: 'Si saison piscine',
  hasGoogleReview: 'Si lien d’avis Google',
});
/* eslint-enable max-len */

/**
 * The template variable through which a sentence reaches an email (specs/guest-email-texts-made-simple.md
 * rule 25): a sentence whose variable no stored template of its email uses never leaves.
 */
const VARIABLE_OF_TEXT = Object.freeze([
  ['beds.', 'bedsParagraph'], ['baby.', 'babyParagraph'], ['bag.', 'bagList'], ['travelLight', 'travelLightParagraph'],
  ['noWifi', 'wifiParagraph'], ['offers.', 'localProductsParagraph'], ['parkingLine', 'parkingLine'], ['house', 'coffeeParagraph'],
  ['cleaning.', 'cleaningParagraph'], ['complement.', 'complementLine'], ['booked.', 'bookedOptionsParagraph'],
  ['review.', 'reviewParagraph'], ['instagram', 'instagramParagraph'], ['quietSinceDeparture', 'quietSinceDeparture'],
  ['gift.', 'giftVoucherOffer'], ['addressParagraph', 'addressParagraph'], ['accessParagraph', 'accessParagraph'],
  ['wifiParagraph', 'arrivalWifiParagraph'],
]);

function variableOfStayText(key) {
  const found = VARIABLE_OF_TEXT.find(([prefix]) => (prefix.endsWith('.') ? key.startsWith(prefix) : key === prefix));
  return found ? found[1] : null;
}

/** Every name the stored templates use, on both language sides. */
function namesUsedBy(templates) {
  const used = new Set();
  for (const t of templates || []) {
    for (const field of ['subject', 'body', 'subjectEn', 'bodyEn']) namesUsed(t[field]).forEach((n) => used.add(n));
  }
  return used;
}

/**
 * The names a text uses outside the blocks guarded by `flag` (one name or several) — `{{companyPhone}}` inside
 * `{{#if hasCompanyPhone}}…{{/if}}` needs no phone (rule 6, 2026-10-17).
 */
function namesUsedOutside(text, flag) {
  const unguarded = [].concat(flag).reduce((out, name) => out.replace(
    new RegExp(`\\{\\{#if\\s+${name}\\s*\\}\\}[\\s\\S]*?\\{\\{/if\\}\\}`, 'g'), '',
  ), String(text || ''));
  return namesUsed(unguarded);
}

const inScope = (entry, section) => !entry.in || !section || entry.in.includes(section);

/** The live and registered plugins' names (specs/plugins-phase-1-sdk.md rule 13). */
function pluginNames() {
  try {
    const registry = require('../plugins/sdk/registry');
    const variables = [];
    const conditions = [];
    registry.all().forEach((record) => record.emailProviders.forEach((p) => {
      const live = registry.isLive(record.id);
      p.tokens.forEach((t) => variables.push({ name: t.name, label: t.label, live }));
      (p.flags || []).forEach((f) => conditions.push({ name: f.name, label: f.label, live }));
    }));
    return { variables, conditions };
  } catch {
    return { variables: [], conditions: [] };
  }
}

/** Every name a template may use: the catalogue and every registered plugin's. */
function templateAllowed() {
  const plugins = pluginNames();
  return {
    tokens: [...VARIABLES.map((v) => v.name), ...plugins.variables.map((v) => v.name)],
    flags: [...FLAGS.map((f) => f.name), ...plugins.conditions.map((f) => f.name)],
  };
}

const NAME_RE = /\{\{\s*(?:#if\s+)?([A-Za-z0-9_]+)\s*\}\}/g;
function namesUsed(text) {
  const out = new Set();
  let m;
  while ((m = NAME_RE.exec(String(text || ''))) !== null) out.add(m[1]);
  return out;
}

/**
 * The chips of one template (rule 10): the names of its email, then any other the stored template
 * already uses, then the live plugins'. `{ variables: [{ name, label }], conditions: [...] }`.
 */
function chipsForTemplate(template) {
  const section = template ? sectionOfStableKey(template.stableKey) : null;
  const used = new Set();
  if (template) {
    for (const field of ['subject', 'body', 'subjectEn', 'bodyEn']) namesUsed(template[field]).forEach((n) => used.add(n));
  }
  const pick = (list) => list.filter((e) => inScope(e, section) || used.has(e.name)).map(({ name, label }) => ({ name, label }));
  const plugins = pluginNames();
  return {
    variables: [...pick(VARIABLES), ...plugins.variables.filter((v) => v.live || used.has(v.name)).map(({ name, label }) => ({ name, label }))],
    conditions: [...pick(FLAGS), ...plugins.conditions.filter((f) => f.live || used.has(f.name)).map(({ name, label }) => ({ name, label }))],
  };
}

/**
 * Chips of a subject line: the variables of every email (guest, property, company), plus any the
 * subject already uses — never the paragraphs or the conditions, which have no place in a subject.
 */
function chipsForSubject(template) {
  const used = new Set([...namesUsed(template && template.subject), ...namesUsed(template && template.subjectEn)]);
  return {
    variables: VARIABLES.filter((v) => !v.in || used.has(v.name)).map(({ name, label }) => ({ name, label })),
    conditions: FLAGS.filter((f) => used.has(f.name)).map(({ name, label }) => ({ name, label })),
  };
}

/** Chips of a stay text or a mention: its own tokens and flags, labelled. */
function chipsForText({ tokens = [], flags = [] } = {}) {
  return {
    variables: tokens.map((name) => ({ name, label: STAY_TOKEN_LABELS[name] || name })),
    conditions: flags.map((name) => ({ name, label: STAY_FLAG_LABELS[name] || name })),
  };
}

/**
 * Rule 26 (2026-10-18) — a known variable inside one pair of braces, « {clientFirstName} »: the
 * renderer leaves it as it is, so the guest would read it. Text in single braces that names no
 * variable stays prose.
 */
function singleBraced(text, { tokens = [], flags = [] } = {}) {
  const known = new Set([...tokens, ...flags, ...VARIABLES.map((v) => v.name), ...FLAGS.map((f) => f.name), ...Object.keys(STAY_TOKEN_LABELS)]);
  const outside = String(text || '').replace(/\{\{[^{}]*\}\}/g, ' ');
  const re = /\{\s*([A-Za-z0-9_]+)\s*\}/g;
  let m;
  while ((m = re.exec(outside)) !== null) if (known.has(m[1])) return true;
  return false;
}

const TAG_CHARACTER_MESSAGE = 'Caractère invisible collé dans le texte : le retirer.';

/**
 * Rule 11 — the one validation of the three editors: a broken variable or condition (rule 26), else
 * the first unknown name of a text, as the 422 body `{ field, message }`, or null.
 */
function tokenError(field, text, allowed) {
  // Rule 26 — a broken variable or condition first: the renderer would print it as it is.
  // Rule 45 — the preview's private tag characters never enter a stored text, so none can be sent.
  if (/[\uE000-\uE002]/.test(String(text || ''))) return { field, message: TAG_CHARACTER_MESSAGE };
  const broken = structureError(text) || (singleBraced(text, allowed) ? 'brace' : null);
  if (broken) return { field, message: STRUCTURE_MESSAGES[broken] };
  const name = unknownToken(text, allowed);
  if (name == null) return null;
  // A known variable used where it means nothing is named by its label (rule 11, 2026-10-17).
  const known = VARIABLES.find((v) => v.name === name) || FLAGS.find((f) => f.name === name);
  const label = known ? known.label : STAY_TOKEN_LABELS[name];
  const message = label ? `Variable non disponible ici : ${label}` : `Variable inconnue : {{${name}}}`;
  // Rule 41 — the closest variable this text may use, offered as a one-tap fix under the field.
  const suggestion = closestVariable(name, allowed);
  return suggestion ? { field, message, unknown: name, suggestion } : { field, message, unknown: name };
}

/** The cap of a stored sentence (email-automation rule 20): past it a text is a paste gone wrong. */
const TEXT_MAX_LENGTH = 20000;

/** → the 422 body `{ field, message }` when `text` is longer than `max`, else null. */
function lengthError(field, text, max = TEXT_MAX_LENGTH) {
  return String(text == null ? '' : text).length > max ? { field, message: `${max} caractères au plus` } : null;
}

const normalised = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length];
}

const labelOfName = (name) => {
  const known = VARIABLES.find((v) => v.name === name);
  return known ? known.label : (STAY_TOKEN_LABELS[name] || name);
};

/**
 * The variable a mistyped name most likely meant, among those the text may use (rule 41), or null.
 * « prenon » → clientFirstName (« Prénom du voyageur »): a name or a label starting with what was
 * typed wins, else the smallest edit distance on the name or the start of the label, within a third
 * of the typed length (two edits at least).
 */
function closestVariable(typed, { tokens = [] } = {}) {
  const word = normalised(typed);
  if (!word) return null;
  let best = null;
  let score = Infinity;
  for (const name of tokens) {
    const label = labelOfName(name);
    const words = normalised(label);
    for (const candidate of [normalised(name), words, normalised(label.split(' ')[0])]) {
      if (!candidate) continue;
      const d = candidate.startsWith(word) ? 0 : distance(word, candidate.slice(0, Math.max(word.length, 3)));
      if (d < score) { score = d; best = { name, label }; }
    }
  }
  return score <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

module.exports = {
  SECTIONS,
  SECTION_OF_MAIL,
  VARIABLES,
  FLAGS,
  STAY_TOKEN_LABELS,
  sectionOfStableKey,
  templateAllowed,
  chipsForTemplate,
  chipsForSubject,
  chipsForText,
  tokenError,
  lengthError,
  TEXT_MAX_LENGTH,
  closestVariable,
  namesUsed,
  namesUsedBy,
  namesUsedOutside,
  variableOfStayText,
};
