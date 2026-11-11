// The Domaine Solio welcome booklet (specs/guest-app.md slice I), validated by Adrien on 2026-11-09 from the review
// board specs/guest-app-livret-planches.html, with every recommended decision and A2 « accueil en personne ».
//
// The shape is the studio's own (specs/guest-app.md §4.3, server/src/plugins/guest-app/bookletBlocks.js): one page
// list for the domain; a page with `only` lives in that lodging alone, the others are created once and shared; a block
// with `only` is restricted to that lodging (`onlyForPropertyIds`). `media` and `item` references are resolved by
// import.mjs (an uploaded photo, the bath sold in the shop).

const t = (fr, en) => ({ fr, en });
const p = (...paragraphs) => paragraphs.map((x) => `<p>${x}</p>`).join('');
const ul = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const head = (title) => `<p><strong>${title}</strong></p>`;

/** A text block: `fr` and `en` are HTML (p, strong, em, ul, ol, li, a). */
const text = (fr, en, only) => ({ type: 'text', data: { html: t(fr, en) }, ...(only ? { only } : {}) });
const callout = (tone, title, body, only) => ({
  type: 'callout', data: { tone, ...(title ? { title } : {}), text: body }, ...(only ? { only } : {}),
});
const steps = (items, only) => ({ type: 'steps', data: { steps: items.map((x) => ({ text: x })) }, ...(only ? { only } : {}) });
const button = (label, target, only) => ({ type: 'button', data: { label, target }, ...(only ? { only } : {}) });
const image = (media, only) => ({ type: 'image', media, ...(only ? { only } : {}) });

export const MEDIA = {
  feu: { file: 'img/feu.jpg', alt: t('Comment allumer facilement son feu de cheminée, en quatre étapes illustrées.', 'How to light the fireplace easily, in four illustrated steps.') },
  'plan-rdc-etage': { file: 'img/plan-rdc-etage.jpg', alt: t('Plan d’évacuation du rez-de-chaussée et du premier étage du gîte.', 'Evacuation plan of the cottage’s ground and first floors.') },
  'plan-grenier': { file: 'img/plan-grenier.jpg', alt: t('Plan d’évacuation de l’espace grenier du gîte.', 'Evacuation plan of the cottage’s attic floor.') },
};

export const LODGINGS = { granja: 'La Granja', estiva: 'L’Estiva' };

export const PAGES = [
  {
    slug: 'bienvenue', icon: 'home', title: t('Bienvenue', 'Welcome'),
    blocks: [
      text(p('Bienvenue au Domaine Solio, un lieu de nature, de calme et de ressourcement. Ici, on ralentit. On observe. On respire.'),
        p('Welcome to the Domaine Solio, a place of nature, calm and renewal. Here, we slow down. We look around. We breathe.')),
      text(p('Merci d’avoir choisi notre gîte. Nous espérons que votre séjour sera synonyme de détente, de plaisir et de beaux souvenirs.'),
        p('Thank you for choosing our cottage. We hope your stay brings rest, pleasure and lovely memories.'), 'granja'),
      text(p('L’Aventura Lodge est une expérience à part : vivre dehors sans rien sacrifier au confort. Eau chaude, électricité, tout est là. Mais le vrai luxe est ailleurs : le calme, la nature, le temps. Laissez le domaine faire le reste.'),
        p('The Aventura Lodge is an experience of its own: living outdoors without giving up comfort. Hot water, electricity, it is all here. But the real luxury lies elsewhere: calm, nature, time. Let the estate do the rest.'), 'estiva'),
      text(p('Ce livret n’est pas là pour aligner des règles. Il vous aide à connaître le domaine, à comprendre comment il vit et à profiter de tout ce qu’il a à offrir.'),
        p('This booklet is not a list of rules. It helps you get to know the estate, understand how it lives, and enjoy everything it has to offer.')),
      callout('info', t('Nous ne sommes jamais très loin', 'We are never far away'),
        t('Une question, un souci, une envie ? Appelez-nous à tout moment : nos numéros sont dans « Contacts », sur l’accueil de l’app.',
          'A question, a problem, a wish? Call us at any time: our numbers are under “Contacts”, on the app’s home screen.')),
      text(p('Bienvenue chez nous… et déjà un peu chez vous.'), p('Welcome to our home… and already a little bit yours.')),
    ],
  },
  {
    slug: 'arrivee', icon: 'gate', title: t('Votre arrivée', 'Your arrival'),
    blocks: [
      text(p('À votre arrivée, on vous accueille en personne : un moment qu’on aime prendre ensemble pour vous remettre les clés, vous montrer l’essentiel et faire le point sur votre séjour.'),
        p('When you arrive, we welcome you in person: a moment we like to share, to hand you the keys, show you the essentials and talk through your stay.')),
      text(p('Une arrivée anticipée ou un départ tardif sont parfois possibles selon les réservations : parlez-nous-en (supplément selon le créneau).'),
        p('An early arrival or a late departure is sometimes possible, depending on bookings: just ask us (a supplement may apply).')),
      text(head('Stationnement') + p('Garez-vous à proximité du portail, sans bloquer les chemins d’accès ni les voies de circulation.'),
        head('Parking') + p('Park near the gate, without blocking the access paths or the driveways.'), 'granja'),
      text(head('Stationnement') + p('Garez-vous près du lodge. Nos animaux vivent en liberté et sont curieux : il arrive qu’une chèvre grimpe sur une voiture. Le stationnement se fait donc à vos risques, et le domaine ne peut être tenu responsable d’éventuelles traces.'),
        head('Parking') + p('Park near the lodge. Our animals roam free and are curious: a goat may climb onto a car. Parking is therefore at your own risk, and the estate cannot be held responsible for any marks.'), 'estiva'),
      callout('warning', t('Le portail ne se referme pas tout seul', 'The gate does not close by itself'),
        t('Refermez-le toujours derrière vous : nos animaux vivent en liberté sur le domaine. Pour l’ouvrir, utilisez la tuile « Portail » de l’app.',
          'Always close it behind you: our animals roam free on the estate. To open it, use the “Gate” tile in the app.')),
      text(head('Avec un bébé') + p('Lit parapluie, chaise haute, protection de cheminée : demandez-les-nous s’ils ne vous ont pas été fournis.'),
        head('With a baby') + p('Travel cot, high chair, fireplace guard: ask us if they have not been provided.'), 'granja'),
      text(head('Avec un bébé') + p('Un lit bébé ou une chaise haute ? Ils se réservent dans la Boutique de l’app.'),
        head('With a baby') + p('A cot or a high chair? Book them in the app’s Shop.'), 'estiva'),
    ],
  },
  {
    slug: 'le-gite', icon: 'home', title: t('Le gîte', 'The cottage'), only: 'granja',
    blocks: [
      text(head('Chauffage') + p('Le chauffage se règle tout seul : inutile d’y toucher, sauf dans la salle de bain du haut. Trop chaud ? Éteignez simplement les radiateurs plutôt que d’ouvrir les fenêtres.'),
        head('Heating') + p('The heating regulates itself: no need to touch it, except in the upstairs bathroom. Too warm? Simply switch the radiators off rather than opening the windows.')),
      text(head('Eau chaude') + p('Le cumulus offre une bonne réserve d’eau chaude, largement suffisante pour un usage normal. Un peu d’attention, et tout le groupe en profite.'),
        head('Hot water') + p('The water heater holds a good supply of hot water, plenty for normal use. A little care, and the whole group enjoys it.')),
      text(head('Télévision') + p('Les téléviseurs des chambres ont un Chromecast et un accès à Amazon Prime. Mais ici, le plus beau des spectacles se joue juste derrière la fenêtre.'),
        head('Television') + p('The bedroom TVs have a Chromecast and Amazon Prime. But here, the finest show is playing right outside the window.')),
      text(head('Barbecue') + p('Un barbecue vous attend sur la terrasse. Merci de le laisser propre après usage.'),
        head('Barbecue') + p('A barbecue awaits you on the terrace. Please leave it clean after use.')),
      text(head('Où se trouve quoi ?'), head('Where is what?')),
      { type: 'faq', data: { items: [
        { question: t('Des rallonges, des bougies ?', 'Extension leads, candles?'), answer: t('Dans le tiroir du meuble en bois de la pièce de vie.', 'In the drawer of the wooden cabinet in the living room.') },
        { question: t('Une brosse à dents ou un savon oubliés ?', 'Forgot a toothbrush or soap?'), answer: t('Nous en laissons dans ce même tiroir. Dites-nous si vous vous servez, pour que nous en remettions.', 'We keep some in that same drawer. Let us know if you take one, so we can restock.') },
        { question: t('Les informations touristiques ?', 'Tourist information?'), answer: t('Dans le meuble en bois. Une pépite dénichée pendant votre séjour ? Partagez-la : on enrichit la collection pour les suivants.', 'In the wooden cabinet. Found a gem during your stay? Share it: we add it for the next guests.') },
        { question: t('L’appareil à raclette ?', 'The raclette grill?'), answer: t('En haut du placard près de l’entrée, côté gauche.', 'At the top of the cupboard by the entrance, on the left.') },
        { question: t('Le grille-pain et la cafetière familiale ?', 'The toaster and the large coffee maker?'), answer: t('Dans le meuble d’entrée, côté droit.', 'In the entrance cabinet, on the right.') },
        { question: t('Les jeux de société ?', 'Board games?'), answer: t('Dans le meuble d’entrée, côté gauche.', 'In the entrance cabinet, on the left.') },
        { question: t('Du démaquillant ?', 'Make-up remover?'), answer: t('De l’eau micellaire vous attend dans les salles de bain.', 'There is micellar water in the bathrooms.') },
        { question: t('Trop haut pour attraper ?', 'Too high to reach?'), answer: t('Un tabouret est là pour vous donner un coup de pouce.', 'A step stool is there to give you a boost.') },
      ] } },
    ],
  },
  {
    slug: 'la-cheminee', icon: 'info', title: t('La cheminée', 'The fireplace'), only: 'granja',
    blocks: [
      text(p('La cheminée est à vous pour des soirées chaleureuses. D’octobre à mars, le bois est fourni.'),
        p('The fireplace is yours for cosy evenings. From October to March, firewood is provided.')),
      image('feu'),
      text(head('Allumer le feu'), head('Lighting the fire')),
      steps([
        t('Dans le foyer, empilez les bûches en croix en laissant un peu d’espace entre elles.', 'In the hearth, stack the logs crosswise, leaving a little space between them.'),
        t('Posez par-dessus deux bûchettes et placez l’allume-feu au milieu.', 'Lay two pieces of kindling on top and put the firelighter in the middle.'),
        t('Ajoutez deux bûchettes perpendiculaires aux premières.', 'Add two more pieces of kindling across the first ones.'),
        t('Une allumette suffit : le feu est allumé.', 'One match is enough: the fire is lit.'),
      ]),
      text(p('Le pin, bois léger, s’allume et brûle vite. Le chêne, bois dense, brûle plus longtemps : préférez-le pour la nuit.'),
        p('Pine, a light wood, catches and burns fast. Oak, a dense wood, burns longer: use it for the night.')),
      callout('warning', t('Pour une flambée sans fumée', 'For a fire without smoke'),
        t('Chargez le bois par le côté, pas par la façade, et refermez bien la porte après chaque manipulation.',
          'Load the wood from the side, not the front, and close the door properly each time.')),
      callout('info', null, t('Un souci avec la cheminée ? Appelez-nous : nous pouvons venir la démarrer ou vérifier son fonctionnement.',
        'Trouble with the fireplace? Call us: we can come and light it or check that it works.')),
    ],
  },
  {
    slug: 'votre-lodge', icon: 'home', title: t('Votre lodge', 'Your lodge'), only: 'estiva',
    blocks: [
      text(p('Le lodge a tout ce qu’il faut pour vivre bien, dehors : un vrai lit, l’eau courante et l’eau chaude, l’électricité, des WC, une plaque de cuisson et un micro-ondes. La plancha est offerte dès deux nuits ; sinon, elle se réserve dans la Boutique.',
        'Le confort est là. C’est le superflu qu’on a laissé dehors, pour vous rendre l’essentiel : le calme, le ciel, les étoiles.'),
      p('The lodge has everything you need to live well outdoors: a real bed, running and hot water, electricity, a toilet, a hob and a microwave. The plancha griddle is free from two nights; otherwise, book it in the Shop.',
        'The comfort is here. It is the superfluous we left outside, to give you back the essentials: calm, the sky, the stars.')),
      text(head('Prenez le temps') + p('Ici, pas de wifi, et c’est un peu voulu. Des lapins qui détalent au petit matin, le chant des oiseaux, les cigales l’été… Le plus beau des réseaux, ici, c’est le silence qui se remplit peu à peu.'),
        head('Take your time') + p('No wifi here, and that is partly on purpose. Rabbits darting off at dawn, birdsong, cicadas in summer… The best network here is the silence slowly filling up.')),
      callout('warning', t('Un habitat de toile', 'A canvas home'),
        t('Pas d’appareils à risque, et un usage attentionné des équipements. Le lodge fonctionne sur fosse septique : n’y jetez que du papier toilette.',
          'No hazardous appliances, and please treat the equipment with care. The lodge runs on a septic tank: only toilet paper down the toilet.')),
      text(head('Le panier des oublis') + p('Un savon resté à la maison, une éponge qui manque, un bout de film pour emballer le fromage… Dans l’entrée, un petit panier vous dépanne : papier toilette, essuie-tout, éponge, dosette de lessive. Glissez une petite participation dans la boîte (1 € suffit) : c’est ce qui garde le panier garni pour ceux qui passent après vous.'),
        head('The forgotten-items basket') + p('Soap left at home, a missing sponge, some cling film for the cheese… In the entrance, a small basket helps you out: toilet paper, kitchen roll, sponge, laundry pod. Leave a small contribution in the box (€1 is enough): it keeps the basket full for those who come after you.')),
    ],
  },
  {
    slug: 'securite', icon: 'alert', title: t('Sécurité', 'Safety'),
    blocks: [
      callout('warning', t('Urgence médicale', 'Medical emergency'),
        t('Appelez le 15 (SAMU) avant de vous rendre aux urgences : ici, c’est le réflexe. Pompiers : 18. Numéro d’urgence européen : 112.',
          'Call 15 (SAMU, the emergency medical service) before going to A&E: that is the rule here. Fire brigade: 18. European emergency number: 112.')),
      text(p('Pharmacie à Satillieu, hôpital à Annonay.'), p('Pharmacy in Satillieu, hospital in Annonay.')),
      text(head('Le feu') + p('Le domaine est entouré de nature sèche : un départ de feu va très vite. Aucun feu en dehors des équipements prévus : pas de feu de camp, pas de barbecue sauvage.'),
        head('Fire') + p('The estate is surrounded by dry countryside: a fire spreads very fast. No fire outside the equipment provided: no campfires, no makeshift barbecues.')),
      text(p('Au gîte, la cheminée et le barbecue de la terrasse sont là pour ça. Le feu du bain nordique, c’est nous qui l’allumons.'),
        p('At the cottage, the fireplace and the terrace barbecue are there for that. We light the Nordic bath’s fire ourselves.'), 'granja'),
      text(p('Pas de flamme près du lodge. Le seul feu, c’est celui qu’on allume pour vous sous le bain nordique.'),
        p('No flames near the lodge. The only fire is the one we light for you under the Nordic bath.'), 'estiva'),
      text(head('Tabac et vapotage') + p('Le logement est entièrement non-fumeur, cigarette électronique comprise. Dehors, restez à distance des portes et fenêtres et utilisez les cendriers.'),
        head('Smoking and vaping') + p('The accommodation is entirely non-smoking, e-cigarettes included. Outside, keep away from doors and windows and use the ashtrays.')),
      text(p('Le cendrier du lodge est près de la passerelle.'), p('The lodge’s ashtray is by the walkway.'), 'estiva'),
      callout('warning', null, t('Jamais de mégot au sol, dans la nature ou dans une poubelle sans être sûr qu’il est éteint : un seul mégot mal éteint peut mettre tout le domaine en danger.',
        'Never leave a cigarette end on the ground, in nature, or in a bin unless you are sure it is out: a single smouldering end can put the whole estate in danger.')),
      text(head('Les enfants') + p('Sur tout le domaine, dans le logement, sur les chemins, près des animaux, de l’eau et des installations, les enfants restent sous la responsabilité de leurs parents.'),
        head('Children') + p('Everywhere on the estate, in the accommodation, on the paths, near the animals, the water and the facilities, children remain their parents’ responsibility.')),
      text(head('Extincteurs et évacuation') + p('Le gîte est équipé d’extincteurs. Prenez un instant, dès votre arrivée, pour repérer les sorties sur les plans ci-dessous.'),
        head('Fire extinguishers and evacuation') + p('The cottage has fire extinguishers. Take a moment when you arrive to find the exits on the plans below.'), 'granja'),
      image('plan-rdc-etage', 'granja'),
      image('plan-grenier', 'granja'),
      text(head('Extincteur') + p('Le lodge est équipé d’un extincteur, réservé aux urgences.'),
        head('Fire extinguisher') + p('The lodge has a fire extinguisher, for emergencies only.'), 'estiva'),
    ],
  },
  {
    slug: 'bain-nordique', icon: 'bath', title: t('Le bain nordique', 'The Nordic bath'),
    blocks: [
      text(p('Une eau chaude en plein air, le feu de bois qui crépite, le silence autour. Un moment hors du temps pour relâcher toutes les tensions : sans doute le souvenir que vous garderez le plus longtemps.',
        'Le bain se réserve à l’avance : il faut du temps pour monter l’eau en température, doucement, au feu de bois.'),
      p('Hot water in the open air, the crackle of the wood fire, silence all around. A timeless moment to let all tension go: probably the memory you will keep the longest.',
        'The bath is booked in advance: it takes time to heat the water, slowly, over a wood fire.')),
      button(t('Réserver un créneau', 'Book a slot'), { kind: 'item', lookup: 'bath' }),
      callout('warning', t('Réservé aux adultes', 'Adults only'),
        t('Eau très chaude, risques cardiovasculaires, mauvaise régulation de la température chez l’enfant : le bain est interdit aux enfants. Des aventures rien que pour eux les attendent sur le domaine.',
          'Very hot water, cardiovascular risks, children’s poor temperature regulation: the bath is not allowed for children. Adventures just for them await on the estate.')),
      text(head('Contre-indications') + p('L’accès est déconseillé, voire interdit, en cas de problème cardiaque ou circulatoire, d’hypertension non stabilisée, de problème de peau, de plaie ouverte ou d’infection, de grossesse, de grande fatigue ou de fièvre. En cas de doute, demandez-nous, ou demandez à votre médecin.'),
        head('Contraindications') + p('The bath is not recommended, or not allowed, with a heart or circulation condition, uncontrolled high blood pressure, a skin condition, an open wound or an infection, during pregnancy, or with great fatigue or a fever. If in doubt, ask us, or ask your doctor.')),
      text(head('Pour en profiter sereinement'), head('To enjoy it safely')),
      steps([
        t('Une douche avant d’entrer.', 'A shower before getting in.'),
        t('Des sessions de 15 à 20 minutes.', 'Sessions of 15 to 20 minutes.'),
        t('Buvez de l’eau, et laissez l’alcool pour plus tard.', 'Drink water, and keep alcohol for later.'),
        t('Dans le calme et le respect de chacun.', 'In calm, with respect for everyone.'),
      ]),
    ],
  },
  {
    slug: 'piscine', icon: 'info', title: t('La piscine', 'The pool'),
    blocks: [
      text(p('La piscine hors-sol est ouverte en juillet et en août.'), p('The above-ground pool is open in July and August.')),
      text(head('Pour une baignade agréable'), head('For a pleasant swim')),
      steps([
        t('Une douche avant de vous baigner, et un passage par le pédiluve.', 'A shower before swimming, and a step through the footbath.'),
        t('Les enfants restent sous la surveillance de leurs parents.', 'Children stay under their parents’ supervision.'),
        t('Le calme et la propreté, pour que chacun en profite.', 'Quiet and cleanliness, so everyone can enjoy it.'),
      ]),
    ],
  },
  {
    slug: 'animaux', icon: 'soliomap', title: t('Les habitants du domaine', 'The estate’s residents'),
    blocks: [
      text(p('Le Domaine Solio est d’abord leur maison. Vous allez les croiser, c’est sûr : ils sont curieux, parfois collants, toujours libres. Côté ferme, des chèvres, des béliers, des brebis et nos ânes gourmands ; sans oublier les poules, les cochons d’Inde, et les chiens et les chats de la maison.'),
        p('The Domaine Solio is first of all their home. You will meet them, that is for sure: they are curious, sometimes clingy, always free. On the farm side, goats, rams, ewes and our greedy donkeys; not forgetting the hens, the guinea pigs, and the house dogs and cats.')),
      text(head('Pour que tout se passe bien'), head('For everyone to get along')),
      steps([
        t('Aux ânes et aux chèvres, offrez carottes, pommes ou pastèque. Jamais de pain : leur estomac ne le supporte pas. Pour le reste, demandez-nous.', 'Give the donkeys and goats carrots, apples or watermelon. Never bread: their stomachs cannot take it. For anything else, ask us.'),
        t('Les ânes peuvent arriver vite : levez les bras, prenez de la place, et ne passez jamais derrière eux.', 'The donkeys can come up fast: raise your arms, take up space, and never walk behind them.'),
        t('Les brebis sont peureuses : on les observe de loin.', 'The ewes are shy: watch them from a distance.'),
        t('Approchez lentement, sans courir ni gestes brusques.', 'Approach slowly, without running or sudden movements.'),
        t('Laissez les portails des parcs comme vous les avez trouvés, ouverts ou fermés.', 'Leave the paddock gates as you found them, open or closed.'),
      ]),
      text(head('Une faune discrète') + p('Ouvrez l’œil, et l’oreille : chevreuils, renards, oiseaux, lapins sauvages, salamandres surtout après la pluie. Le secret pour les apercevoir : marcher doucement, parler bas, prendre le temps. Le soir, vous entendrez souvent une chouette, un des petits bonheurs simples d’ici.',
        'Vous avez croisé un animal ? Venez nous le raconter, on adore partager nos anecdotes.'),
      head('Discreet wildlife') + p('Keep your eyes, and ears, open: roe deer, foxes, birds, wild rabbits, salamanders especially after rain. The secret to spotting them: walk gently, talk quietly, take your time. In the evening you will often hear an owl, one of the simple joys of this place.',
        'Spotted an animal? Come and tell us, we love sharing stories.')),
      text(p('Pour les plus curieux, des fiches sur les animaux du domaine vous attendent sur le rebord de la fenêtre, près des WC du bas.'),
        p('For the most curious, fact sheets about the estate’s animals are on the window sill by the downstairs toilet.'), 'granja'),
      text(head('Votre animal de compagnie') + p('Il est accepté à titre exceptionnel, après notre accord. Gardez-le sous surveillance constante, promenez-le plutôt vers le portail, la zone la moins sensible pour nos animaux, et ramassez ses déjections.'),
        head('Your pet') + p('Pets are accepted only exceptionally, with our prior agreement. Keep yours under constant supervision, walk it towards the gate, the area least sensitive for our animals, and pick up after it.')),
    ],
  },
  {
    slug: 'balades', icon: 'soliomap', title: t('Les balades', 'Walks'),
    blocks: [
      text(p('Deux boucles partent directement du domaine. Des chemins naturels, parfois étroits ou irréguliers, et peu adaptés aux poussettes.')
        + head('La boucle rouge') + p('Environ 2 km sur nos terres. Départ près du muret du gîte.')
        + head('La boucle orange') + p('Départ près du bain nordique.'),
      p('Two loops start right from the estate. Natural paths, sometimes narrow or uneven, and not suited to pushchairs.')
        + head('The red loop') + p('About 2 km across our land. It starts by the cottage’s low wall.')
        + head('The orange loop') + p('It starts by the Nordic bath.')),
      callout('info', null, t('Vous traversez parfois les parcs des animaux : laissez les portails comme vous les avez trouvés.',
        'You sometimes cross the animals’ paddocks: leave the gates as you found them.')),
      text(p('En chemin, chênes, châtaigniers, hêtres et acacias se succèdent, essence après essence. Les terrasses et les bordures de pierre racontent les vignes d’autrefois.'),
        p('Along the way, oaks, chestnuts, beeches and acacias follow one another, species after species. The terraces and stone edges tell of the vineyards of old.')),
      button(t('Voir la carte du domaine', 'See the estate map'), { kind: 'url', href: 'https://map.domainesolio.com' }),
    ],
  },
  {
    slug: 'enfants', icon: 'info', title: t('Avec les enfants', 'With children'),
    blocks: [
      text(p('Ici, l’aventure est à hauteur d’enfant. Pendant que vous profitez du bain ou d’un moment de calme, place à l’exploration : animaux à rencontrer, traces à pister, missions à relever, histoires et contes adaptés à leur âge.',
        'Chasse aux œufs, balade nocturne, rencontre avec les animaux, sur les traces de la faune sauvage, veillée au coin du feu avec pop-corn et chamallows : de quoi transformer leur séjour en véritable aventure. Et pendant qu’ils explorent, encadrés, vous soufflez. Le programme et les tarifs sont dans la Boutique.'),
      p('Here, adventure is child-sized. While you enjoy the bath or a quiet moment, it is time to explore: animals to meet, tracks to follow, missions to complete, stories and tales for their age.',
        'Egg hunt, night walk, meeting the animals, on the trail of wildlife, an evening by the fire with popcorn and marshmallows: enough to turn their stay into a real adventure. And while they explore, supervised, you get a break. The programme and prices are in the Shop.')),
      text(head('Le SOL, la monnaie du domaine') + p('Ici, les enfants ont du pouvoir. À son arrivée, chaque enfant reçoit des SOL, des pièces à l’effigie du domaine. Il en gagne d’autres en donnant un coup de main à la ferme : une brouette de bois mort, un seau de pommes de pin, un carré de potager désherbé. Les SOL se dépensent ensuite à la boutique de l’accueil : une sucette, un petit souvenir, un œuf imprimé en 3D.'),
        head('The SOL, the estate’s currency') + p('Here, children have power. On arrival, each child receives SOL, coins bearing the estate’s emblem. They earn more by lending a hand on the farm: a wheelbarrow of dead wood, a bucket of pine cones, a weeded patch of vegetable garden. SOL are then spent at the reception shop: a lollipop, a small souvenir, a 3D-printed egg.')),
      callout('info', null, t('Sur tout le domaine, les enfants restent sous la responsabilité de leurs parents.',
        'Everywhere on the estate, children remain their parents’ responsibility.')),
    ],
  },
  {
    slug: 'prendre-soin', icon: 'info', title: t('Prendre soin du domaine', 'Caring for the estate'),
    blocks: [
      text(p('Ici, tout est question d’équilibre, entre nature, animaux et moments de détente. Les mêmes réflexes que chez vous suffisent.'),
        p('Here, everything is about balance between nature, animals and time to unwind. The same habits as at home are enough.')),
      steps([
        t('Éteignez les lumières inutiles.', 'Switch off lights you do not need.'),
        t('Coupez le chauffage plutôt que d’ouvrir les fenêtres.', 'Turn the heating off rather than opening the windows.'),
        t('Ne consommez que l’eau et l’électricité dont vous avez besoin.', 'Use only the water and electricity you need.'),
        t('Fermez bien le couvercle des poubelles : les renards fouillent.', 'Close the bin lids properly: foxes rummage.'),
      ]),
      text(p('Pas de déchets autour du lodge, même pour une nuit.'), p('No rubbish around the lodge, even for one night.'), 'estiva'),
      text(head('Le tri') + p('Des sacs de tri vous attendent à côté de la machine à laver.'),
        head('Recycling') + p('Recycling bags are next to the washing machine.'), 'granja'),
      text(p('La communauté de communes trie le verre, le plastique et le carton. Points de dépôt : la salle de l’Ayclipse à Satillieu (pratique avant de charger la voiture), ou près de l’école publique de Saint-Alban-d’Ay.'),
        p('The local council collects glass, plastic and cardboard separately. Drop-off points: the Salle de l’Ayclipse in Satillieu (handy before loading the car), or near the state school in Saint-Alban-d’Ay.')),
    ],
  },
  {
    slug: 'autour', icon: 'soliomap', title: t('Autour du domaine', 'Around the estate'),
    blocks: [
      { type: 'hours', data: { title: t('Les marchés de producteurs', 'Farmers’ markets'), rows: [
        { label: t('Mardi matin', 'Tuesday morning'), value: t('Satillieu', 'Satillieu') },
        { label: t('Mercredi matin', 'Wednesday morning'), value: t('Annonay', 'Annonay') },
        { label: t('Jeudi matin', 'Thursday morning'), value: t('Saint-Alban-d’Ay, Quintenas', 'Saint-Alban-d’Ay, Quintenas') },
        { label: t('Vendredi après-midi', 'Friday afternoon'), value: t('Quintenas (Graines d’Adine), Davézieux', 'Quintenas (Graines d’Adine), Davézieux') },
        { label: t('Samedi matin', 'Saturday morning'), value: t('Annonay', 'Annonay') },
        { label: t('Dimanche matin', 'Sunday morning'), value: t('Saint-Félicien', 'Saint-Félicien') },
      ] } },
      text(head('Nos commerçants') + ul([
        '<strong>Boucherie Coste Chareyre</strong> : tous les jours sauf le lundi',
        '<strong>Charcuterie Crouzet</strong> : tous les jours sauf le lundi',
        '<strong>Boulangerie Roux</strong> : du mardi au samedi, parfois le dimanche (été, fêtes)',
        '<strong>Supérettes Spar et Vival</strong> : Vival fermé le lundi',
        '<strong>Ma Maison (Gamm Vert)</strong> : coopérative agricole',
        '<strong>Presse Cathy Marcoux</strong> : presse, bar',
      ]) + p('Satillieu a aussi une pharmacie, un tabac-presse et un distributeur de billets.'),
      head('Our local shops') + ul([
        '<strong>Boucherie Coste Chareyre</strong> (butcher): every day except Monday',
        '<strong>Charcuterie Crouzet</strong> (delicatessen): every day except Monday',
        '<strong>Boulangerie Roux</strong> (bakery): Tuesday to Saturday, sometimes Sunday (summer, holidays)',
        '<strong>Spar and Vival</strong> (grocery shops): Vival closed on Monday',
        '<strong>Ma Maison (Gamm Vert)</strong>: farming cooperative',
        '<strong>Presse Cathy Marcoux</strong>: newsagent, bar',
      ]) + p('Satillieu also has a pharmacy, a tobacconist-newsagent and a cash machine.')),
      { type: 'contact', data: { source: 'inline', name: 'Fournil de Saint-Romain-d’Ay', role: t('Boulangerie à 7 min, ouverte le dimanche : réservez vos viennoiseries à l’avance', 'Bakery 7 min away, open on Sunday: order your pastries in advance'), phone: '04 75 33 64 28' } },
      callout('info', t('Nos adresses', 'Our tips'), t('Une bonne table, une cascade, un coin secret ? Demandez-nous. Et si vous dénichez une pépite, partagez-la : on enrichit la liste pour les suivants.',
        'A good restaurant, a waterfall, a secret spot? Ask us. And if you find a gem, share it: we add it to the list for the next guests.')),
    ],
  },
  {
    slug: 'depart', icon: 'clock', title: t('Votre départ', 'Your departure'),
    blocks: [
      text(p('Un dernier geste pour la magie du lieu. Nous accueillons des hôtes attentionnés, et nous savons que vous laisserez le domaine aussi accueillant que vous l’avez trouvé.'),
        p('One last gesture for the magic of the place. We welcome thoughtful guests, and we know you will leave the estate as welcoming as you found it.')),
      text(head('Avant de partir'), head('Before you leave')),
      steps([
        t('Une cuisine rangée, la vaisselle propre et rangée, la table nettoyée.', 'A tidy kitchen, the dishes clean and put away, the table wiped.'),
        t('Des WC propres, et les jeux rangés pour les prochains enfants.', 'Clean toilets, and the games put away for the next children.'),
        t('Les draps laissés en place sur les lits.', 'The sheets left on the beds.'),
        t('Les serviettes utilisées regroupées au sol ; celles qui n’ont pas servi, pliées sur un lit.', 'Used towels gathered on the floor; unused ones folded on a bed.'),
      ], 'granja'),
      steps([
        t('Une cuisine rangée, la vaisselle propre et rangée, la table nettoyée.', 'A tidy kitchen, the dishes clean and put away, the table wiped.'),
        t('Des WC propres.', 'Clean toilets.'),
        t('Les draps laissés en place sur les lits.', 'The sheets left on the beds.'),
        t('Les serviettes utilisées déposées sur l’étendage.', 'Used towels hung on the drying rack.'),
        t('Les clés rapportées à l’accueil, le bâtiment près de la piscine : on se retrouve pour un dernier bonjour.', 'The keys brought back to reception, the building by the pool: we meet for a last goodbye.'),
      ], 'estiva'),
      callout('info', t('Sans l’option ménage', 'Without the cleaning option'),
        t('En plus de tout ranger, nettoyez les sanitaires (WC, douche, lavabo), la cuisine, et lavez les sols. L’option ménage se réserve dans la Boutique.',
          'As well as tidying up, clean the toilet, shower and basin, the kitchen, and wash the floors. The cleaning option can be booked in the Shop.')),
      text(p('Avec l’option ménage, laissez simplement le lodge rangé, la vaisselle faite et les déchets évacués. Ce sont souvent ceux qui la choisissent qui sont les plus respectueux : pour nous, c’est un plaisir de terminer le travail.'),
        p('With the cleaning option, simply leave the lodge tidy, the dishes done and the rubbish taken out. Those who choose it are often the most considerate: for us, finishing the job is a pleasure.'), 'estiva'),
      callout('warning', null, t('En partant, refermez bien le portail derrière vous.', 'As you leave, close the gate properly behind you.')),
      text(p('Merci pour cette attention envers la personne qui passe derrière vous.'), p('Thank you for this kindness towards the person who comes after you.')),
    ],
  },
  {
    slug: 'en-cas-de-pepin', icon: 'alert', title: t('En cas de pépin', 'If something goes wrong'),
    blocks: [
      text(p('Un accident est vite arrivé : une casse, une tache, un imprévu. Ça arrive, on le comprend, et c’est presque toujours sans gravité. Le mieux, c’est de nous le dire de vive voix : on règle ça ensemble, simplement. Nous pourrons ainsi remplacer l’objet avant l’arrivée des voyageurs suivants.',
        'Si c’est plus sérieux, pas d’inquiétude : ces incidents sont le plus souvent couverts par votre assurance responsabilité civile, et il y a toujours une assurance, la vôtre ou la nôtre, pour réparer.'),
      p('Accidents happen: a breakage, a stain, something unexpected. We understand, and it is almost never serious. The best thing is to tell us in person: we sort it out together, simply. That way we can replace the item before the next guests arrive.',
        'If it is more serious, do not worry: such incidents are usually covered by your personal liability insurance, and there is always an insurance policy, yours or ours, to put things right.')),
      text(head('Le cadre, pour être clair') + p('Il ne sert qu’en cas de vrai souci :') + ul([
        'Casse ou dégradation : facturée au réel, ou remplacée si besoin.',
        'Ménage plus lourd que l’option ménage : 80 €.',
        'Départ qui déborde sur l’horaire convenu : 40 €.',
        'Départ tardif non convenu, qui occupe le logement la journée : facturé comme une nuit supplémentaire.',
        'Mégots retrouvés au sol : 80 € par jour.',
        'Extincteur, réservé aux urgences : 40 € pour un plomb manquant, 120 € s’il a été utilisé.',
      ]) + p('Très honnêtement, rien de tout cela n’arrive jamais. Et avec vous, on est tranquilles.'),
      head('The rules, to be clear') + p('They only apply if there is a real problem:') + ul([
        'Breakage or damage: charged at cost, or replaced if needed.',
        'Cleaning beyond the cleaning option: €80.',
        'Departure running past the agreed time: €40.',
        'Unagreed late departure, occupying the accommodation for the day: charged as an extra night.',
        'Cigarette ends found on the ground: €80 per day.',
        'Fire extinguisher, for emergencies only: €40 for a missing seal, €120 if it was used.',
      ]) + p('Honestly, none of this ever happens. And with you, we are at ease.')),
    ],
  },
  {
    slug: 'entre-nous', icon: 'contacts', title: t('Un petit mot entre nous', 'A word between us'),
    blocks: [
      text(p('Quelque chose vous a déplu ? Dites-le-nous avant de partir, simplement. On ne se rend pas toujours compte d’un détail : on préfère le savoir et le corriger tout de suite, plutôt que de le découvrir plus tard sur les réseaux, ou de laisser d’autres voyageurs vivre la même chose.'),
        p('Was something not right? Tell us before you leave, simply. We do not always notice a detail: we would rather know and fix it straight away than find out later online, or let other guests go through the same thing.')),
      text(head('Vous avez aimé votre séjour ?') + p('Le plus beau des cadeaux, c’est un avis, sur votre plateforme de réservation ou sur Google. Quelques mots suffisent : ils aident d’autres voyageurs à nous trouver, et ils nous touchent à chaque fois.'),
        head('Did you enjoy your stay?') + p('The best gift is a review, on your booking platform or on Google. A few words are enough: they help other travellers find us, and they touch us every time.')),
      text(head('Devenez ambassadeurs') + p('Le domaine grandit grâce à vous. Glissez quelques-unes de nos cartes dans vos bagages et offrez-les à vos amis en quête de nature : chaque parrainage vous rapporte des SOL pour votre prochain séjour. Et plus le domaine est connu, plus nous pouvons imaginer la suite : nouveaux hébergements, terrains de jeux, rencontres avec nos animaux.'),
        head('Become ambassadors') + p('The estate grows thanks to you. Slip a few of our cards into your luggage and give them to friends who love nature: each referral earns you SOL for your next stay. And the better known the estate, the more we can imagine what comes next: new accommodation, play areas, encounters with our animals.')),
      button(t('Suivre le domaine sur Facebook', 'Follow the estate on Facebook'), { kind: 'url', href: 'https://www.facebook.com/Solio07' }),
      button(t('Réserver votre prochain séjour', 'Book your next stay'), { kind: 'url', href: 'https://www.domainesolio.com' }),
    ],
  },
  {
    slug: 'histoire', icon: 'booklet', title: t('L’histoire du domaine', 'The estate’s story'),
    blocks: [
      text(p('Solio évoque la lumière et la douceur de vivre. Et, en secret, deux prénoms : « So » pour Sophie, « lio » pour Tilio.',
        'Le domaine n’est ni un héritage, ni une propriété de famille : juste l’envie, toute simple, de trouver un lieu à nous et d’y faire naître notre projet. Nous l’avons acheté en 2019 : une maison sombre, peu isolée, un seul chemin vers le champ du fond. Au fil des années, nous l’avons transformé avec une idée simple : créer un lieu naturel, ressourçant, accessible à tous. Le gîte a accueilli ses premiers voyageurs en 2025 ; l’Aventura Lodge a ouvert au printemps 2026.',
        'Du passé de ces terres, nous n’avons pas tout retrouvé. Mais quelques traces parlent encore : ici vivait une ferme, avec ses vaches, et même des vignes, dont les terrasses et les bordures de pierre dessinent toujours le paysage. Les bois, longtemps exploités, ont été replantés au fil du temps.',
        'Et ce n’est que le début : après le bain nordique et la piscine viendront la pétanque, le billard et une aire de jeux pour les enfants, puis des cabanes accessibles aux personnes à mobilité réduite et des dômes géodésiques. Le Domaine Solio n’est pas un lieu figé : il évolue, il respire, il grandit. Et chaque séjour participe à son histoire, y compris le vôtre.',
        'Déconnectez. Respirez. Profitez.'),
      p('Solio evokes light and the gentle art of living. And, secretly, two first names: “So” for Sophie, “lio” for Tilio.',
        'The estate is neither an inheritance nor a family property: just the simple wish to find a place of our own and bring our project to life there. We bought it in 2019: a dark, poorly insulated house, a single path to the far field. Over the years we transformed it with one simple idea: to create a natural, restorative place, open to all. The cottage welcomed its first guests in 2025; the Aventura Lodge opened in spring 2026.',
        'We have not recovered everything from the past of this land. But a few traces still speak: a farm lived here, with its cows, and even vineyards, whose terraces and stone edges still shape the landscape. The woods, long logged, were replanted over time.',
        'And this is only the beginning: after the Nordic bath and the pool will come pétanque, billiards and a children’s play area, then cabins accessible to people with reduced mobility, and geodesic domes. The Domaine Solio is not a fixed place: it evolves, it breathes, it grows. And every stay is part of its story, yours included.',
        'Disconnect. Breathe. Enjoy.')),
    ],
  },
];
