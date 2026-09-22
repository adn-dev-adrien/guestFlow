/**
 * Copy of the guest email sequence (specs/guest-email-sequence.md §6.1) — FR source of truth, EN
 * translation. Every conditional paragraph is composed server-side by utils/stayContentContext.js:
 * the renderer has no nesting, so a template only places `{{#if hasX}}{{x}}{{/if}}` blocks.
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
  'Merci pour votre confiance. Votre séjour {{propertyWithArticle}} est confirmé : nous vous attendons le {{arrivalDateLabel}}, et nous nous réjouissons déjà de vous accueillir au domaine.',
  '',
  '{{#if isLastMinute}}Vous arrivez très bientôt, alors voici dès maintenant l\'essentiel :',
  '- Tapez « Domaine Solio » dans votre GPS (215 côte de Japperenard, 07290 Satillieu), ou retrouvez le plan d\'accès sur notre site : https://domainesolio.com/contact/',
  '- Nous vous accueillons au bâtiment d\'accueil, près de la piscine, à partir de {{checkInLabel}}',
  '- Pensez aux maillots de bain et aux serviettes pour profiter du bain nordique',
  '',
  '{{/if}}Votre séjour :',
  '{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}',
  '{{/if}}- Logement : {{propertyName}}',
  '- Voyageurs : {{guestCount}}',
  '- Arrivée : le {{arrivalDateLabel}} à partir de {{checkInLabel}}',
  '- Départ : le {{departureDateLabel}} avant {{checkOutLabel}}',
  '{{#if hasReservedOptionsLabel}}- Option(s) réservée(s) : {{reservedOptionsLabel}}',
  '{{/if}}- Montant du séjour : {{finalPrice}}',
  '',
  'Ce qui vous attend sur place :',
  '{{#if hasBedsMade}}- Les lits faits à votre arrivée',
  '{{/if}}{{#if hasTowelsIncluded}}- Le linge de toilette',
  '{{/if}}{{#if hasBathIncluded}}- {{bathIncluded}} de bain nordique privatif',
  '{{/if}}- Les 13 hectares du domaine, le sentier de balade et les animaux, en toute liberté',
  '{{#if stayOverlapsPool}}- La piscine, partagée avec l\'autre hébergement du domaine',
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
  '{{#if isLastMinute}}You are arriving very soon, so here are the essentials right away:',
  '- Enter « Domaine Solio » in your GPS (215 côte de Japperenard, 07290 Satillieu), or find the access map on our website: https://domainesolio.com/contact/',
  '- We welcome you at the reception building, next to the pool, from {{checkInLabel}}',
  '- Remember swimsuits and towels to enjoy the nordic bath',
  '',
  '{{/if}}Your stay:',
  '{{#if hasReservationNumber}}- Reservation no.: {{reservationNumber}}',
  '{{/if}}- Accommodation: {{propertyName}}',
  '- Guests: {{guestCount}}',
  '- Arrival: {{arrivalDateLabel}} from {{checkInLabel}}',
  '- Departure: {{departureDateLabel}} before {{checkOutLabel}}',
  '{{#if hasReservedOptionsLabel}}- Option(s) booked: {{reservedOptionsLabel}}',
  '{{/if}}- Stay amount: {{finalPrice}}',
  '',
  'What awaits you on site:',
  '{{#if hasBedsMade}}- Beds made up for your arrival',
  '{{/if}}{{#if hasTowelsIncluded}}- Bath linen',
  '{{/if}}{{#if hasBathIncluded}}- {{bathIncluded}} of private nordic bath',
  '{{/if}}- The 13 hectares of the domain, the walking trail and the animals, freely',
  '{{#if stayOverlapsPool}}- The pool, shared with the other accommodation of the domain',
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
  'Voici quelques mots pour vous aider à préparer vos valises tranquillement.',
  '',
  '{{#if hasBedsParagraph}}{{bedsParagraph}}',
  '',
  '{{/if}}{{#if hasBabyParagraph}}{{babyParagraph}}',
  '',
  '{{/if}}Dans vos bagages :',
  '{{bagList}}',
  '',
  '{{#if hasTravelLight}}{{travelLightParagraph}}',
  '',
  '{{/if}}{{#if hasWifiParagraph}}{{wifiParagraph}}',
  '',
  '{{/if}}{{#if hasLocalProducts}}{{localProductsParagraph}}',
  '',
  '{{/if}}Vous fêtez un événement, vous aimeriez un coup de main pour les préparatifs, ou simplement vous alléger de l\'intendance ? N\'hésitez pas à nous en parler : nous avons plusieurs formules à vous proposer.',
  '',
  'Pour commencer à rêver votre séjour, nous avons rassemblé nos adresses préférées autour du domaine : balades, baignades, marchés, villages, visites. Tout est sur https://map.domainesolio.com',
  '{{#if hasKidsParagraph}}{{kidsParagraph}}',
  '{{/if}}',
  'Nous préparons tout pour vous accueillir. Une question ? Répondez simplement à ce mail, ou appelez-nous au {{companyPhone}}.',
  '',
  'À la semaine prochaine,',
  '{{senderName}}',
);

const J7_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'One more week, and you will be at {{propertyWithArticle}}.{{#if hasPropertyHook}} {{propertyHook}}{{/if}}',
  '',
  'Here are a few words to help you pack at your own pace.',
  '',
  '{{#if hasBedsParagraph}}{{bedsParagraph}}',
  '',
  '{{/if}}{{#if hasBabyParagraph}}{{babyParagraph}}',
  '',
  '{{/if}}In your bags:',
  '{{bagList}}',
  '',
  '{{#if hasTravelLight}}{{travelLightParagraph}}',
  '',
  '{{/if}}{{#if hasWifiParagraph}}{{wifiParagraph}}',
  '',
  '{{/if}}{{#if hasLocalProducts}}{{localProductsParagraph}}',
  '',
  '{{/if}}Celebrating something, would you like a hand with the preparations, or simply to be spared the chores? Do tell us: we have several options to offer.',
  '',
  'To start dreaming about your stay, we have gathered our favourite places around the domain: walks, swimming spots, markets, villages, visits. It is all on https://map.domainesolio.com',
  '{{#if hasKidsParagraph}}{{kidsParagraph}}',
  '{{/if}}',
  'We are getting everything ready for you. Any question? Simply reply to this email, or call us on {{companyPhone}}.',
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
  'Dans deux jours, vous poserez vos valises {{propertyWithArticle}}. De notre côté, nous finissons de tout préparer pour vous accueillir. Voici simplement l\'essentiel pour venir jusqu\'à nous, le reste se découvrira sur place.',
  '',
  'Pour venir',
  '- Tapez « Domaine Solio » dans votre GPS (215 côte de Japperenard, 07290 Satillieu), ou retrouvez le plan d\'accès sur notre site : https://domainesolio.com/contact/',
  '- Les 400 derniers mètres suivent le chemin du domaine : roulez doucement, il arrive qu\'un animal traverse.',
  '{{#if hasParkingLine}}{{parkingLine}}',
  '{{/if}}',
  'Votre arrivée',
  '- Le {{arrivalDateLabel}}, à partir de {{checkInLabel}}. Nous vous accueillons au bâtiment d\'accueil, près de la piscine.',
  '- Pouvez-vous nous dire vers quelle heure vous pensez arriver ? Un simple mot en réponse à ce mail, et nous serons là pour vous recevoir.',
  '{{#if cautionNotReceived}}- Pensez à prendre le chèque de caution de {{cautionAmount}}, que nous vous demanderons à l\'arrivée.',
  '{{/if}}{{#if hasComplementLine}}- {{complementLine}}',
  '{{/if}}',
  '{{#if hasBookedOptionsParagraph}}{{bookedOptionsParagraph}}',
  '',
  '{{/if}}{{coffeeParagraph}}',
  '{{#if stayOverlapsPool}}La piscine vous attend aussi pour les après-midi ensoleillés.',
  '{{/if}}',
  'Le jour du départ, le {{departureDateLabel}}, nous vous retrouverons à l\'accueil avant {{checkOutLabel}} pour récupérer les clés et vous dire au revoir.',
  '{{cleaningParagraph}}',
  '',
  'Un imprévu ou un retard sur la route ? Appelez-nous au {{companyPhone}}.',
  '',
  'Bonne route, nous avons hâte de vous accueillir,',
  '{{senderName}}',
);

const J2_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'In two days, you will be putting your bags down at {{propertyWithArticle}}. We are finishing getting everything ready for you. Here are simply the essentials to find your way to us; the rest you will discover on site.',
  '',
  'Getting here',
  '- Enter « Domaine Solio » in your GPS (215 côte de Japperenard, 07290 Satillieu), or find the access map on our website: https://domainesolio.com/contact/',
  '- The last 400 metres follow the domain\'s track: drive slowly, an animal may cross.',
  '{{#if hasParkingLine}}{{parkingLine}}',
  '{{/if}}',
  'Your arrival',
  '- On {{arrivalDateLabel}}, from {{checkInLabel}}. We welcome you at the reception building, next to the pool.',
  '- Could you tell us roughly when you expect to arrive? A simple reply to this email, and we will be there to greet you.',
  '{{#if cautionNotReceived}}- Please bring the security deposit cheque of {{cautionAmount}}, which we will ask for on arrival.',
  '{{/if}}{{#if hasComplementLine}}- {{complementLine}}',
  '{{/if}}',
  '{{#if hasBookedOptionsParagraph}}{{bookedOptionsParagraph}}',
  '',
  '{{/if}}{{coffeeParagraph}}',
  '{{#if stayOverlapsPool}}The pool is also waiting for you on sunny afternoons.',
  '{{/if}}',
  'On the day you leave, {{departureDateLabel}}, we will meet you at reception before {{checkOutLabel}} to collect the keys and say goodbye.',
  '{{cleaningParagraph}}',
  '',
  'Something unexpected, running late on the road? Call us on {{companyPhone}}.',
  '',
  'Safe travels, we can\'t wait to welcome you,',
  '{{senderName}}',
);

// ---------------------------------------------------------------- 4. J+1

const J1_SUBJECT = 'Merci pour ces jours au Domaine Solio';
const J1_SUBJECT_EN = 'Thank you for your days at Domaine Solio';

const J1_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Merci d\'avoir choisi le Domaine Solio pour ces quelques jours. {{quietSinceDeparture}}',
  '',
  'Nous espérons que vous êtes bien rentrés, avec un peu du calme d\'ici dans vos bagages.',
  '',
  '{{#if hasReviewParagraph}}{{reviewParagraph}}',
  '',
  '{{/if}}Et si quelque chose a manqué à votre séjour, même un détail, nous aimerions vraiment le savoir : il suffit de répondre à ce mail. C\'est ainsi que le domaine s\'améliore, un séjour après l\'autre.',
  '',
  '{{lostItemsParagraph}}',
  '',
  '{{#if hasInstagram}}{{instagramParagraph}}',
  '',
  '{{/if}}Le domaine change de visage à chaque saison : les agneaux au printemps, les longues soirées d\'été, les couleurs de l\'automne, le bain nordique qui fume dans l\'air froid de l\'hiver. Si l\'envie vous prend d\'en découvrir une autre, vous serez toujours les bienvenus.',
  '',
  'Avec toute notre amitié,',
  '{{senderName}}',
);

const J1_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'Thank you for choosing Domaine Solio for these few days. {{quietSinceDeparture}}',
  '',
  'We hope you got home safely, with a little of the calm from here in your bags.',
  '',
  '{{#if hasReviewParagraph}}{{reviewParagraph}}',
  '',
  '{{/if}}And if anything was missing during your stay, even a detail, we would really like to know: just reply to this email. That is how the domain gets better, one stay after another.',
  '',
  '{{lostItemsParagraph}}',
  '',
  '{{#if hasInstagram}}{{instagramParagraph}}',
  '',
  '{{/if}}The domain changes with every season: lambs in spring, long summer evenings, the colours of autumn, the nordic bath steaming in the cold winter air. If you ever feel like discovering another one, you will always be welcome.',
  '',
  'With warm regards,',
  '{{senderName}}',
);

// ---------------------------------------------------------------- 5. Gift vouchers (15 November)

const NOVEMBER_SUBJECT = 'Offrir un peu du Domaine Solio';
const NOVEMBER_SUBJECT_EN = 'Give a little of Domaine Solio';

const NOVEMBER_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Ici, l\'automne a pris ses quartiers. Les arbres ont changé de couleur, les premiers feux crépitent à La Granja, et les animaux ont sorti leur manteau d\'hiver.',
  '',
  'C\'est aussi le moment où l\'on commence à chercher ce qui fera plaisir à ceux qu\'on aime. Alors, une fois par an et sans insister, voici notre idée : offrir quelques jours de calme, ici.',
  '',
  'Nos bons cadeau sont valables un an : {{giftVoucherOffer}}, ou simplement un montant, que la personne utilise comme elle le souhaite. Nous les préparons par mail ou imprimés, prêts à glisser sous le sapin.',
  '',
  'Et pour tout bon cadeau commandé avant le {{giftDeadlineLabel}}, nous offrirons à la personne qui le reçoit une planche du terroir pour son premier apéritif au domaine.',
  '',
  'Belle fin d\'automne,',
  '{{senderName}}',
  '{{#if hasUnsubscribeUrl}}',
  'Ne plus recevoir nos nouvelles : {{unsubscribeUrl}}{{/if}}',
);

const NOVEMBER_BODY_EN = lines(
  'Hello {{clientFirstName}},',
  '',
  'Autumn has settled in here. The trees have changed colour, the first fires are crackling at La Granja, and the animals have put on their winter coats.',
  '',
  'It is also the time when we start looking for what will please the people we love. So, once a year and without insisting, here is our idea: to give a few days of calm, here.',
  '',
  'Our gift vouchers are valid for one year: {{giftVoucherOffer}}, or simply an amount, to be used however the person wishes. We prepare them by email or printed, ready to slip under the tree.',
  '',
  'And for any gift voucher ordered before {{giftDeadlineLabel}}, we will offer the person who receives it a local platter for their first apéritif at the domain.',
  '',
  'Have a lovely end of autumn,',
  '{{senderName}}',
  '{{#if hasUnsubscribeUrl}}',
  'No longer receive our news: {{unsubscribeUrl}}{{/if}}',
);

// ---------------------------------------------------------------- 6. New-year greetings (6 January)

const JANUARY_SUBJECT = 'Belle année {{seasonYear}}, depuis le Domaine Solio';
const JANUARY_SUBJECT_EN = 'Happy {{seasonYear}} from Domaine Solio';

const JANUARY_BODY = lines(
  'Bonjour {{clientFirstName}},',
  '',
  'Nous vous souhaitons une très belle année {{seasonYear}}, douce, lumineuse, et pleine de moments partagés.',
  '',
  'Ici, l\'hiver a posé son silence sur les 13 hectares : le feu crépite à La Granja, le bain nordique fume dans l\'air froid, et chaque matin les animaux attendent leur foin.',
  '',
  'Le calendrier {{seasonYear}} est ouvert, ponts de printemps compris. Vous étiez venus {{lastStayLabel}} : si une période vous fait envie, écrivez-nous simplement. Les week-ends prolongés partent vite, et nous serions tellement heureux de vous retrouver.',
  '',
  'Et pour vous remercier de votre fidélité : si vous réservez avant le {{giftDeadlineLabel}}, le petit-déjeuner du premier matin vous sera offert, pour toute la famille.',
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
  'Here, winter has laid its silence over the 13 hectares: the fire crackles at La Granja, the nordic bath steams in the cold air, and every morning the animals wait for their hay.',
  '',
  'The {{seasonYear}} calendar is open, spring bank holidays included. You stayed {{lastStayLabel}}: if a period tempts you, just write to us. Long weekends go fast, and we would be so happy to see you again.',
  '',
  'And to thank you for your loyalty: if you book before {{giftDeadlineLabel}}, breakfast on the first morning is on us, for the whole family.',
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
