/**
 * Copy of the guest email sequence (specs/guest-email-sequence.md §6.1) — FR source of truth, EN
 * translation. Every conditional paragraph is composed server-side by utils/stayContentContext.js:
 * the renderer has no nesting, so a template only places `{{#if hasX}}{{x}}{{/if}}` blocks.
 *
 * Neutral copy (specs/plugins-phase-p-productisation.md rule 13): no place, product or facility the
 * product cannot know of. The house speaks as {{companyName}}; the rest is the operator's to write.
 * A stored template is never overwritten by this file.
 */

const lines = (...l) => l.join('\n');

// ---------------------------------------------------------------- 1. Confirmation

// specs/terms-acceptance-record.md rule 27 — the CGV of the stay, pinned to the version the guest
// accepted (the current one for a booking taken by phone). The whole paragraph disappears while no
// version is published. Exported: utils/migrateConfirmationCgvLink.js inserts the same paragraph into
// stored templates.
const CGV_SENTENCE_FR = 'Vous retrouverez à tout moment les conditions générales de votre séjour ici : {{cgvUrl}}';
const CGV_SENTENCE_EN = 'You can find the terms and conditions of your stay here at any time: {{cgvUrl}}';
const cgvParagraph = (sentence) => `{{#if hasCgvUrl}}${sentence}\n\n{{/if}}`;

const CONFIRMATION_SUBJECT = 'Votre séjour {{propertyWithArticle}} est confirmé';
const CONFIRMATION_SUBJECT_EN = 'Your stay at {{propertyWithArticle}} is confirmed';

const CONFIRMATION_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Merci pour votre confiance. Votre séjour {{propertyWithArticle}} est confirmé : nous vous attendons le {{arrivalDateLabel}}.',
  '',
  'Votre séjour :',
  '{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}',
  '{{/if}}- Logement : {{propertyName}}',
  '- Voyageurs : {{guestCount}}',
  '- Arrivée : le {{arrivalDateLabel}} à partir de {{checkInLabel}}',
  '- Départ : le {{departureDateLabel}} avant {{checkOutLabel}}',
  '{{#if hasReservedOptionsLabel}}- Option(s) réservée(s) : {{reservedOptionsLabel}}',
  '{{/if}}- Montant du séjour : {{finalPrice}}',
  '{{#if hasBedsMade}}- Les lits faits à votre arrivée',
  '{{/if}}{{#if hasTowelsIncluded}}- Le linge de toilette fourni',
  '{{/if}}',
  `${cgvParagraph(CGV_SENTENCE_FR)}Une question d'ici là ? Répondez simplement à ce mail, ou appelez-nous au {{companyPhone}}.`,
  '',
  'À très bientôt,',
  '{{senderName}}',
);

const CONFIRMATION_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'Thank you for your trust. Your stay at {{propertyWithArticle}} is confirmed: we look forward to welcoming you on {{arrivalDateLabel}}.',
  '',
  'Your stay:',
  '{{#if hasReservationNumber}}- Reservation no.: {{reservationNumber}}',
  '{{/if}}- Accommodation: {{propertyName}}',
  '- Guests: {{guestCount}}',
  '- Arrival: {{arrivalDateLabel}} from {{checkInLabel}}',
  '- Departure: {{departureDateLabel}} before {{checkOutLabel}}',
  '{{#if hasReservedOptionsLabel}}- Option(s) booked: {{reservedOptionsLabel}}',
  '{{/if}}- Stay amount: {{finalPrice}}',
  '{{#if hasBedsMade}}- Beds made up for your arrival',
  '{{/if}}{{#if hasTowelsIncluded}}- Bath linen provided',
  '{{/if}}',
  `${cgvParagraph(CGV_SENTENCE_EN)}Any question until then? Simply reply to this email, or call us on {{companyPhone}}.`,
  '',
  'See you very soon,',
  '{{senderName}}',
);

// ---------------------------------------------------------------- 2. J-7

const J7_SUBJECT = 'Plus qu\'une semaine avant {{propertyName}}';
const J7_SUBJECT_EN = 'One week to go before {{propertyName}}';

const J7_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Plus qu\'une semaine, et vous serez {{propertyWithArticle}}.{{#if hasPropertyHook}} {{propertyHook}}{{/if}}',
  '',
  'Voici quelques mots pour vous aider à préparer votre séjour.',
  '',
  '{{#if hasBedsParagraph}}{{bedsParagraph}}',
  '',
  '{{/if}}{{#if hasBabyParagraph}}{{babyParagraph}}',
  '',
  '{{/if}}{{#if hasBagList}}Dans vos bagages :',
  '{{bagList}}',
  '',
  '{{/if}}{{#if hasTravelLight}}{{travelLightParagraph}}',
  '',
  '{{/if}}{{#if hasWifiParagraph}}{{wifiParagraph}}',
  '',
  '{{/if}}{{#if hasLocalProducts}}{{localProductsParagraph}}',
  '',
  '{{/if}}{{#if hasKidsParagraph}}{{kidsParagraph}}',
  '',
  '{{/if}}Une question ? Répondez simplement à ce mail, ou appelez-nous au {{companyPhone}}.',
  '',
  'À la semaine prochaine,',
  '{{senderName}}',
);

const J7_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'One more week, and you will be at {{propertyWithArticle}}.{{#if hasPropertyHook}} {{propertyHook}}{{/if}}',
  '',
  'Here are a few words to help you get ready.',
  '',
  '{{#if hasBedsParagraph}}{{bedsParagraph}}',
  '',
  '{{/if}}{{#if hasBabyParagraph}}{{babyParagraph}}',
  '',
  '{{/if}}{{#if hasBagList}}In your bags:',
  '{{bagList}}',
  '',
  '{{/if}}{{#if hasTravelLight}}{{travelLightParagraph}}',
  '',
  '{{/if}}{{#if hasWifiParagraph}}{{wifiParagraph}}',
  '',
  '{{/if}}{{#if hasLocalProducts}}{{localProductsParagraph}}',
  '',
  '{{/if}}{{#if hasKidsParagraph}}{{kidsParagraph}}',
  '',
  '{{/if}}Any question? Simply reply to this email, or call us on {{companyPhone}}.',
  '',
  'See you next week,',
  '{{senderName}}',
);

// ---------------------------------------------------------------- 3. J-2

const J2_SUBJECT = 'À {{arrivalWeekday}}, {{propertyWithArticle}}';
const J2_SUBJECT_EN = 'See you on {{arrivalWeekday}} at {{propertyWithArticle}}';

const J2_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Dans deux jours, vous serez {{propertyWithArticle}}. Voici l\'essentiel pour votre arrivée.',
  '',
  'Votre arrivée',
  '- Le {{arrivalDateLabel}}, à partir de {{checkInLabel}}.',
  '- Pouvez-vous nous dire vers quelle heure vous pensez arriver ? Un simple mot en réponse à ce mail suffit.',
  '{{#if hasParkingLine}}{{parkingLine}}',
  '{{/if}}{{#if cautionNotReceived}}- Pensez à prendre la caution de {{cautionAmount}}, demandée à l\'arrivée.',
  '{{/if}}{{#if hasComplementLine}}- {{complementLine}}',
  '{{/if}}',
  '{{#if hasBookedOptionsParagraph}}{{bookedOptionsParagraph}}',
  '',
  '{{/if}}{{#if hasCoffeeParagraph}}{{coffeeParagraph}}',
  '',
  '{{/if}}Le jour du départ, le {{departureDateLabel}}, le logement est à libérer avant {{checkOutLabel}}.',
  '{{#if hasCleaningParagraph}}{{cleaningParagraph}}',
  '{{/if}}',
  'Un imprévu ou un retard sur la route ? Appelez-nous au {{companyPhone}}.',
  '',
  'Bonne route,',
  '{{senderName}}',
);

const J2_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'In two days, you will be at {{propertyWithArticle}}. Here are the essentials for your arrival.',
  '',
  'Your arrival',
  '- On {{arrivalDateLabel}}, from {{checkInLabel}}.',
  '- Could you tell us roughly when you expect to arrive? A simple reply to this email is enough.',
  '{{#if hasParkingLine}}{{parkingLine}}',
  '{{/if}}{{#if cautionNotReceived}}- Please bring the security deposit of {{cautionAmount}}, asked for on arrival.',
  '{{/if}}{{#if hasComplementLine}}- {{complementLine}}',
  '{{/if}}',
  '{{#if hasBookedOptionsParagraph}}{{bookedOptionsParagraph}}',
  '',
  '{{/if}}{{#if hasCoffeeParagraph}}{{coffeeParagraph}}',
  '',
  '{{/if}}On the day you leave, {{departureDateLabel}}, the accommodation is to be vacated before {{checkOutLabel}}.',
  '{{#if hasCleaningParagraph}}{{cleaningParagraph}}',
  '{{/if}}',
  'Something unexpected, running late on the road? Call us on {{companyPhone}}.',
  '',
  'Safe travels,',
  '{{senderName}}',
);

// ---------------------------------------------------------------- 4. J+1

const J1_SUBJECT = 'Merci pour votre séjour {{propertyWithArticle}}';
const J1_SUBJECT_EN = 'Thank you for your stay at {{propertyWithArticle}}';

const J1_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Merci d\'avoir séjourné chez nous. {{quietSinceDeparture}}',
  '',
  '{{#if hasReviewParagraph}}{{reviewParagraph}}',
  '',
  '{{/if}}Si quelque chose a manqué à votre séjour, même un détail, il suffit de répondre à ce mail : nous aimerions le savoir.',
  '',
  '{{#if hasInstagram}}{{instagramParagraph}}',
  '',
  '{{/if}}Au plaisir de vous accueillir à nouveau,',
  '{{senderName}}',
);

const J1_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'Thank you for staying with us. {{quietSinceDeparture}}',
  '',
  '{{#if hasReviewParagraph}}{{reviewParagraph}}',
  '',
  '{{/if}}If anything was missing during your stay, even a detail, just reply to this email: we would like to know.',
  '',
  '{{#if hasInstagram}}{{instagramParagraph}}',
  '',
  '{{/if}}We look forward to welcoming you again,',
  '{{senderName}}',
);

// ---------------------------------------------------------------- 5. Gift vouchers (15 November)

const NOVEMBER_SUBJECT = 'Offrir un séjour, {{companyName}}';
const NOVEMBER_SUBJECT_EN = 'Give a stay, {{companyName}}';

const NOVEMBER_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Les fêtes approchent. Une fois par an, et sans insister, voici notre idée de cadeau : quelques jours de calme.',
  '',
  'Nos bons cadeau sont valables un an : {{giftVoucherOffer}}, ou simplement un montant. Commandé avant le {{giftDeadlineLabel}}, le vôtre arrivera à temps pour les fêtes.',
  '',
  'Belle fin d\'année,',
  '{{senderName}}',
  '{{#if hasUnsubscribeUrl}}',
  'Ne plus recevoir nos nouvelles : {{unsubscribeUrl}}{{/if}}',
);

const NOVEMBER_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'The holidays are coming. Once a year, and without insisting, here is our gift idea: a few days of calm.',
  '',
  'Our gift vouchers are valid for one year: {{giftVoucherOffer}}, or simply an amount. Ordered before {{giftDeadlineLabel}}, yours will arrive in time for the holidays.',
  '',
  'Have a lovely end of the year,',
  '{{senderName}}',
  '{{#if hasUnsubscribeUrl}}',
  'No longer receive our news: {{unsubscribeUrl}}{{/if}}',
);

// ---------------------------------------------------------------- 6. New-year greetings (6 January)

const JANUARY_SUBJECT = 'Belle année {{seasonYear}}, {{companyName}}';
const JANUARY_SUBJECT_EN = 'Happy {{seasonYear}}, {{companyName}}';

const JANUARY_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Nous vous souhaitons une très belle année {{seasonYear}}, douce, lumineuse et pleine de moments partagés.',
  '',
  'Le calendrier {{seasonYear}} est ouvert. Vous étiez venus {{lastStayLabel}} : si une période vous fait envie, écrivez-nous simplement.',
  '',
  'À très bientôt, peut-être,',
  '{{senderName}}',
  '{{#if hasUnsubscribeUrl}}',
  'Ne plus recevoir nos nouvelles : {{unsubscribeUrl}}{{/if}}',
);

const JANUARY_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'We wish you a very happy {{seasonYear}}, gentle, bright and full of shared moments.',
  '',
  'The {{seasonYear}} calendar is open. You stayed {{lastStayLabel}}: if a period tempts you, just write to us.',
  '',
  'See you soon, perhaps,',
  '{{senderName}}',
  '{{#if hasUnsubscribeUrl}}',
  'No longer receive our news: {{unsubscribeUrl}}{{/if}}',
);

module.exports = {
  CGV_SENTENCE_FR, CGV_SENTENCE_EN, cgvParagraph,
  CONFIRMATION_SUBJECT, CONFIRMATION_SUBJECT_EN, CONFIRMATION_BODY, CONFIRMATION_BODY_EN,
  J7_SUBJECT, J7_SUBJECT_EN, J7_BODY, J7_BODY_EN,
  J2_SUBJECT, J2_SUBJECT_EN, J2_BODY, J2_BODY_EN,
  J1_SUBJECT, J1_SUBJECT_EN, J1_BODY, J1_BODY_EN,
  NOVEMBER_SUBJECT, NOVEMBER_SUBJECT_EN, NOVEMBER_BODY, NOVEMBER_BODY_EN,
  JANUARY_SUBJECT, JANUARY_SUBJECT_EN, JANUARY_BODY, JANUARY_BODY_EN,
};
