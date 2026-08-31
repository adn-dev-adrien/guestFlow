# Changelog

All notable changes to GuestFlow are documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.12.0] - 2026-08-31

### Summary
- Encaisser un séjour en une fois puis enregistrer la fiche n'efface plus le paiement : il tenait rarement plus d'un clic.
- Le SAS départ ne réclame plus, ni n'efface, un complément de fin de séjour déjà réglé à l'arrivée.
- « Marquer acompte / solde payé » s'enregistre immédiatement, sans attendre le bouton Enregistrer.
- Si un paiement unique se défait, l'historique de la fiche dit désormais ce qui a disparu et pourquoi.

### Added
- **A dissolved single payment is finally traceable** (spec `single-payment-at-check-in.md`, rule 8bis). The payment group dies as soon as one of the buckets it covers stops being settled — but it did so without a word in the reservation's history, so a collection could vanish leaving no trace at all. That silence is what made the two bugs below impossible to diagnose from the app. The history now carries « Paiement unique à l'arrivée : 184,95 € le 30/08 (solde, complément de fin de séjour) → dissous — « solde » n'est plus encaissé »: what disappeared, and which bucket caused it.

### Changed
- **« Marquer acompte / solde payé » writes immediately** (spec `single-payment-from-the-fiche.md`, rule 11bis). Those two buttons only moved form state and waited for the page's Save; they now go through the same path as the complement, like every other money movement on the fiche. That is what lets the save ignore the payment flags — and therefore stop being able to erase one by accident. The caution keeps its own behaviour.

### Fixed
- **Saving a reservation no longer erases the single arrival payment** (spec `single-payment-from-the-fiche.md`, rule 11bis; found in production on 2026-08-31). After « Encaisser en une fois », clicking Save dissolved the collection: the form had been loaded BEFORE the money was recorded, so it sent « solde payé = non » back, the server read that as an un-payment and dropped the group — hence two entries in the Comptabilité instead of one card, and an end-of-stay complement due again. The three payment flags are no longer read from the browser: they belong to the buttons that collect, and the stored state wins.
- **The departure SAS no longer erases a complement collected at the door** (spec `recall-unpaid-arrival-complement-at-checkout.md`, rule 9bis; found in production on 2026-08-31). When the guest had settled everything on arrival, the departure recap did not know: it asked for the 50 € of the end-of-stay complement all over again, and « Valider et terminer » — with no settlement mode, since the money was already in — cleared the collection. The recap now says « Déjà encaissé le JJ/MM — rien à percevoir », pre-selects the mode actually used, and the commit can only undo a collection that this SAS made itself.

### Migration
- One column on `reservations`: `endOfStayComplementPaidAtDeparture` (spec `recall-unpaid-arrival-complement-at-checkout.md`, rule 9bis), `0` on every existing row. It records whether the departure SAS is what collected the end-of-stay complement — only then may it un-collect it. Mirror of `complementPaidAtArrival`. No backfill: an older reservation behaves as if the complement had been collected elsewhere, which is the cautious side.

## [2.11.0] - 2026-08-31

### Summary
- Le paiement unique encaissé à l'arrivée est désormais détaillé sur la fiche : hébergement, options, prestations, taxe de séjour, puis le total.
- Un champ « Total encaissé » permet d'enregistrer ce que le client a réellement remis.
- Moins que prévu : une réduction est imputée sur l'hébergement, sans jamais rogner la taxe de séjour. Plus que prévu : un pourboire.
- La comptabilité porte ces deux gestes en écritures propres, rangées dans la carte du paiement qu'elles corrigent.
- L'export du comptable gagne donc deux types d'écritures : prévenez-le avant le premier export qui en portera une.

### Added
- **The single arrival payment, itemised and adjustable** (spec `arrival-payment-detail-and-adjustment.md`). On the reservation fiche, the « Encaissé à l'arrivée » block no longer names buckets (« solde · complément ») but what the guest actually paid for: the nights, the pre-arrival options, the complement's own lines — the same wording as the check-in recap — the tourist tax on a single line, then the total. An offered line stays visible at 0 € with its original amount struck through. A « Total encaissé » field records what was really handed over: below the computed total it books a **réduction accordée** charged to the accommodation, above it a **pourboire**. The reduction can never exceed the accommodation, and the server clamps it to that floor — the tourist tax is owed to the commune whatever was granted at the door.

### Changed
- **Accounting — the rebate and the tip each get their own entry** (spec `arrival-payment-detail-and-adjustment.md`). A reduction granted at the door is debited to `70900000` (rabais, remises et ristournes accordés) with its VAT, the accommodation keeping its gross credit: the journal shows the price AND the gesture. A tip is credited to `75880000` (produit divers), with no VAT — a freely given tip is not the consideration of a service. Both are filed inside the « Paiement unique » card of the collection they adjust, and a caisse-interne group emits neither. **The accountant's export therefore gains two entry kinds: tell them before the first export that carries one.**

### Migration
- Two nullable columns on `reservations`: `arrivalPaymentReduction` and `arrivalPaymentTip` (spec `arrival-payment-detail-and-adjustment.md`). `NULL` on every existing row means « nothing adjusted », so no earlier reservation changes its display or its journal entry. No backfill. Both are cleared together with the payment group they adjust, so an undone payment can never leave a reduction behind.

## [2.10.1] - 2026-08-31

### Summary
- « Encaisser en une fois » apparaît maintenant quand le seul autre montant dû est le complément de fin de séjour.
- C'est le cas d'une réservation plateforme sans acompte et sans prestation vendue au check-in.
- Ce complément entre dans le paiement unique : même date, même moyen, même mois comptable.
- « Annuler ce paiement » le libère avec les autres postes.
- Les notes en séjour restent à part : chacune est un encaissement distinct, à sa propre date.

### Fixed
- **« Encaisser en une fois » was missing exactly where it was needed most** (spec
  `single-payment-from-the-fiche.md` rule 2bis, reported from production on 2026-08-31). The control
  needs two amounts left to collect, and the **end-of-stay** complement was not counted among them. On
  a platform booking — acompte disabled, nothing sold at check-in — that leaves only the balance: one
  amount, so no control at all. Which was precisely the reservation whose guest had paid everything on
  arrival, the end-of-stay complement included. That complement now joins the single payment: it is
  collected at the same date, books into the accounting month of that date, and the undo releases it
  with the rest. The mid-stay notes stay apart — each is its own collection, at its own date.

## [2.10.0] - 2026-08-31

### Summary
- Un client qui a tout payé à l'arrivée s'enregistre depuis sa fiche, sans rouvrir le check-in.
- Le bloc « Encaisser en une fois » apparaît dès que le séjour ET le complément restent à percevoir.
- La date d'encaissement est la vôtre : un paiement reçu avant-hier part dans la comptabilité d'avant-hier.
- Un bouton CB / Chèque, un bouton Caisse interne, et « Annuler ce paiement » pour revenir en arrière.
- Rien de ce que le check-in avait enregistré n'est touché : prestations, petit déjeuner, cartes du planning.
- Une date dans le futur, ou antérieure à la réservation, est refusée en disant pourquoi.

### Added
- **Collect the stay and the complement in one go, from the fiche** (spec
  `single-payment-from-the-fiche.md`, 2026-08-31). Version 2.9.0 knows how to record a single payment,
  but only inside the arrival SAS, at the moment of the check-in. When the guest paid at the door and
  nothing was entered at the time, the only route was to **re-open the whole wizard** — eleven pages,
  questions whose wrong answer *removes* a sale, and the loss of the planning cards' « préparé »
  ticks. The fiche now carries the gesture: as soon as the stay **and** the complement are both still
  to be collected, an « Encaisser en une fois » block announces the total and what it covers, with
  **the collection date left to the operator** — a guest who paid the day before yesterday is recorded
  then, and the entry books into that month's accounting. One **CB / Chèque** button, one **Caisse
  interne** button, and « Annuler ce paiement » to undo. Nothing else is touched: no SAS page runs, so
  the prestations sold, the breakfast composition and the planning cards stay exactly as they were. A
  date in the future, or before the reservation existed, is refused with its reason. +20 server tests,
  +7 client tests.

## [2.9.0] - 2026-08-31

### Summary
- Un client qui règle tout à l'arrivée n'est plus enregistré deux fois : un seul encaissement, un seul geste.
- Le récapitulatif du check-in demande « Total à percevoir à l'arrivée », puis CB / Chèque, liquide ou plus tard.
- Le repas ou la planche vendus PENDANT le check-in sont comptés dans ce total, c'est le cas visé.
- La fiche affiche « Encaissé à l'arrivée : paiement unique de … », et la compta regroupe les écritures.
- « Régler séparément » reste à un tap pour encaisser le séjour et reporter le complément au départ.
- Comptes et TVA sont inchangés : hébergement et prestations gardent chacun leur ventilation.

### Added
- **One payment when the guest settles everything on arrival** (spec `single-payment-at-check-in.md`,
  2026-08-30). Since 2.8.0 the arrival SAS can collect two things — the stay and the arrival
  complement — and settled them separately: two button rows in the recap, two « payé » on the fiche,
  **two accounting entries** for a single line on the bank statement. At the door that is not what
  happens: a last-minute guest who takes a meal during the check-in hands over **one card, once**.
  When both sides are collectible the recap now asks once — « Total à percevoir à l'arrivée », then
  **CB / Chèque**, **Payé en liquide** or **Plus tard** — and what the check-in itself just sold is
  part of that total, which is the case the feature exists for. The fiche shows « Encaissé à
  l'arrivée : paiement unique de 802,00 € » above the buckets, and the Comptabilité folds the entries
  under one « Encaissé le … » card. The accounting ventilation is untouched: accommodation and
  prestations keep their own revenue accounts and VAT rates, because the collection is what is
  grouped, never the ventilation. « Régler séparément » stays one tap away, for a stay collected at
  the door and a complement deferred to the check-out. +24 server tests, +11 client tests.

### Migration
- **`reservations`** gains two columns: `arrivalPaymentGroup` (TEXT, NULL), which records the single
  arrival payment — its date, its means, the amount handed over and the buckets it covered — and
  `complementPaidAtArrival` (0 by default), the marker saying the SAS settled the complement itself,
  mirroring the two that already exist for the acompte and the solde. No existing data is changed: a
  reservation without a group reads exactly as before. The group is dissolved as soon as any bucket it
  names stops being settled, including from the fiche — so the fiche never announces a payment that
  is no longer true.

## [2.8.0] - 2026-08-30

### Summary
- Le SAS d'arrivée sait encaisser le séjour : une réservation de dernière minute non payée se règle à la porte.
- Trois choix, comme pour le complément : CB / Chèque, Payé en liquide (caisse interne), ou Pas maintenant.
- Le récapitulatif d'arrivée sépare « Séjour » et « Complément », et donne le total à percevoir à l'arrivée.
- Un séjour encaissé en liquide part en caisse interne : il sort de la comptabilité et du chiffre d'affaires.
- Sur une réservation plateforme, l'étape prévient que le solde est versé par la plateforme après le séjour.
- Le repas des trappeurs se prend enfin au check-in : chaque ligne de la page Restauration a son interrupteur.

### Added
- **Collect the stay at check-in** (spec `collect-stay-payment-at-check-in.md`, 2026-08-30). A
  last-minute booking arrives unpaid: the arrival SAS now carries a « Séjour à régler » step, right
  after the caution, showing what is still owed on the stay itself — unpaid deposit + unpaid balance
  — with the same buttons as the complement: **CB / Chèque**, **Payé en liquide** (caisse interne)
  and **Pas maintenant**, pre-selected. The recap takes the choice up in a « Séjour » block kept
  separate from the complement, with a total to collect on arrival. On a platform booking the step
  warns that the balance is paid by the platform after the stay, so nothing is collected twice. The
  gesture is undone by re-opening the SAS, it never touches a deposit already settled by transfer,
  and the step stays invisible to the reception role. +33 server tests, +6 client tests.

### Changed
- **The SAS tests are split by subject** (internal, CLAUDE.md §9). `ReservationSasDialog.test.jsx`
  held 65 tests over 1846 lines covering eight specs, and every feature appended its cases to the
  end — so two parallel branches conflicted there on 2026-08-30 over tests that had nothing to do
  with each other. The suite is now nine `ReservationSasDialog.<subject>.test.jsx` files with their
  shared fixtures in `__tests__/sasFixtures.jsx`: the same principle as `changelog.d/`, and what the
  server has always done (one test file per spec). No test added, removed or renamed.

### Fixed
- **« Le repas des trappeurs » can be taken at check-in again** (spec
  `sas-breakfast-and-catering-upsell.md` rule 7bis, reported from production on 2026-08-30). On the
  arrival SAS « Restauration » page every apéro board carried a switch, but the card option showed
  nothing except a grid of hour chips — and since nothing there is pre-selected, that row opened
  empty: its grey chips read as information rather than a control, and the meal looked unsellable.
  Every row now carries **the same switch**: turning it on unfolds the moments served (captioned
  « Choisissez les moments servis » while none is picked), turning it off clears them and cancels the
  sale. Prices, billed units (`moments × personnes servies`) and re-opening a committed check-in are
  unchanged.

### Migration
- **`reservations`** gains four columns (`depositPaidCash`, `balancePaidCash`,
  `depositPaidAtArrival`, `balancePaidAtArrival`), all defaulting to 0: the two « caisse interne »
  flags for the deposit and the balance, plus two markers recording that the arrival SAS collected
  that item. No existing data is changed. A stay collected into the caisse interne leaves the
  accounting **and** the Suivi financier revenue, exactly like a complement paid in cash.

## [2.7.1] - 2026-08-29

### Summary
- Le linge de lit du Gîte, compris dans le prix, ne réapparaît plus à 70 € quand vous validez le départ : un geste offert reste offert.
- Une prestation offerte au départ retrouve son vrai prix quand vous revenez dessus, au lieu de 0 € ou d'un centime de trop.

### Fixed
- **A geste commercial made at check-in was billed back at check-out.** `offeredArrivalExtras` is an
  authoritative set: a recalled arrival line absent from it goes back to billed — that is what makes
  un-offering work on a re-open. But the check-out recap only recalls the arrival complement when
  something is still owed on it, and **a complement made entirely of gestes commerciaux is worth
  0 €** — precisely when nothing is rendered. The recap showed no arrival line, sent an empty set
  anyway, and the server read it as « plus rien n'est offert ». On a Gîte stay the « Linge de lit »
  line — a property default offered because the linen is included in the base price — reappeared at
  70 € the moment the departure was validated. The recap now speaks only for the lines it actually
  rendered, and `commitDepartureSas` re-reads the recall condition itself, so no client version can
  reopen the hole. Un-offering at the door is untouched.
- **Offering a check-out line could lose, or overcharge, its price.** The real price of an offered
  end-of-stay line was re-derived as `qty × unitPrice`, which is not always the price. A line whose
  priced item has been renamed or deleted since carries only a label and a total: offered, it was
  stored `1 × 0 €`, so withdrawing the gesture on a re-opened check-out billed **0 €** instead of what
  the guest owed. And a line carried from mid-stay is legitimately stored « 2 × 16,67 € » for 33,33 €,
  so the same reconstruction billed **33,34 €** — a cent too much. The real total is now stored
  verbatim when the gesture is made, and read back as such; quantity and unit price stay what they
  always were, the wording of the line.

## [2.7.0] - 2026-08-28

### Summary
- La très haute saison du Gîte impose désormais 4 nuits minimum : le cœur de l'été ne se vend plus au week-end.
- Le nouveau minimum n'entre en vigueur qu'une fois la recette du Gîte ré-appliquée depuis sa page tarifs.
- Le calendrier des tarifs devient lisible : une couleur par saison, de la moins chère à la plus chère, enfin visible.
- Un pont férié ne peut plus autoriser un séjour plus court que sa saison : le 14 juillet n'ouvrait plus qu'à 3 nuits.
- Une mise à jour qui échoue dit enfin pourquoi, et la refuse sous 512 Mo de mémoire libre au lieu de mourir en silence.

### Changed
- **The Gîte's peak season demands four nights, and the tariff calendar is finally readable**
  (`gite-2027` v3.5.0). The heart of the summer no longer sells by the weekend. Seasons now carry a
  colour ranked by price — green the cheapest, red the dearest — and above all the calendar paints
  them at 55 % opacity instead of 13 %. At the old value the six seasons came out `#E3F3E3`,
  `#E9F3E3`, `#EEF1E2`… six whites two to four ΔE apart, below the threshold the eye can separate:
  no choice of colours could have fixed that, the opacity was the defect. Neighbouring seasons now
  sit ~19 ΔE apart, and the ink keeps 5.6:1 of contrast at worst against the 4.5:1 required. The
  Lodge's calendar gains from it too.

### Fixed
- **A public-holiday block can no longer allow a stay shorter than its season.** A block's minimum
  was written as-is onto the nights it lifts, including when it was LOWER than the season's: on the
  Gîte, whose peak season moves to a four-night minimum, the 14 July block imposed three — those
  three days would have been the only ones in the whole summer where a short stay got through. The
  minimum kept is now the strongest of the three — block, period, season — and it is only recorded
  when it exceeds the season's, which incidentally removes needless range splits.
- **An update that fails finally says why.** An installation that died during preparation showed
  "Command failed" and pointed at a log that had never been created — you had to read the kernel
  logs to understand. Three fixes: the full error message is kept instead of being truncated at the
  first colon, the update log is written from the start of the operation rather than by the final
  step an early failure never reaches, and an **available-memory check** joins the disk-space one in
  pre-flight. Under 512 MB available the application refuses the update and says so, instead of
  letting the kernel kill `npm ci` in silence — which happened three times running on a 648 MB VM
  with no swap. +8 server tests.

## [2.6.0] - 2026-08-28

### Summary
- Le Gîte a désormais une recette tarifaire : ses saisons, ses prix et sa dégressivité se déduisent seuls, année après année.
- Ses prix sont recalés sur ce que Gîtes de France paie réellement — l'hiver monte, l'été baisse, et le direct devient le canal le moins cher.
- Deux nouvelles saisons ne couvrent que quatre nuits : le 24 et le 25 décembre, et le 31.
- Rien n'est retarifé tant que tu n'as pas appliqué la recette depuis la fiche du Gîte.
- Avant cette première application, supprime la saison « Basse » sur la fiche, sinon l'application se bloque.
- Les réservations déjà enregistrées gardent leur prix : seules les dates non vendues suivent la nouvelle grille.

### Added
- **The Gîte's tariff becomes a recipe** (spec `tariff-recipe-gite/`). Its seasons, their prices, the
  « a week is four nights » discount curve and the rules that carve the year — May to October, the
  July and August shoulders around the summer core, the year-end block, the Christmas and New Year's
  Eve nights cut out of it, and L'Ardéchoise declared year by year — now live in one declarative
  document, so 2027 and every year after are derived instead of painted by hand. Public-holiday long
  weekends go up one rank, capped at Haute, and carry the block's own length as a minimum stay.
  **Nothing is re-priced until the recipe is applied from the property's tariff page**, and the
  « Basse » season has to be deleted there first or the apply is blocked by an April overlap.
  +6 server tests.
- **Two festive seasons of four nights in all.** « Noël » covers the nights of 24 and 25 December,
  « Nouvel An » the night of the 31st, both billed flat — no length discount applies to them. The
  nights around them stay in high season, and 27 to 29 December drops to mid: the premium sits on the
  nights that carry it and nowhere else.
- **A public-holiday raise can now stop below the top season** (spec `tariff-recipes/spec.md` §3.3
  rules 15bis-15ter). `public_holiday_bridge` capped its raise at the highest rank a recipe declared,
  which only worked because the Lodge's highest rank *is* its high season. On a grid whose top season
  is a peak-summer price, the same rule sold 25 December at the August rate. The modifier now takes an
  optional `capSeason`; absent, the ceiling stays the highest rank, so every existing recipe behaves
  exactly as before. A cap also never moves a night **down**: a night already above it — 14 juillet,
  15 août — keeps its price and takes only the block's minimum stay. +4 server tests.
- **A tariff study page for the Gîte** (`docs/tarifs/2026-08-25-gite-etude-tarifaire.html`), in the
  format of the Lodge's deployment reports: what the old grid actually said, the calendar restated as
  rules, the net pivot, the per-channel grid, the 24 stays of 2026 re-priced, and the reservations
  still to lift. It is produced by a generator that receives observed facts only and recomputes
  everything else from the recipe file, so the page can contradict whoever wrote it — its arithmetic
  self-checks print at the foot, and one failing bars it in red.

### Changed
- **The Gîte's prices are rebuilt on what Gîtes de France actually pays.** The rates that had served
  as the anchor came from a spreadsheet the owner no longer maintained, and they were its
  *Gîtes-de-France* column — the cheapest channel. Measured against real payouts, the old grid was
  +10,7 % on Gîtes de France but **−28,8 % on the platforms** and −34,8 % on direct bookings: it
  priced every channel at the level of the cheapest one. The net floor is now **measured** — a
  least-squares fit over 15 Gîtes-de-France stays — and every channel is grossed up from it. Gîtes de
  France keeps the prices it charges today; the direct channel carries a small uplift so it lands
  level with the cheapest channel while still paying only 5 %, which is where the extra margin on a
  direct booking comes from. Winter rises and summer falls: a February weekend goes 504 € → 638 €,
  mid-July 1 074,50 € → 904 €.
- **The « Basse » season is gone.** Not by taste but by measurement: the owner's own payouts give it
  286 € against 288 € for Très basse — two seasons that cannot be told apart, one of which covered
  April alone. Four ordinary seasons remain.

### Fixed
- **Applying a recipe was not idempotent when a season's label carried a capital letter.**
  `sentenceCase` rewrote « Nouvel An » as « Nouvel an » on write, so the next preview saw a label
  change that could never be satisfied: every horizon check rewrote all the seasons and stamped a line
  in the tariff journal — the very data a tariff change is measured against. Recipe labels are
  authored and reviewed, so they now keep their casing.
- **An échéance holds what the guest pays, not the net of the commission.**
- **Why Booking drops the length discount, and what to do instead** (documentation). A promotion —
  pushed by the channel manager or created in the extranet — sits above the rate, and Booking does not
  consult that layer for a property whose rates arrive from a connectivity provider. What it honours
  is a **derived rate plan**, which takes the pushed rate as its base, subtracts a percentage and
  carries its own minimum length of stay. The hole is expensive: in mid season a week shows at
  2 492 € instead of 1 424 €. Nothing is applied yet — the procedure is recorded for the rollout.

## [2.5.0] - 2026-08-24

### Summary
- Comptabilité : chaque écriture reprend l'argent réellement encaissé, ventilé là où il l'a été.
- Réservations plateforme : le brut n'est plus amputé de la taxe de séjour quand la plateforme la reverse.
- C'est vous qui décidez quand un complément est perçu, par un bouton, à n'importe quel moment du séjour.
- Ce qui est vendu après un complément d'arrivée encaissé part au départ, au lieu de disparaître.
- Une option ajoutée avant le check-in rejoint le complément d'arrivée ; les séjours touchés sont corrigés au démarrage.
- Le calendrier n'affiche plus qu'une entrée par plateforme, quelle que soit la casse enregistrée.

### Changed
- **The moment a complement is collected is now the operator's call, not an inference**
  (specs/complement-buckets-by-moment.md §3 rule 4, revised + specs/defer-arrival-complement-to-checkout.md §3.3).
  The fiche used to decide on its own: from the arrival day, an uncollected arrival complement moved
  under « fin de séjour », merged the cards and **locked** the control that would have put it back.
  It is now the « Percevoir en fin de séjour » decision, and only it, that merges the two cards — and
  that decision is available at any moment, before, during and after the stay, including on a
  complement already marked collected (deferring one asks for confirmation and puts the money back to
  collect). The day-of-operations alerts keep reading the real bucket states, because « what is still
  to collect today » is a fact rather than an intention.
- **That control is a button, not a discreet switch.** A MUI switch tucked between the amount field
  and the payment buttons went unseen — the report was literally « there is no *percevoir en fin de
  séjour* button », about a screen that had one. It now looks like its neighbours: full width,
  bordered when off, filled and reading « Perçu en fin de séjour ✓ » when on.
- **Arrival and end-of-stay complements sit side by side.** They were ordered by moment of collection,
  so « Complément durant le séjour » — often just a « + Nouvelle note » button — took the right-hand
  slot and pushed « fin de séjour » onto the next row. The two cards money actually moves between now
  come first, together; the note register follows.
- **A settled mid-stay note can be moved to the departure collection**, through an action that says so
  — « Reporter au départ » replaces « Annuler l'encaissement ». Same mechanics (its prestations go
  back to what is due at check-out), a name that matches why an operator does it.

### Fixed
- **Accounting books the money actually collected, where it was collected.** A stay selling a
  prestation mid-stay had every one of its entries inflated — on a real case, the client account was
  debited 599,24 € for a 573,77 € transfer. A complement settled in the internal till was fed back
  into the balance, and every collection was credited a pro-rata share of *all* the reservation's
  options and resources, including those collected at another moment. Prestations and activities now
  land on their own account, at the real amount.
- **A platform's gross is no longer cut by the tourist tax it collects itself.** When the platform
  levies and remits the tax (Gîtes de France, Booking, Airbnb), the amount typed into « Paiement
  plateforme » was reduced by it, and so were both the commission and the revenue — on the booking
  the accountant flagged, a 65,00 € commission was booked as 50,60 € and 733,00 € of revenue as
  718,60 €. The field now states which amount to copy across, according to the platform's tax mode.
- **Money sold on a settled arrival complement no longer disappears**
  (specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 3bis). On a reservation whose arrival
  complement was already collected, adding a 30 € option raised the « total du séjour » by 30 € while
  the échéances stayed put: the engine freezes a collected complement, so the sale could not go
  there — and the mid-stay routing that would have sent it to the departure was gated on the stay
  having started, so it went nowhere at all. Collecting the arrival complement now **closes** it, at
  any date, exactly like the start of the stay does: whatever is sold afterwards lands in the
  end-of-stay complement, and every euro of the stay is claimed by an échéance again.
- **The end-of-stay complement card shows the sale immediately.** It rendered the stored amount, so
  an option added on a settled complement vanished from the screen until the next save. It now renders
  the live quote — same amount, same lines, same « Calcul auto » hint as what the save will write.
- **An option added by hand before the check-in joins the arrival complement**, not the end-of-stay
  one. What opens the « sold mid-stay » window is now the arrival as observed — the check-in box or
  the arrival SAS — rather than the calendar date alone.
- **A complement can be adjusted right down to its tourist tax** (specs/adjustable-complement-amounts.md
  §3.6 rules 32-34). The floor was `accommodation + tourist tax`, which in practice blocked the
  platform bookings the feature was built for — their complement is mostly an accommodation auto-gap,
  so the field refused almost every value. Prestations still absorb first, pro rata; the accommodation
  share now gives way once they are exhausted; the tourist tax alone stays untouchable, so the
  accounting entry and the tax declaration can never disagree.
- **Un-marking a collected arrival complement now takes effect immediately**
  (specs/defer-arrival-complement-to-checkout.md §3.3 rule 16ter). « Marquer complément payé » only
  called the server on a *locked* reservation; everywhere else it changed the form and waited for a
  « Enregistrer », while every neighbouring button — « Caisse interne », the end-of-stay card, the
  check-out switch — wrote straight away. Form and database then disagreed, and the database is what
  decides whether the two cards merge: un-marking a payment and then deferring merged nothing. That
  mismatch also explains the « impossible » screen reported earlier — the control visible (form) next
  to two separate cards (server).
- **A prestation is no longer listed twice on the merged card.** A line routed to the end-of-stay
  complement mid-stay was still listed at full price on the arrival side, so the merged card showed it
  once per side and its lines no longer summed to the total. The arrival detail now deducts the part
  that moved, exactly as the engine and the accounting do.
- **The merged « complément de fin de séjour » card follows the quote live**
  (specs/defer-arrival-complement-to-checkout.md §3.2 rule 7bis). It rendered the block stored at the
  last save: remove a repas des trappeurs and the summary panel dropped by 25 € while the card kept
  the old line and the old total — two figures for the same money on one screen, with only the card's
  « Calcul auto » helper up to date. The live quote now ships the merged block itself (arrival detail
  emitted by the engine, mid-stay share deducted; end-of-stay lines recomputed), so the card and the
  summary read the same numbers by construction.
- **A platform is listed once in the calendar, whatever its stored casing**
  (specs/normalize-platform-names.md, addendum 2026-08-24). The legend showed « Abracadaroom » **and**
  « abracadaroom », two swatches for one channel. The cause was at the write site: the iCal sync stored
  the feed *slug* (`abracadaroom`, `gites-de-france`) as the reservation's platform, where a manually
  created booking carried the canonical name. Every restart healed the drift and every sync re-created
  it — and production runs for weeks between restarts. The sync now writes the canonical name (the slug
  stays in the column that identifies the feed), and the boot cleanup additionally normalises
  reservations whose spelling matches no catalogue row, adopting the catalogue's spelling rather than
  inventing a variant of it.
- **The rule holds for every platform: case is not identity.** The legend merges the variants of one
  name and sorts them alphabetically — so it no longer reshuffles as months load — and each name reads
  with a leading capital, inner capitals untouched (« GitesDeFrance » stays as it is, « BOOKING »
  becomes « Booking »). The platform chips elsewhere in the app (accounting, finance, clients,
  payments) read that same label, so they can no longer contradict the legend.

### Migration
- Automatic cleanup at startup: the « arrival extras baseline » that had been set from the arrival
  date alone is cleared on stays with no check-in, no arrival SAS and no collected complement.
  Without it, the reservations already affected would keep sending their options to the end-of-stay
  complement. No stay that has already collected anything is touched.

## [2.4.0] - 2026-08-22

### Summary
- Le complément d'arrivée se bascule en fin de séjour depuis la fiche, sans attendre le check-in.
- Chaque complément accepte un montant ajusté — celui annoncé au client — même après encaissement.
- Un complément ajusté est comptabilisé au montant annoncé : la taxe de séjour ne dérive plus.
- La fenêtre de mise à jour liste toutes les versions sautées, plus seulement celle qu'on installe.
- L'offre de mise à jour devient une pastille lisible dans la barre du haut, au lieu d'une icône nue.
- Rien ne tourne plus en arrière-plan pour l'envoi automatique des emails tant qu'il est désactivé.

### Added
- **The fiche can now move the arrival complement to check-out, and set what any complement is worth**
  (specs/defer-arrival-complement-to-checkout.md §3.3 + specs/adjustable-complement-amounts.md). A
  « Percevoir en fin de séjour » switch on the arrival complement card writes the same marker the
  arrival SAS recap writes, so the decision no longer has to wait for check-in: the fiche merges the
  two cards, the summary panel files the money under « fin de séjour », the day-of-operations views
  drop the arrival alert, and the J-2 / J-1 emails announce « à votre départ » instead of « à votre
  arrivée ». Reversible until the guest is in.
- **Every complement carries an adjustable amount** (specs/adjustable-complement-amounts.md §3). A
  complement is announced to the guest before it is collected, and the announced amount is the one
  that changes hands — so the arrival complement, the end-of-stay complement and each settled
  mid-stay note can be frozen at what was said, **including after collection**, which used to need a
  hand-written SQL statement in production. An empty field hands the bucket back to the engine.
  The arrival SAS no longer overwrites an adjusted amount when it commits.

### Changed
- **The complement blocks of the fiche sit two per row on a desktop**
  (specs/adjustable-complement-amounts.md §6.5). Each card used to build its own single-column grid,
  so « Complément d'arrivée », « Complément durant le séjour » and « Complément de fin de séjour »
  stacked down the left half of the screen with the right half empty. They now share one grid: two
  per row from `md`, still stacked full-width on mobile.
- **Nothing runs in the background for automatic sending until it is switched on**
  (specs/no-automatic-email-without-approval.md §3 rule 2b). The Réglages switch ships off, but the
  daily 08:00 pass stayed scheduled all the same: every minute from 08:00 to midnight it opened,
  re-read the setting and left again — some 960 empty passes a day. The timer is now registered only
  while automatic sending is authorised. Turning the switch on starts it **and** runs the day's pass
  immediately, without restarting the application; turning it off stops it at once. The guard that
  refused to send stays where it was, inside the pass. (+5 server tests, net.)
- **The "update available" offer is now visible in the top bar**
  (specs/self-update-and-releases.md §6.5, rule 20b). Next to the installed version, a bare
  primary-tinted icon announced a published release — and read as chrome, so it went unclicked. It
  becomes a rounded pill: soft fir-green background, update icon, a count, tooltip
  « GuestFlow X.Y.Z est disponible ». Same click, same release notes, same behaviour on « Plus tard »
  and while an update runs. The shape lives in a new generic `HeaderPill` component, so the next
  top-bar indicator does not hand-roll its own. (+3 client tests.)
- **The update dialog now shows every version between the one installed and the one on offer**
  (specs/self-update-and-releases.md rules 12b + 20d). It used to show the release notes of the
  target and nothing else, which told the whole story only when no release had been skipped — an
  operator who postponed once, or whose host was offline for a day, jumped 2.1.0 → 2.3.0 and was
  never told, anywhere in the application, what 2.2.0 changed. The hourly check now reads the
  release *list* instead of `/releases/latest` (same single HTTP call) and the dialog lists each
  version's digest under its own heading, with a « 3 versions depuis la 2.0.0 » caption and every
  version's full changelog behind the existing toggle. A single-version update looks exactly as it
  did. The target is still chosen exactly as before — newest published release, archive and
  `SHA256SUMS` included — so a broken publish still offers nothing rather than falling back to an
  older version. (+10 server tests, +5 client tests.)

### Fixed
- **An adjusted complement is booked at the amount that was announced, poste by poste**
  (specs/adjustable-complement-amounts.md §3.6). The fiche decides and stores the ventilation
  (`70600000` / `70600010` / `70601000`, tourist tax and accommodation untouched) and the export only
  splits TTC into HT + VAT. Three mechanisms would otherwise have silently corrupted the entry: the
  export's residue nudge, which lands on the **last** credit line — the `46710000` tourist tax (a
  93,60 € complement announced at 85 € would have declared 1,00 € of tourist tax); the re-derived tax
  share; and the gross-up ratio, which took the complement into its denominator and therefore
  re-inflated both the complement entry and the acompte / solde entries of the same reservation.

### Migration
- `reservations` gains `complementAmountOverride` and `endOfStayComplementAmountOverride` (REAL, NULL
  = automatic, i.e. today's behaviour) plus `complementAllocation` (TEXT, JSON, NULL = the accounting
  postes are derived exactly as before). Nothing is rewritten at boot: existing reservations keep
  their amounts and their accounting entries to the cent.

## [2.3.0] - 2026-08-22

### Summary
- Taxe de séjour : l'assiette redevient la nuit sèche, nette du ménage et du linge compris dans le tarif.
- Un bébé compte comme occupant dans l'aperçu de la fiche, comme il l'a toujours fait à l'enregistrement.
- Le suivi de taxe de séjour déclare désormais à la commune exactement le montant que la fiche affiche.
- La fenêtre de mise à jour ne montre plus que ce résumé ; le changelog complet reste à un clic.
- Le passage email de 08:00 n'inonde plus le journal quand l'envoi automatique est désactivé.
- Réglages : la page « Design system » disparaît. Aucun écran que vous utilisez ne change.

### Added
- **Tourist-tax tracking — the pre-tax night per occupant, and the same amount as the fiche**
  (specs/tourist-tax-included-services-deduction.md §3 rules 14-16). The declaration table gains a
  « Nuit HT / occupant » column: the base percentage-rate tax forms ask for, taken as-is from the
  reservation fiche (« — » on a property charging a fixed rate per adult per night). More
  importantly, the page used to **recompute** its tax without the included-services deduction: a stay
  could be confirmed at 13,05 € on the fiche and declared to the council at 14,85 €. Both figures now
  come from the same function, and « Montant hébergement HT » is net of the services included in the
  rate.

### Changed
- **Tourist-tax tracking declares exactly what the fiche shows**
  (specs/tourist-tax-included-services-deduction.md §3 rule 14). The page no longer does its own
  price arithmetic: it **replays the tariff engine** over each stay, from the stored reservation, the
  freeze on past stays included. Its home-grown maths had drifted from the fiche's — a stay could be
  confirmed at 13,05 € and declared at 14,85 €, and eight of the Lodge's eleven August stays were off
  by anything from a few cents to two euros. What stays the page's own: **which** stays it lists
  (attribution month, settlement, platform mode) and the pro-rata of refunded nights.
- **The update dialog gets to the point.** It used to render the whole changelog — for 2.2.0, about a
  hundred lines of prose standing between the operator and the « Installer » button, which is prose
  nobody reads and a migration warning nobody sees. Every release now publishes a short digest,
  written in French, and that is all the dialog shows; the full detail stays one click away behind
  « Tout le changelog ». Releases published before this change carry no digest and display exactly as
  they used to, with no toggle. The guard rail sits on the publishing side: a version whose digest is
  missing, still a TODO, or longer than six lines cannot be released at all.
  (specs/self-update-and-releases.md rule 20c, +6 server tests, +6 client tests.)
- **The welcome pack's covered value moves to the amounts column** (specs/welcome-pack-auto-options.md
  §6). On a pack line, the struck-through price of the units covered by the rate sat under the
  « + compl. » chip, where it read as a label; it now sits on the right, in grey and smaller, just
  above the 0,00 € it explains. The « dont N inclus dans le tarif » count stays on the left.

### Fixed
- **Tourist tax — the base is the dry night, net of the services included in the rate**
  (specs/tourist-tax-included-services-deduction.md). At the Lodge, cleaning and linen are billed
  *inside* the night: their reference value is once again taken off the accommodation price before it
  is divided by the number of nights (18,00 € → 15,00 € on a 3-night stay at 359,79 €). The deduction
  2.2.0 removed comes back without its two defects: it is a **flat amount per stay**, computed on the
  guests included in the rate (2 at the Lodge), so it no longer shrinks as the party grows, and
  « Comprise » lines can no longer be unticked or lost on save — on the fiche as on the server, for
  reservations and for quotes. The platform gross stays out of the calculation, paid extras stay
  inert, and past stays stay frozen. The summary reads « Base : 359,79 € − 60,00 € de prestations
  comprises » again. (+14 server tests, +3 client tests.)
- **A baby is an occupant in the fiche's live preview too**
  (specs/tourist-tax-included-services-deduction.md §3 rule 16). The tax divides the night by the
  occupants, babies included. Saving always did that; the fiche's live preview did not — neither the
  form nor `calculatePrice` passed `babies` along, so a stay with a cot displayed a tax divided by one
  head fewer than the one it saved (16,38 € on screen, 13,05 € declared, on a Lodge booking). Preview,
  save and declaration now agree.
- The daily 08:00 email pass no longer floods the server log while automatic sending is off. Because
  a blocked pass deliberately gives the day's slot back — so that authorising automatic sending at
  14:00 takes effect at 14:01 rather than tomorrow — it was retried, and logged, every minute from
  08:00 to midnight: around 960 identical lines a day, in the setting's default state. The retry
  stays; the line is now printed once a day. (specs/no-automatic-email-without-approval.md rule 9,
  +4 server tests.)

### Removed
- **Réglages → « Design system » is gone.** The `/design` page — swatches, type specimens and a
  catalogue of the shared components — showed how the application is built, not anything you could act
  on, and it took a slot in an already crowded Réglages menu. The design system stays where it belongs:
  a written reference (`specs/design-system-reference.md`) read when the code is written. No screen you
  use changes.

## [2.2.0] - 2026-08-20

### Added
- **No guest email leaves without your approval.** Two mechanisms could write to a guest with nobody
  having read the message first: the daily 08:00 pass, which sent every template set to
  « Automatique », and the booking confirmation, dispatched as soon as an online payment cleared. A
  setting — *Réglages → Envoi automatique des emails* — now decides whether GuestFlow is allowed to
  do that, and it is **off** by default. While it is off, those emails are no longer sent: they are
  **proposed** in « Emails à envoyer », where you read them over and send them with one click.
  Nothing is lost on the way — an « Automatique » template that comes due joins the queue instead of
  vanishing, and a paid booking's confirmation waits for you there. The Emails page says so plainly:
  a banner explains the situation, and the templates concerned carry « Auto désactivé » instead of
  « Auto ». Your own booking notifications and the account emails (forgotten password) are not
  concerned: they keep their behaviour and their own dedicated setting.
  (specs/no-automatic-email-without-approval.md, +35 server tests, +16 client tests.)

### Changed
- **The top bar names the installed version, and the update is one click away.** In place of the old
  `prod <sha>` badge — a build identifier nobody could tie to an actual change — the application now
  displays its version number, the same one quoted by the changelog, the GitHub release and the
  update dialog. When a new version is published, a download icon appears beside it and opens the
  release notes from any page, with the « Installer maintenant » button. The icon survives a
  « Plus tard » on the dashboard (postponing means not being asked again, not losing the way there)
  and disappears while an update is running. Admins only, like the rest of `/api/system/*`.
  (specs/self-update-and-releases.md §6.5 rule 20b, +7 client tests.)
- **Cancellation insurance is priced by the night.** An amount in euros, set in Réglages → Options
  and per property when needed, replaces the percentage of the stay, and the option now reads right
  after « Départ tardif » in the list — on the reservation fiche as on the Réglages → Options
  screen. The percentage of the stay stays available for whoever prefers it.
- Cancellation insurance no longer carries a « Qté » field on the fiche: it covers the whole stay,
  whatever its price type, and the server bills the rate × the number of nights.

### Fixed
- **A finished update now says so.** Installing 2.1.0 worked — new version swapped in, healthy, data
  intact — but the progress overlay never closed, and reloading the page brought it straight back.
  The process that performs the swap was being killed by the very restart it triggers: PM2 stops an
  application together with all of its descendants, and that process was one of them. It is now
  started outside the application's process tree, so it survives the restart and reports the outcome
  as it was always meant to. As a second line of defence, GuestFlow also concludes an update by
  itself at startup — if the version that came up is the one that was being installed, the update is
  recorded as finished rather than left spinning. The same defect meant the automatic return to the
  previous version could not run at all: had 2.1.0 failed to start, nothing would have put 2.0.0
  back. That safety net works again. (specs/self-update-and-releases.md rules 28 and 30b, +8 server
  tests.)
- **The tourist tax is based on the accommodation, and nothing else.** On percentage-based properties
  such as the Lodge, the base is now the accommodation amount alone — the nights from the tariff
  grid, after a discount or a « Prix hébergement ajusté ». Adding an option or a resource, offering
  it, or moving it into « Complément » no longer shifts the tax by a cent.
  (specs/tourist-tax-base-accommodation-only.md)
- Two behaviours are repealed along the way: the base is no longer derived from the **platform
  gross** — moving a line into « Complément » used to change the tax you declare — and the
  **services included in the rate** (cleaning, linen) are no longer subtracted from it; that
  deduction was pro-rated on the number of guests and only applied once the line had been ticked.
- Stays already past keep their amount: the freeze on past taxes is unchanged, and only ongoing or
  future reservations and quotes recompute, on their next save.

### Migration
- Cancellation insurance: at startup, an insurance that is still **unpriced** (0 % and no per-property
  price) switches automatically from « % du montant du séjour » to « Par jour ». A percentage already
  entered is never touched.
- **New column `app_settings.emailAutoSendEnabled`** (integer 0/1, default `0`), added automatically
  at startup. No existing data is modified. **Behaviour change on update:** automatic sending is off
  on existing installations as well as on new ones. If templates were set to « Automatique », they
  stop leaving on their own and are proposed in « Emails à envoyer » instead; to get automatic
  sending back, switch the setting on in *Réglages → Envoi automatique des emails*.

## [2.1.0] - 2026-08-20

### Added
- **The quote now says what the payment buys.** On a direct-channel quote, the « Acompte » row carries
  the sentence the deposit-request email already used — *« Le règlement de l'acompte bloque vos dates :
  tant qu'il n'est pas payé, elles restent disponibles et peuvent être réservées par un autre client »*
  — in French and in English. A guest used to read a deadline without ever being told what it was for.
  Platform quotes are untouched: there, the platform holds the dates. (specs/deposit-blocks-the-dates.md)
- **Full-payment requests.** A new email template « Demande de paiement intégral (lien de paiement) »
  (FR/EN), and the devis action renamed « Envoyer la demande de paiement »: the server decides what to
  ask for — the acompte when there is one, the whole stay otherwise — and the email quotes, to the cent,
  what the Qonto link charges. A last-minute quote used to hit a dead end there, since asking for a 0 €
  acompte is refused. (specs/deposit-blocks-the-dates.md)

### Changed
- **A stay starting within 30 days no longer carries an acompte — it is paid once.** When a direct
  quote or reservation is created while the stay already falls inside the property's « solde X jours
  avant » window (30 days), the deposit drops to 0 and the whole stay is due in a single payment, on
  the quote's own validity date. Until now such a quote asked for an acompte due on its validity date
  *and* a solde due the day it was written — two contradictory deadlines. The switch is decided on the
  booking day, so a quote never changes its terms as it ages, and it yields, in this order, to a
  deposit already collected, a deposit explicitly disabled, and a deposit you set by hand. Platforms
  are not concerned. No existing record is rewritten: the rule applies to creations and recomputes.
  (specs/deposit-blocks-the-dates.md, implementing specs/online-payments-qonto.md §3.7)

### Fixed
- Devis PDF: the security-deposit amount no longer overprints its own label. On an English quote,
  « Security deposit: » came out as « Security deposi500,00 € ». Every row of the payment-terms block
  now opens its amount column after its own label, whatever the language.
- Devis PDF: an option label too long for one line no longer overflows onto the row below it — each
  pricing-table row is now as tall as what it prints (`specs/devis-pdf-row-layout.md`).
- Devis PDF: on an offered line, the « Offert » badge now sits on its own line above the label
  instead of touching it.
- The release archive now carries the repository's `scripts/` directory, so
  `~/guestflow/current/scripts/bootstrap-vm.sh` — the path the README tells an operator to run —
  actually exists on an installed host. The first 2.0.0 install needed that script copied over by
  hand.

## [2.0.0] - 2026-08-20

### Added
- **GuestFlow updates itself, when you tell it to.** A published version now shows up on the
  dashboard and in Réglages → Système et mises à jour, with its release notes readable in the app.
  One click downloads the archive, checks its SHA-256 against the one published with the release,
  installs the dependencies, verifies that the native database driver loads, takes a WAL-safe backup
  of the database, swaps the deployment and restarts. If the new version does not answer within two
  minutes, the previous one is put back automatically. The browser follows the whole thing on a
  progress overlay and reloads itself when the new version is up. Admins only; nothing is ever
  installed without an explicit click. (specs/self-update-and-releases.md)
- **Versioned releases.** Pushing the tag `vX.Y.Z` on `master` builds and publishes a GitHub release
  — archive, checksums and the WordPress plugin — from a GitHub-hosted runner. The workflow refuses
  to publish unless the tag, the three `package.json` versions and the `CHANGELOG.md` section agree,
  and unless the server, client and end-to-end suites are green. The new `/guestflow-release` skill
  drives the whole sequence. (specs/self-update-and-releases.md)

### Changed
- The release archive is now a `.tar.gz` instead of a `.zip`, published with its SHA-256. The
  updater refuses any archive member that is a symbolic link, an absolute path or a `..` traversal.

### Removed
- **The self-hosted CI runner and the `release` deployment branch are gone.** A push on `release`
  used to run a workflow on a GitHub Actions runner installed on the production machine — an agent
  executing code from a public repository, on the host that holds the guest database, the encryption
  key and the session secret. Production now only makes outbound calls to GitHub and installs a
  release when its operator asks for it. (specs/self-update-and-releases.md §1.2)

### Migration
- **Deployment layout (production hosts only).** `~/guestflow/current/` becomes a symbolic link into
  `~/guestflow/releases/<version>/`, and the PM2 environment moves into a persistent
  `~/guestflow/ecosystem.config.js`. Uploaded files move next to the database and the secrets in
  `~/guestflow/data/uploads/`, and every installed release links back to them. Run
  `bash ~/guestflow/current/scripts/bootstrap-vm.sh` once on the host, as the user that owns the
  deployment; it moves the uploads and never touches the database or the secrets. Until it has run, the
  app reports that it cannot update itself and says why. The GitHub Actions runner must then be
  uninstalled from the host — the script prints the commands.

## [1.0.0] - 2026-08-19

_Everything GuestFlow shipped before it was versioned: the work already running in production when
the release pipeline landed, dated at the Proxmox migration. Kept as one section rather than
discarded — it is the only record of those four months._

### Added
- **Arithmetic input on reservation price fields** (spec
  `reservation-price-arithmetic.md`, 2026-06-08). The « Prix hébergement
  ajusté » and « Prix payé par le client » fields now accept arithmetic
  expressions (`100+20`, `(100+20)*2`, French comma OK): on Enter or blur
  the expression is evaluated and the result set (rounded to 2 decimals,
  clamped ≥0); invalid input reverts. New safe (no-`eval`) evaluator
  `utils/arithmetic.js` + reusable `ArithmeticTextField` component.
  +15 client tests.
- **Dashboard card — new iCal reservations imported today** (spec
  `dashboard-ical-new-reservations.md`, 2026-06-08). A read-only blue
  card on the dashboard lists every reservation imported via iCal during
  the current (UTC) day — guest, property, platform/source, stay dates,
  and a relative "imported X ago". Clicking a row opens the reservation
  page. The card auto-rolls daily (no acknowledge / no new table) and is
  hidden when nothing was imported. New `GET /api/dashboard/ical-new-today`
  + `IcalNewReservationsAlert` component. +7 server tests, +5 client tests.
- **Mobile-friendly calendars** (spec `calendar-mobile-view.md`,
  2026-06-08). On phones (`xs`), the reservation calendar (`/calendar`)
  shows a new **week view**: one week per full-width page with the 7 days
  as readable vertical rows (arrival / departure / ongoing stay / devis /
  closure / note), and **horizontal swipe to move between weeks**. Desktop
  keeps the month grid unchanged. The property mini-calendars now scroll
  horizontally on a phone instead of squishing. New `CalendarWeekView`
  component + pure `calendarDaySummary` helpers.
- **Bilingual devis PDF (FR / EN)** (spec
  `devis-english-language.md`, 2026-06-06). The devis edit page gains a
  small **FR / EN** toggle next to the Statut select; the choice is
  persisted on the row (`reservations.pdfLanguage`, default `'fr'`) and
  drives the `GET /api/devis/:id/pdf` rendering. Every literal the PDF
  prints flows through `utils/devisPdfLabels.js` (one source of truth
  for both languages, with FR ↔ EN key parity asserted by unit tests).
  Dates render in `dd/mm/yyyy` for FR and `D MMMM YYYY` for EN
  (unambiguous internationally) via a new `formatDateLocalised` helper.
  **Translated options & resources.** Options gain a single `titleEn`
  column (no `descriptionEn` — the option description isn't printed in
  the devis PDF, only the title is). Resources gain `nameEn`. The
  OptionsPage and ResourcesPage forms expose the EN inputs side-by-side
  with the FR ones; empty values fall back to the FR text at render time
  so existing prod data keeps producing usable PDFs. The **5 typed-
  default options** seed their EN title at boot — both on fresh installs
  and as an idempotent backfill on prod servers that promoted before
  the column existed:
  | autoOptionType | titleEn |
  |---|---|
  | `bed_linen` | Bed linen |
  | `bathroom_linen` | Bath linen |
  | `breakfast` | Breakfast |
  | `early_check_in` | Early check-in |
  | `late_check_out` | Late check-out |
  The default `Lit bébé` resource seeds with `nameEn = 'Baby bed'`.
  **Footer.** A new `quoteFooterTextEn` setting sits beside the existing
  `quoteFooterText` in `/settings`; each language uses its own custom
  footer when set, else a sensible static default in the matching
  language (no cross-language fallback — an EN PDF showing French
  copy would read as broken).
  **Coverage.** +52 server-side cases (`devis-pdf-labels`,
  `devis-helpers-date-en`, `devis-pdf-en`, `devis-model-pdf-language`,
  `options-resources-en-fields`, `seeds-en-translation`) + +16 Vitest
  cases (`SettingsQuoteSection.bilingual`,
  `devis-en-language-payload`). Server suite stable at ~1115; client
  suite 284 → 300 green.
  **Migration.** `reservations.pdfLanguage TEXT NOT NULL DEFAULT 'fr'`,
  `options.titleEn TEXT NOT NULL DEFAULT ''`,
  `resources.nameEn TEXT NOT NULL DEFAULT ''`,
  `app_settings.quoteFooterTextEn TEXT DEFAULT ''`. Additive; no row
  rewrites. The model factories (`devisModel`, `optionsModel`,
  `resourcesModel`, `settingsModel`) detect missing columns at build
  time and gracefully drop the references — so minimal test schemas
  that haven't added the columns still run unchanged.
- **Email signature uses the sender name, not the legal name** (spec
  `email-automation.md` §3 rule 14, 2026-06-08). New `{{senderName}}`
  token = Settings → Envoi d'emails → « Nom expéditeur »
  (`smtpFromName`, falls back to the « Raison sociale » `companyName`
  when blank). The seeded J-7 reminder now signs with it; a boot
  migration upgrades the old `{{companyName}}` signature on existing
  installs. `{{companyName}}` stays available for templates that want
  the legal name.
- **Property name with the correct French article in client emails**
  (spec `email-automation.md` §3 rule 13, 2026-06-08). Each property
  carries an operator-chosen article (`au` / `à la` / `à l'` / `aux`,
  field on the property detail form with a live preview), and the new
  `{{propertyWithArticle}}` template token renders « votre séjour au
  Gite / à la Tente / à l'Aventura Lodge » (the apostrophe form elides).
  The seeded J-7 reminder now uses it in its subject + opening line.
- **Client emails — templates, scheduled send + manual review** (spec
  `email-automation.md`, 2026-06-07). GuestFlow can now communicate
  with future guests via plain-text emails.
  Reuses the existing SMTP path (the one used for admin first-connection
  emails): single `emailService.send`, single `From:`, no new transport.
  **Templates library.** New `/emails/modeles` page with full CRUD on
  the `email_templates` table (sortable list + edit dialog with a
  variable / conditional picker). Every template carries a `dayOffset`
  (signed integer, J-7 = 7 days before `startDate`), a `sendMode`
  (`'auto'` or `'manual'`) and an `enabled` flag.
  **Variables** supported in subject + body (28 tokens listed in spec
  §4.4): client (firstName / lastName / fullName / email / phone /
  address), reservation (startDate / endDate / checkInTime /
  checkOutTime / nights / adults / teens / children / babies /
  totalGuests), property (propertyName), financial (finalPrice /
  depositAmount / depositDueDate / balanceAmount / balanceDueDate /
  cautionAmount), lists (optionsList / bedConfig), company info.
  **Conditional blocks** — single level: `{{#if hasBedLinenOption}}…
  {{else}}…{{/if}}`, `{{#if cautionNotBanked}}…{{/if}}`, `{{#if
  hasOptions}}…{{/if}}`. Unknown variables render as empty string;
  malformed `{{#if}}` blocks are passed through verbatim so the
  operator sees the literal text in preview.
  **Default template registry** (`utils/defaultEmailTemplatesRegistry.js`)
  — single source file holding every shipped default template as a
  self-contained object (`stableKey`, `name`, `subject`, `body`,
  `dayOffset`, `sendMode`, `enabled`). Adding a new default email is
  **one file change**: append an object + a one-line test case. No DB
  migration. Designed so AI-assisted additions stay trivial. The PR
  ships exactly one default: **"Rappel arrivée — J-7"** (manual mode,
  warm-but-professional, dynamically includes the bed-config block if
  the bed-linen option is ticked + the caution-check reminder if no
  bank deposit was made).
  **Boot-time seed** (`utils/defaultEmailTemplatesSeed.js`) iterates the
  registry; INSERTs by `stableKey` when missing. Idempotent +
  non-destructive: operator edits to a previously-seeded row survive
  across boots. A deleted seeded row gets re-inserted on next boot.
  **Hybrid trigger model.**
  - **Auto templates** ship daily at 08:00 local time via a new tick in
    `scheduledTasks.js` → `utils/emailAutoSendRunner.js`. Each
    matching `(template, reservation)` pair fires exactly once; skipped
    pairs already in `email_log` with `status='sent'`; devis excluded;
    failures logged with the error message.
  - **Manual templates** surface on a new **dashboard widget** with the
    count of pending emails. The widget renders nothing when the queue
    is empty. Clicking opens `EmailPendingDialog` listing every pair;
    each row offers "Voir & envoyer" (preview + edit + send) or
    "Ignorer" (logs an `acknowledged-skip` row so the pair drops out).
  - **Manual send from a reservation page** — new "Envoyer un email"
    action in the reservation's action bar (hidden in devis mode).
  **History page** `/emails/historique` lists every `email_log` row
  (paginated, filterable by status / template / reservation) with a
  read-only preview dialog showing the rendered subject + body + error
  message when failed.
  Total coverage: **92 server cases** (`email-template-renderer`,
  `email-context-builder`, `date-fr`, `default-email-templates-
  registry`, `default-email-templates-seed`, `email-templates-model`,
  `email-log-model`, `email-templates-controller`, `emails-controller`,
  `email-auto-send-runner`). Server suite 1068 → 1160. **18 Vitest
  cases** (`EmailLogViewDialog`, `EmailPendingAlert`, `EmailManualSendDialog`,
  `EmailTemplatesPage`).
  **Migration.** Two new tables (`email_templates`, `email_log`), both
  idempotent at boot, additive only. No existing data touched.
- **Breakfast option + per-day planning card** (spec
  `breakfast-option-and-planning-card.md`, 2026-06-05). `Petit
  déjeuner` joins `Linge de lit` and `Linge de toilette` as the third
  typed-default catalog option — seeded at every boot (`autoOptionType
  = 'breakfast'`, `priceType = 'per_person_per_night'`, `price = 0`)
  via `utils/breakfastSeed.js`. The seed promotes any existing
  operator-created `Petit déjeuner` / `Petit-déjeuner` row to the
  typed marker, so prod servers gain the feature without manual
  cleanup.
  **Planning page** — a new `BreakfastDayCard` appears under each day
  where ≥1 reservation has the breakfast option AND the customer is
  present in the morning (= `startDate < D AND endDate >= D`, half-
  open `(startDate, endDate]` window). Each card lists the
  contributing reservations as `{clientName} ({propertyName}) : {N}
  pers.` and totals them in bold. Babies are excluded from the count
  (matching the bathroom-linen convention). The card uses an amber
  palette + croissant icon to visually separate it from the cyan
  laundry card. Mounted between `LaundryDayCard` and the departures
  block — operator scan: laundry → breakfasts → who's leaving today.
  **API** — new `GET /api/planning/breakfast?from&to` returns
  `{ breakfastByDate: { 'YYYY-MM-DD': { items: [...], totalPersons } } }`.
  Same property-default fallback pattern as the laundry aggregators
  (UNION ALL of explicit `reservation_options` ∪
  `property_option_defaults`; explicit row wins via `NOT EXISTS`,
  property fallback injects `qtySum = 1.0`).
  **Tests** — +25 (10 model + 5 seed + 5 controller server, + 5
  Vitest). Server suite 1033 → 1053 green (in-isolation; occasional
  parallel-runner flakes still surface suite-wide, all reproduce as
  pass alone). Vitest 237 → 242 green. Vite build clean (466 KB gzip
  ≈ baseline +0.6 KB).
  Live verified on dev server reservation #12082 (Gite property,
  2026-06-04 → 2026-06-07, tagged breakfast option, 8 persons): 3
  cards rendered on dates 06-05, 06-06, 06-07, arrival day (06-04)
  correctly excluded, departure day (06-07) correctly included.
  **Hotfix 2026-06-05 follow-up — cleaning info mirrored on the
  departure tile (same PR)** — Adrien asked that the small "ménage:
  Xh" badge that already shows on the next ARRIVAL card in a tight-
  transition alert also appear on the corresponding DEPARTURE card,
  so both ends of the conflict carry the same context. Wired
  `alertInfo` through to `DepartureMiniRow` (it already exists on
  `ReservationCard`) + extended the alert's `prevRes` explanation
  to embed the cleaning duration in the same shape as the arrival
  alert (`Arrivée de {client} {date} à {time}, ménage: {Xh}`). The
  red/orange/blue alert background is now also applied symmetrically
  on the departure card. Verified live on dev server: a Gite
  departure with a same-day next arrival shows the new badge
  alongside the existing tight-transition red border. No new tests
  — purely a string + a prop wired through; existing 245 Vitest
  cases still green.
  **Hotfix 2026-06-05 follow-up — clickable planning cards (same
  PR)** — All planning cards (arrivals, departures, breakfast) now
  open the corresponding reservation form on click. Wired
  `useNavigate` + `withFrom('/planning')` in `PlanningPage` and
  exposed an `onOpen(reservationId)` prop on `ReservationCard`
  (arrivals) + `DepartureMiniRow` (departures): the whole Card body
  is clickable with cursor + hover affordance. The per-row checkbox
  is `stopPropagation`'d so toggling ready/done doesn't trigger
  navigation. `BreakfastDayCard` gains an `onItemClick` prop —
  per-row click (one row = one reservation), `role="button"`,
  keyboard support (Enter / Space). +3 Vitest cases on
  `BreakfastDayCard` (245 → 248 green). Live verified: arrival
  card → /reservations/12103?from=/planning, departure
  → /reservations/12081?from=/planning, breakfast row
  → /reservations/12082?from=/planning. Checkbox click stays on
  /planning.
  **Hotfix 2026-06-06 — planning UI polish sweep (same PR)** — a
  small UX iteration loop, all on the planning page:
  - Cleaning info badge: first added on the arrival card too, then
    removed (the alert explanation text already carries it). On the
    DEPARTURE card only, a prominent red block (`CleaningServices`
    icon + bold "Ménage : Xh") sits where the now-removed "Famille"
    chip row used to be — the family breakdown belongs to the
    arrival card (welcome prep), the departure tile is about
    checkout time + cleaning.
  - Time pill on the top row of arrivals + departures: rounded,
    bold, solid orange/green (warning / success when done) bg, with
    an `AccessTimeIcon` to the left. The old `Person + name + clock
    + "Arrivée HH:MM"` second-line block is replaced by a single
    `Person + name` row — no duplication.
  - Top-of-page color legend ("Alertes de conflit") removed; per-card
    explanations are clear enough.
  - Icons sweep: `BreakfastDining` (croissant+cup) →
    `BakeryDining` (pure viennoiserie croissant); ARRIVÉE chip gets
    a big `FlightLandIcon` (plane landing) on the left; DÉPART chip
    gets a `FlightTakeoffIcon` (plane taking off). Distinct mirror
    silhouettes for the airport-board family.
  - Breakfast card rows redesigned: bigger croissant in the header,
    each row prefixed with the same `HomeWorkIcon` as on the
    arrival/departure cards, format `🏠 {property} • {client} : {N}
    petit(s) déjeuner(s)`. Multi-property days iterate one row each.
- **Skip a laundry trip** (spec `skip-laundry-trip.md`, 2026-06-06).
  The operator (Adrien) can now mark a specific laundry trip date as
  not-made from the Planning page — a click on the `LaundryDayCard`
  header IconButton greys the card out, replaces the 3 detail blocks
  with a muted *"Voyage non réalisé — reporté au prochain voyage"*
  caption, and persists the decision in a new global table.
  **Motivation** — reality intrudes: sometimes the trip doesn't
  happen (illness, travel, day off). Today the projection keeps
  assuming the trip went, the displayed clean stock diverges from
  the bins on the shelf, and the shortage alert can over- or under-
  shoot. The skip toggle closes that loop in one click.
  **Engine cascade** — on a skipped date the engine performs neither
  the drop-off nor the pick-up; both backlogs flow forward to the
  next non-skipped trip. The pickup lookup widened from `drop date
  = cursor − 7` to `drop date <= cursor − 7` so a deferred batch is
  finally picked up alongside the regular 7-days-ago batch on the
  next successful trip. The initial state computation (when `from`
  is after a skipped trip) uses a new
  `previousOrSameNonSkippedLaundryDay` helper that walks back 7
  days at a time until finding a non-skipped Tuesday, so past skips
  surface as deferred dirty at engine startup — not just in the
  forward loop. Conservation invariant
  (`clean + inCirculation + dirty + atLaundry = totalStock`) holds
  across every test case (pinned in the new
  `linen-inventory-skipped-trip.unit.test.js`).
  **Data model** — new table `laundry_trip_skips(tripDate TEXT PK,
  createdAt)`, additive, starts empty, no migration. Global scope per
  spec §3.1 rule 1: one human, one trip per day, the toggle is per
  date (not per property). Endpoint trio `/api/laundry/skips` (GET +
  POST + DELETE), admin-only via the default `enforceRoleAccess`
  middleware. Idempotent on both POST and DELETE; 400 on a malformed
  date.
  **Shortage alert + Dashboard** — no new UI. The existing
  `LinenShortageAlert` re-renders with the post-skip projection
  numbers automatically because `linenInventoryModel.simulate` loads
  the skip set as a single point of injection. A skipped future trip
  that pushes the clean stock below 0 → alert grows. An un-skipped
  trip → alert shrinks.
  **Tests** — 24 new server unit cases + 6 new Vitest cases + 2 new
  Playwright E2E cases. Server tests 967 → 991 green; Vitest 223 →
  229 / 229 green; E2E 19 → 21 / 1 skip / 0 fail; build clean.
  **Hotfix 2026-06-05 (same PR)** — first round of testing surfaced a
  visible gap: the "Disponible après ce dépôt" line did react to a
  skip (driven by `linenInventoryModel.simulate`, already skip-aware),
  but the "À apporter" / "À récupérer" counts on the next non-skipped
  card stayed on their pre-skip values. Two parallel server paths
  feed the same UI card and only one of them was skip-aware. The
  user reported it as *"la carte blanchisserie suivante ne change
  pas"*. Fixed by wiring the skip set into
  `planningController.laundrySummary` + adding
  `utils/laundryWindow.previousNonSkippedLaundryDay` to derive the
  widened drop-off / pick-up windows. A skipped trip itself emits
  zeroed blocks — the client masks them with the existing "Voyage
  non réalisé" caption. +11 server tests (5 helper + 5 controller +
  1 full-stack regression case pinning the user-reported scenario).
  Server tests 991 → 1002 green.
  **Hotfix 2026-06-05 follow-up (same PR)** — second round of testing
  surfaced one more gap: with the server now skip-aware end-to-end, a
  full page reload showed the right cards, but the LIVE toggle still
  showed the old values. Root cause was in
  `PlanningPage.handleToggleLaundrySkip`: after persisting the skip,
  it only re-fetched `getLinenInventory` (the "Disponible" line) and
  not `getLaundryPlanningSummary` (the À apporter / À récupérer
  counts). The original handler carried a stale comment claiming the
  summary endpoint was unaffected by skips — true before the previous
  hotfix, false after it. Fixed by refetching BOTH endpoints in
  parallel inside the toggle handler. Verified live in a browser:
  toggling the first card flips it to "Voyage non réalisé" AND bumps
  the next card's drop-off counts up (11 → 15 doubles, 12 → 15
  simples) in the same render pass.
  **Hotfix 2026-06-05 follow-up #2 (same PR)** — third round caught a
  scroll-related regression. Adrien skipped trips 1 and 2 in a row
  (2026-06-09 then 2026-06-16) and the trip-3 card (2026-06-23)
  *disappeared* instead of absorbing the 3-week backlog. First patch
  used `lastLoadedRef.current` (the end of the last infinite-scroll
  page) as the upper bound of the refetch. Superseded by follow-up #3
  below — the right fix is server-side.
  **Hotfix 2026-06-05 follow-up #3 (same PR)** — Adrien correctly
  pushed back on follow-up #2: the toggle was relying on UI state
  (`lastLoadedRef.current`, a scroll bookmark), which conflates
  display with business logic. Per CLAUDE.md §6.0 the projection
  horizon is a backend concern.
  - **Server** — `GET /api/planning/laundry` now treats `to` as
    OPTIONAL. When omitted, the controller calls
    `linenInventoryModel.simulate()` and uses its `horizon` (= last
    reservation endDate) as the upper bound. Empty result when there
    are no future reservations.
  - **Client** — `api.getLaundryPlanningSummary({ from })` (no `to`)
    is the new short form. `handleToggleLaundrySkip` uses it for the
    post-toggle refetch so the visible range is always consistent
    with the simulation, regardless of scroll position. The
    infinite-scroll path keeps the explicit `from`/`to` form for
    paginated next-page fetches.
  - +4 server tests pin the new contract (default-to-horizon path,
    null-horizon path, explicit-`to` wins, `from` validation still
    400). Server tests now 1006/1006 green.
  - Verified live: reset skips, navigate fresh (no scroll), skip
    trip 1, skip trip 2, scroll down → trip-3 card visible with
    17 doubles + 15 simples + 19 grandes + 19 petites in À apporter.
- **E2E smoke suite with Playwright** — Wave 1 (spec
  `e2e-playwright-smoke-suite.md`, 2026-06-04). Phase 0 of the upcoming CRA → Vite
  migration: a safety net of browser-level tests that exercises the most user-visible
  flows on the CURRENT (CRA) app, then becomes the acceptance criterion for the Vite
  migration ("same suite must stay green after the swap"). Auto-runs on every PR
  targeting master + every push to master via the new
  `.github/workflows/e2e.yml` workflow (ubuntu-latest runner, free for public repos).
  Shipped this PR: **18 deterministic tests across 7 spec files** — Dashboard boot +
  zero console errors, 12 top-level routes render their header (sidebar nav graph
  pinned), Settings VAT round-trip, Linen stock 6-field round-trip, iCal date-drift +
  cancellation Dashboard cards seeded via DB helper and surfaced through the
  components shipped in PRs #104 / #106, mobile xs viewport drawer reachability.
  Wall time ~18 s end-to-end.
  Infrastructure: ephemeral SQLite per run (`/tmp/guestflow-e2e.db`) wiped by a
  pretest hook, deterministic admin seeded via the new `server/scripts/seed-e2e.js`,
  session cookie captured through the CRA proxy origin so every spec inherits an
  authenticated `storageState`, API + DB seed fixtures (`apiSeed.js` + `dbSeed.js`)
  for the rare cases where going through the real engine would be slow or
  non-deterministic.
  **Wave 2 follow-up** (separate PR, before the migration starts): the remaining 16
  specs from §3.4 of the spec — reservation create/edit, force-item-to-complement,
  disable-deposit, devis create + accept, CRUD round-trips, accounting CSV download,
  establishment closures gate. Skipped in Wave 1 because each needs careful UI
  inspection that's more efficient to do in a focused follow-up. One spec
  (`force-password-change`) is skipped with a documented reason — it calls
  `reset-admin.js` which `DELETE`s sessions and nukes the cached e2e admin cookie;
  needs a per-spec auth-isolation pattern to be safely re-enabled.
  Local dev: `npm run test:e2e` (headless) or `:headed` to watch. CI: report
  uploaded as a downloadable artifact on failure (interactive HTML with traces +
  screenshots, no comment in the PR thread — standard GitHub Actions check box is
  enough per user preference).
- **iCal date-drift Dashboard approval** (spec `ical-sync-override-locked-dates.md`,
  2026-06-03). Previously, an iCal reservation that had been opened+saved through the form
  became `icalSyncLocked = 1` and the sync engine then ignored EVERY subsequent change from
  the source platform — including date moves, the most safety-critical mutation for
  overbooking prevention. The new flow detects locked date drifts during `syncSource()`,
  records ONE pending row per reservation in `ical_date_drift_alerts` (UPSERT semantics — a
  later proposal replaces the previous one), and exposes them as an orange Dashboard
  `<IcalDateDriftAlert />` card. Each card offers:
  - **Approuver** → runs a NARROW SQL override touching only `startDate`, `endDate`,
    `updatedAt`. Bed config, guest counts, options, resources, prices, payments, lock flag
    are explicitly preserved (rules 6+7).
  - **Voir la fiche** → opens the reservation page without acknowledging.
  - **✕** (top-right) → ignores the proposal; the reservation stays at its persisted dates.
  Acknowledged rows are kept indefinitely for audit. Approved overrides emit a
  `reservation_history` entry labelled "Dates iCal approuvées" so the change appears in the
  audit log. Unlocked reservations + summary-only locked drifts keep their existing behavior
  (full update path / silent skip respectively). 23 new server tests pinning the contract
  (engine drift detection, idempotency on repeated syncs, latest-proposal-wins UPSERT,
  approve/reject atomicity, controller HTTP shaping). Known follow-up: a locked reservation
  receiving a NEW UID alongside the date change still falls through to insert+delete (loses
  user data) — separate sync-engine rework needed; tracked as a follow-up.
- **Linen inventory & shortage projection** (spec `linen-inventory-shortage-tracking.md`,
  2026-06-03). Adrien declares his global stock (3 bed types + 3 towel types) in the new
  `/parametres/stock-blanchisserie` sub-page. A pure simulation engine
  (`server/src/utils/linenInventory.js`) walks day-by-day from today to the last reservation's
  endDate, modelling 4 buckets per type (`clean` / `inCirculation` / `dirty` / `atLaundry`)
  with the conservation invariant `clean + inCirculation + dirty + atLaundry = stock` asserted
  on every day. Pick-up on a laundry day runs BEFORE check-in (rule 6) so a same-day arrival
  is served by the freshly returned linen. Two new endpoints:
  - `GET /api/planning/linen-inventory` → per-laundry-day clean snapshot, consumed by
    `LaundryDayCard`'s new third block "Disponible après ce dépôt :" with red highlighting
    on negative values (rule 35).
  - `GET /api/dashboard/linen-shortage` → grouped-by-type shortage list (first date, max
    missing, impacted reservations) consumed by the new `<LinenShortageAlert />` mounted at the
    top of the Dashboard. Empty when no shortage; clickable reservation chips navigate to the
    reservation page.
  Six new columns on `app_settings` (`bedLinenStockSingle / Double / Baby`, `towelStock
  Large / Medium / Small`), all integer ≥ 0 capped at 999 by `validateLinenStockCount`. **Stock
  = 0 ⇒ "type not tracked"**: the simulation skips it and the UI omits any line for it (Planning
  3rd block, Dashboard alert) — keeps the surfaces clean for partially-tracked installs.
  53 new server tests pinning the engine (conservation, devis exclusion, property-default
  fallback, explicit-wins-over-default, bathroom qty sub-occupation factor, same-day pickup
  ordering, shortage detection + impacted reservations).
- **Per-property option defaults** (spec `weekly-bed-linen-tracking.md` §3.7, 2026-06-03).
  Adrien can declare, per logement, that one or more linen options are added by default on
  every NEW reservation for that property, optionally with the offered flag pre-set ("le
  linge est inclus dans le tarif"). New table `property_option_defaults(propertyId, optionId,
  offered)` decoupled from `property_options` (the availability filter remains untouched).
  Four new API endpoints under `/api/properties/:id/option-defaults` (GET / PUT / DELETE) +
  `/api/options/:id/property-defaults` (read-only mirror). Two UI surfaces per Adrien's UX
  choice: PropertyDetail card "Options ajoutées par défaut" with immediate-save switches
  (canonical edit) + OptionsPage section "Logements par défaut" listing the same data
  read-only when editing a linen option. ReservationPage auto-pre-populates `selectedOptions`
  on **new** reservation creation (and on property change mid-creation) using
  `GET /api/properties/:id/option-defaults`. Edit of an existing reservation NEVER re-applies
  defaults (rule 30 — historical bookings stay frozen). Soft-fails on the defaults fetch so a
  defaults outage never blocks the reservation flow. **Rule 35 follow-up**: when the operator
  toggles an option back ON on an existing reservation (remove → re-add), the `offered` flag
  is set from the property's default for that option (default `offered=true` → free, default
  `offered=false` → paid, no default → preserve historical state). The cache is refreshed via
  a useEffect watching `form.propertyId` so the contract is honoured on edit-load too.
- **Weekly bed-linen tracking on the Planning page** (spec
  `weekly-bed-linen-tracking.md`, 2026-06-02). Each laundry day (configurable weekday, default
  Tuesday) now surfaces a small card under the day header of the Planning view showing the
  number of sheet sets to bring (single + double + baby, summed across every checkout since the
  previous laundry day on reservations that include a linen-flagged option) and to pick up (the
  previous laundry day's drop-off). Both sides are independent — a quiet week renders nothing.
  - New per-option flag `countsAsBedLinen` (and `countsAsBathroomLinen` for the towels
    counterpart). Pure metadata — zero pricing impact. Both flags are **invisible in the UI**
    (the OptionsPage form does not show a control for them): the typed seeds + title-alias
    promotion guarantee the flags are set on the right rows automatically.
  - **Default "Linge de lit" option seeded at boot** — undeletable in the UI via
    `autoOptionType='bed_linen'` (same pattern as the early/late check-in options). The seed
    has three branches: idempotent skip when the typed row exists; **promote in place** when
    an existing option already carries `countsAsBedLinen=1` OR has a title in the short
    `KNOWN_TITLE_ALIASES` list (`'linge de lit'`, `'linge de lits'` — case-insensitive +
    trim-tolerant), so legacy prod rows are picked up transparently with no manual cleanup;
    fresh insert otherwise. The promotion keeps Adrien's name / price / description and just
    adds the `autoOptionType` marker + `countsAsBedLinen=1`. Same shape for the bathroom-linen
    seed with `KNOWN_TITLE_ALIASES = ['linge de toilette']`.
  - **Bathroom-linen tracking (towels) — §3.5.bis follow-up.** Strict mirror of the bed-linen
    feature: a second independent flag `countsAsBathroomLinen`, a default **"Linge de toilette"**
    seed (`autoOptionType = 'bathroom_linen'`, same non-destructive contract), and a second
    sub-line *"Serviettes: N grandes · N moyennes · N petites"* under the same "À apporter /
    À récupérer" headers in the LaundryDayCard. **The towel count SCALES by
    `reservation_options.quantity`** (asymmetric with bed-linen which ignores quantity) — the
    seed is `priceType = per_person` and the operator uses the quantity field as a
    sub-occupation factor (e.g. `0.6667` on a 3-person stay = "2 of 3 want towels").
  - **§3.5.ter — per-type linen configuration on the option.** Six new columns on `options`:
    `linenIncludesSingle / Double / Baby` (1/0, default 1 — drive 3 checkboxes shown in the
    option form when `countsAsBedLinen=1`) and `towelLargePerPerson / Medium / Small`
    (integers ≥ 0, defaults 1 / 0 / 1 — drive 3 number inputs shown when
    `countsAsBathroomLinen=1`). Bed-linen formula now gates each bed-type sum on its include
    flag; bathroom-linen formula becomes
    `ROUND(persons × Σ quantity × MAX(towel<Size>PerPerson))` per size. A multiplier at 0
    silences that size in the LaundryDayCard (rule 13.bis). Defaults preserve the previous
    "all bed types ON, 1 large + 1 small per person" semantic — no migration needed for
    existing installs.
  - New global setting `laundryWeekday` (0 = Sunday … 6 = Saturday, default 2 = Tuesday)
    configurable in *Paramètres → Linge & blanchisserie*.
  - New endpoint `GET /api/planning/laundry?from=…&to=…` returning every laundry-day occurrence
    in the range with its `dropOff` + `pickUp` payloads. The client filters silent days.
  - Server-side aggregation honours: `kind='reservation'` only, `offered=true` still counts,
    option `quantity` is ignored (1 reservation = 1 set per bed), multiple linen-flagged options
    on the same reservation still count once, window is `(L-7d, L]` (a check-out the laundry
    morning joins that day's batch).
- **Self-service email edit on `/account` with a persistent anti-lockout safety net** (spec
  `admin-account-management.md` follow-up #7, 2026-06-02). The "Mes informations" email field is
  now editable for every authenticated user — the bootstrap admin can replace the
  `admin@guestflow.local` seed with a real address (the same one that's used to log in). To make
  this safe given that the email IS the login identifier:
  - `PUT /api/users/me` accepts an optional `email` key — normalised, validated, unique-checked
    (`400 INVALID_EMAIL`, `409 EMAIL_ALREADY_EXISTS`). Same-value is a no-op. `roles` still
    stripped server-side (privilege guard unchanged).
  - `GET /api/users/me/email-status` now returns
    `{ myEmail, defaultStillUsed, mustVerifyNewEmail, emailChangedAt }`. `defaultStillUsed`
    drives the red highlight on the email field in SelfProfileSection when the operator is still
    on the seed; `mustVerifyNewEmail` drives the new persistent banner.
  - **`EmailVerifyBanner`** mounted in `AppShell` — visible on every page until the operator has
    logged out and logged back in once with the new email (closes the typo-then-logout lockout).
    Self-clearing: the login flow updates `lastLoginAt`, the banner detects it on the next poll
    and disappears. The CLI recovery command is documented in the README, not surfaced in the UI
    (the banner is visible to every role, not just the admin).
  - **`npm run reset-admin` recovery extended** — now handles the case where the operator
    changed their email and forgot it: the OLDEST admin row is renamed back to
    `admin@guestflow.local` instead of silently creating a second admin row. `emailChangedAt` is
    also cleared on reset so the recovered account doesn't show the verification banner.
- **Per-item routing to Complément à percevoir** (spec
  `force-item-to-complement.md`). The reservation form now exposes two layers of control over
  which payment bucket each line lands in:
  1. **Manual override** via a discreet `Compl.` checkbox on every option, resource and custom
     option in the reservation editor, plus a `Taxe de séjour en complément` switch in the
     Finance card. When ON, the line (or the tax) bypasses the auto deposit/balance split and
     lives 100 % in the Complément entry — both in the live PricingSummary (italic gray
     `compl.` chip next to the libellé) and in the accounting export.
  2. **Per-line per-bucket snapshots** captured on every `depositPaid` / `balancePaid` 0→1
     flip — `acompteContribTtc` + `soldeContribTtc` on each option / resource / custom-option
     row, plus `accommodation*ContribTtc` / `touristTax*ContribTtc` on the reservation row.
     These freeze the exact attribution of each encaissement at its moment of capture, so the
     monthly accounting journal keeps reading the original numbers even if a line's price
     grows afterwards. Conservation is asserted inside a transaction: if the sum of contribs
     ≠ the encaissement amount within ±0.01 €, the capture rolls back together with the
     payment flip. The accounting model reads the contribs directly; when a reservation has no
     contribs (pre-feature data), it falls back to the historic pro-rating logic so existing
     exports stay byte-identical.
  Wired through:
  - 14 new DB columns added via the existing idempotent ALTER-pattern in `database.js`
    (4 forced flags + 6 per-line per-bucket contribs + 4 reservation-level per-bucket contribs).
  - A new helper `server/src/utils/forceItemContribsCapture.js` driving the capture, the
    conservation invariant assertion and the un-flip clearing.
  - The pricing engine (`server/src/utils/pricing.js`) subtracts forced lines + a
    complement-routed tax from `preArrivalAmount` and returns per-line `inComplement` /
    contribs in `quote.optionLines[i]` / `quote.resourceLines[i]` so the client can render the
    split.
  - `accountingModel.buildEntry` reads per-line contribs to populate exact per-bucket TTCs
    per entry kind; legacy reservations keep the pro-rating fallback.
  - Client: form state + 4 payload-build sites in `ReservationPage.js`, Compl. checkbox in
    `ExtrasSection.js`, tax Switch in `FinanceSection.js`, line-duplication logic + chip in
    `PricingSummary.js`. The chip styling per spec §6.2 (italic gray outlined chip,
    `compl.` label, 18 px height).
  Tests: 37 new cases across 3 files — `pricing-force-and-snapshot` (15), `payment-contrib-
  capture` (13), `accounting-per-line-contribs` (9). Existing 530+ tests stay green; in
  particular the legacy-fallback test pins the accounting export at byte-identical output for
  any reservation with NULL contribs.
  Migration note: idempotent ALTER TABLE for every new column. No existing data touched. New
  contribs columns default to NULL on every row; the accounting model treats "all NULL" as
  "legacy mode" → no behavioural change for existing reservations until they receive a fresh
  payment flip under the new code.
  **Follow-up on 2026-06-01 (Adrien feedback):**
  - Auto-options (arrivée anticipée / départ tardif) can now also be routed to Complément via
    the same `Compl.` checkbox in the editor. Wired through a new `autoOptionsInComplement`
    array on the form / payload / engine (auto-options aren't in `selectedOptions`, so they
    need a parallel channel). The engine writes their `inComplement` to `reservation_options`
    on save; loads back from there. Backward-compat: a locked snapshot with `inComplement = 1`
    keeps the routing even without the array.
  - The PricingSummary chip is now **clickable** — the user can flip a line in/out of
    Complément directly from the summary, mirroring the FinanceSection checkbox. Two states:
    bold outlined `compl.` when active, faded `+ compl.` when inactive (discoverable). The
    `delta` row of a split (post-payment growth) stays read-only — flipping it would break
    conservation against the encaissements already recorded. Same for the tourist-tax row —
    the chip there mirrors the Switch in FinanceSection.
- **Per-reservation "Désactiver l'acompte" toggle** (spec
  `disable-deposit-per-reservation.md`). A new `Switch` next to the "Acompte" title in
  `ReservationPage → FinanceSection` lets the admin declare that a given reservation
  has no deposit concept at all — typical case: bookings where the platform
  (Airbnb / Booking) collects the deposit on the owner's behalf and it never transits
  through the owner's accounts. When ON, the pricing engine collapses `depositAmount`
  to 0, `balanceAmount` absorbs the whole pre-arrival total, and the controller
  force-zeroes `depositPaid` + `depositPaidDate` before persisting. Net result for the
  accountant: the reservation produces **one journal entry** (the balance) instead of
  two — the existing accounting export logic at
  [accountingModel.js:54-56](server/src/models/accountingModel.js#L54-L56) emits a
  deposit row only when `depositPaid=1`, so no extra accounting code was needed; the
  upstream pipeline does all the work.
  Wired through:
  - New column `reservations.depositDisabled INTEGER NOT NULL DEFAULT 0` added via the
    existing `if (!cols.includes(...))` migration pattern in `database.js`. Default 0
    for every existing reservation, so behaviour is opt-in per reservation.
  - `reservationsModel.insertReservation` + `updateReservation` carry the column;
    `getAuditSnapshotFromDb` includes it so toggle changes show up in
    `reservation_history` like any other field edit. `reservationAudit` declares the
    label `Acompte désactivé` so the history viewer renders it readably.
  - `pricing.js` (`calculateReservationQuote`): when `depositDisabled` is truthy,
    short-circuit `resolvedDepositAmount = 0` + `resolvedBalanceAmount =
    preArrivalAmount` + `depositDueDate = null`. The branch sits BEFORE the existing
    `depositPaid/balancePaid` ladder so the flag always wins. Critical: this means the
    toggle survives every recompute — the previous design idea ("just mutate
    `depositAmount=0` in the body") was rejected because the engine would re-derive
    `autoDepositAmount = preArrivalAmount × depositPercent / 100` on the next save and
    silently restore the deposit.
  - `reservationsController.update` + `.create`: read `req.body.depositDisabled`, pass
    the flag to `calculateReservationQuote`, and on `update` build a derived
    `modelPayload` that force-zeroes `depositPaid` + `depositPaidDate` whenever the
    flag is ON. `depositDisabled` is also added to the 14-field past-lock allowlist
    so an admin can flip it on a past reservation (typical retroactive correction
    after spotting a platform booking that had been treated as direct).
  - `FinanceSection.js` renders a small `Switch` next to the "Acompte" title. OFF =
    standard deposit UI as today. ON = the entire deposit block (montant +
    échéance + bouton "Marquer payé" + date paiement) collapses to a single muted line
    *"Acompte désactivé — ajouté au solde."* The Switch stays visible for re-toggle.
    The Solde block is unchanged visually; its amount is just higher because the
    engine has already consolidated the split.
  - `ReservationPage.js`: `depositDisabled` added to the form state, the live
    `formSnapshot` memo deps, the 4 payload-build sites (calc preview ×3 + final
    save), and the load-from-server step (`res.depositDisabled → form`). The final
    save also force-zeroes `depositPaid` / `depositPaidDate` client-side when the
    toggle is ON — server enforces the same; the client mirror keeps the UI
    consistent immediately.
  **Lossiness on flip-back** (documented in the spec, Adrien's call 2026-06-01):
  flipping ON → OFF doesn't restore the original deposit value. The engine recomputes
  from `property.depositPercent` — same as for a fresh reservation. Acceptable for the
  platform-handles-deposit use case where the original split was irrelevant anyway.
  Tests: 7 new cases in `pricing-deposit-disabled.unit.test.js` (default regression,
  ON collapses deposit/absorbs balance, boolean variant accepted, survives repeated
  recompute calls, depositPercent=0 edge case, flag wins over a stale `depositPaid=true`,
  every falsy variant is a no-op). All 7 pass at first run.
  **Follow-up on 2026-06-01 (Adrien feedback):** the toggle was visible in
  `FinanceSection` but the rest of the UI kept showing "Acompte: 0€ Dû [null]" or
  "Acompte non payé" for depositDisabled reservations — visually inconsistent with
  the toggle's intent. Patched the four remaining surfaces:
  - `PricingSummary` (the recap card next to the reservation form): the Acompte row
    now renders an italic muted `Désactivé (ajouté au solde)` instead of `0.00€`,
    and the due-date caption + "Acompte payé" chip are hidden.
  - `Dashboard.js` line 248 status line: the `Acompte NON` part now reads `OK` when
    `r.depositDisabled` is on — there's nothing to chase. The Solde part is
    unchanged.
  - `FinancePage.js` projection table (line ~195): the Acompte cell now shows
    `Désactivé` italicised instead of `0€ + chip "Dû [null date]"`.
  - `FinancePage.js` pending-payments table (line ~319): the Acompte cell now shows
    `Désactivé` instead of the unchecked checkbox + `0€` + null due-date.
  - `FinancePage.js` summary chip line (line ~433): the per-reservation chip row
    renders `Acompte désactivé` (italic) instead of `Acompte non payé`.
  Server propagation: `financeModel.getProjection` now includes `depositDisabled` in
  the per-reservation detail it returns (the projection used to omit the flag, so
  the projection table didn't see it). All other endpoints already passed the column
  through via the existing `SELECT r.*` patterns.
- **Admin-only escape hatch for editing past reservations** (spec
  `admin-unlock-past-reservations.md`). The server-side lock that gates `PUT
  /api/reservations/:id` to a 14-field allowlist once `startDate <= today`, and the
  one that returns 403 on `DELETE /api/reservations/:id` once `endDate < today`, both
  drop to a no-op when the new `Paramètres → Réservations passées` toggle is ON. OFF
  by default — every existing install and every fresh deploy keeps the current
  behaviour. Wired through:
  - A new boolean column `app_settings.allowEditPastReservations`
    (`INTEGER NOT NULL DEFAULT 0`) added via the existing idempotent
    `tryAddAppSettingsCol` helper in `database.js`.
  - A new helper `settingsModel.allowEditPastReservations()` returning a boolean; both
    lock check sites in `reservationsController.update` and `.remove` now read it
    before applying their guard.
  - A new `reservations` group in the GET/PUT settings payload — exposed verbatim by
    `settingsResponse.shapeResponse` and accepted by `settingsController.updateSettings`
    via `RESERVATIONS_FIELDS` + `BOOLEAN_INT_COLUMNS` (the same INTEGER coercion path
    that already handles `smtpSecure`).
  - A new client component `SettingsReservationLockSection.js` (Card → Stack → h6 →
    caption → Switch, mirrors `SettingsVatSection`'s shape) mounted in `SettingsPage`
    between the VAT and Google Calendar cards.
  - In `ReservationPage.js`, the existing `setExistingReservationLocked` call now also
    consults the setting (`api.getSettings()` is loaded in parallel with the reservation
    itself); when ON, `isReservationLocked` is `false`, so the banner, the opacity / no-
    pointer-events grey-out on Stay+Notes, and the Delete-button disabling all
    short-circuit on their existing checks. **No new visual indicator on
    ReservationPage when ON** (Adrien's choice, 2026-06-01) — the toggle state lives
    only in Paramètres.
  - **Follow-up on 2026-06-01 (Adrien feedback):** a third lock surfaced during the
    first test, in `reservationsModel.validateAvailability` (line ~269), which hard-
    rejected any payload with `startDate < today` and `'Impossible de réserver dans le
    passé.'` That guard fires inside both create and update flows, so even with the
    controller-level lock lifted by the toggle, editing a past reservation that kept
    its (past) startDate still failed. Fixed: `validateAvailability` gains an 8th
    `options = {}` parameter; the past-date guard is now
    `if (startDate < today && !options.allowPastDates)`. Both controller call sites
    pass `{ allowPastDates: settingsModel.allowEditPastReservations() }`. Overlap /
    capacity / closure checks are unchanged. Spec §1, §3.1 + §3.5, and §4.1 updated to
    reflect three lock sites instead of two.
  Restricted to admin: settings endpoints are already admin-gated by
  `enforceRoleAccess`, so an accountant never sees the card or can write the column.
  Tests: 5 new cases in `settings-model.unit.test.js` (default value, round-trip,
  coercion table, preservation through unrelated upserts). Controller-side coverage
  is deliberately scoped to the model helper — the boolean composition
  `isPast && !allowEdit` in the controller is a 2-line change and the helper is
  fully exercised at the model level; a controller integration test would require
  refactoring for DI (out of scope for this small change).
- **Let's Encrypt cert via Freebox port-forward + HTTP-01** (`server/scripts/issue-letsencrypt-cert-http01.sh`).
  The path Adrien's prod actually uses to make `https://<your-app>.<your-domain>` reach the Pi
  with a publicly-trusted cert (no browser warning) and a hands-off auto-renewal — without
  migrating DNS hosting (Squarespace stays as registrar + DNS host). The architecture is a chain
  of three boring steps: a CNAME `guestflow → <your-freebox-dyndns>.freeboxos.com` at Squarespace, two
  Freebox port-forwards (WAN 80 → Pi:80 for ACME, WAN 443 → Pi:4000 for HTTPS), and a single
  acme.sh standalone invocation on the Pi. acme.sh's daily cron re-issues at the 60-day mark,
  briefly re-binds port 80 to answer the ACME challenge, drops the renewed fullchain into
  `~/guestflow/certs/server.{crt,key}`, and triggers `pm2 restart guestflow` via `--reloadcmd`.
  The script defensively pre-flights (cert + key file paths, root requirement for port 80,
  port-busy check via ss / netstat, FQDN format) and surfaces a self-contained troubleshooting
  cheatsheet on failure (DNS propagation, Freebox forward, ISP port-80 blocking, staging fallback).
  README §HTTPS gets a full operator walkthrough — DHCP reservation pinning the Pi at
  <your-pi-lan-ip>, the exact Freebox port-forwarding table, the `dig`-based DNS verification, and
  caveats (CNAME chain self-updates via Free's DDNS so the dynamic public IP is a non-issue;
  hostname-only access since the cert SAN is the FQDN). Complements the earlier
  `feat/prod-https-self-signed` (still ships the script + behaviour for offline / LAN-only
  deploys) and supersedes the abandoned `feat/letsencrypt-cert-via-cloudflare` branch (the
  Cloudflare migration was a heavier path Adrien chose not to take).
- **Dynamic favicon from the company logo (works in dev AND prod).** When the admin has
  uploaded a logo via Settings → *Informations sur votre activité*, the browser tab favicon
  becomes that logo on every page. Two cooperating layers:
  - **Server-side middleware** (`server/src/middleware/dynamicFavicon.js`, mounted BEFORE
    `express.static(clientBuildDir)` in `index.js`) serves the logo on `/favicon.ico` AND
    `/favicon.svg` whenever the page is served by Node — covers the production build, bookmarks,
    initial tab load, and any client that ignores JS. Path-safety pinned by 7 traversal test
    cases (`/etc/passwd`, `..`, URL-encoded payloads, etc. all caught), and transient
    `settingsModel.read()` failures (SQLITE_BUSY during a hot migration) are swallowed → the
    favicon endpoint never turns into a 500. 5-minute `Cache-Control`.
  - **Client-side hook** (`client/src/hooks/useDynamicFavicon.js` + `utils/setFavicon.js`)
    fetches `/api/settings` on AppShell mount + every user change and rewrites the document's
    `<link rel="icon">` directly. **This is what makes the favicon update in DEV** (CRA's
    :3000 dev server serves `public/favicon.ico` from disk and never proxies it to Node, so the
    server middleware can't fire there), and it also defeats the browser's aggressive favicon
    cache via a `?v=<updatedAt>` buster on the href. `SettingsPage.handleUploadLogo` /
    `handleDeleteLogo` push a new icon directly via `setFavicon` after the API resolves, so the
    tab updates the very second the upload completes — no reload needed. The setter strips
    every prior `<link rel~="icon">` so Firefox (which picks the FIRST declaration) honours the
    dynamic one, and it sets the correct `type` attribute from the extension. 23 unit tests
    across `setFavicon.test.js` (idempotency, default-restore, cache buster, MIME mapping,
    null-doc no-op, etc.) and `useDynamicFavicon.test.js` (initial fetch, no-logo restore,
    silent failure on pre-login 401, refresh on key change, stale-fetch-after-unmount guard).
  Result: drop in your logo via Settings, the tab favicon updates immediately in dev, and the
  next prod deploy serves it on `/favicon.ico` for every visitor including new tabs and
  bookmarks.
- **Self-service profile editor on `/account`** (spec `admin-account-management.md` follow-up #6).
  A new "Mes informations" card sits **above** "Mon mot de passe" and lets every authenticated
  user (admin or accountant) edit their own `firstName`, `lastName`, `companyName` and `notes`.
  Email stays locked (same rule as the admin form in edit mode). **Roles are NOT exposed
  anywhere** — neither in the UI nor accepted by the server. The new endpoint
  `PUT /api/users/me` deliberately omits both `roles` and `email` from the model call so an
  authenticated user cannot grant themselves admin via a hand-rolled payload (privilege guard,
  asserted by 3 dedicated unit tests). On a successful save the page triggers `useAuth().refresh()`
  so the sidebar + dialogs pick up the new name immediately. Field-level server errors
  (`{ field, detail }`) land under the matching input; generic errors fall to the page snackbar.
  Tests: 6 new server cases (`users-controller`), 7 new client cases (`SelfProfileSection`), and
  4 new page cases (`UserManagementPage`). Full suite green at 63 / 63 server + 37 / 37 client.
- **Test coverage for the Gestion utilisateur feature** (Adrien feedback 2026-05-30):
  - **Server** (`server/src/tests/`): new `settings-controller-smtp-password.unit.test.js`
    (7 cases on the password whitespace strip — Gmail 4×4, tabs/newlines, no-whitespace
    pass-through, empty/null clear, absent preserve, whitespace-only → clear); extended
    `email-templates.unit.test.js` (every template signs with `fromName` + carries the
    auto-generated notice + falls back to GuestFlow); extended `users-controller.unit.test.js`
    (`fromName` flows from `settingsModel.decryptedSmtpSettings()` to the welcome + reset
    templates). All M3 server suites: 88 / 88 green.
  - **Client** (`client/src/`): new Jest + RTL tests — `constants/__tests__/roles.test.js`
    (6 cases on `ROLES` / `roleLabel` / `userHasRole` including the legacy `role` string
    back-compat shim and array-wins-over-string precedence); `pages/__tests__/UserManagementPage.test.js`
    (6 cases on role-gated section visibility, listUsers fetch gating, multi-role admin+accountant,
    null user, listUsers failure surfaced as Alert); `components/__tests__/AccountFormDialog.test.js`
    (5 cases on email lock in edit, self-protection of own admin role, fieldErrors landing,
    submit payload shape). 17 / 17 client tests green.
- **Admin account management — unified "Gestion utilisateur" page** (spec
  `admin-account-management.md`). One page at `/account` (sidebar entry "Gestion utilisateur",
  available to every authenticated role). Top section "Mon mot de passe" lets the current user
  change their own password (same forced-first-login redirect-to-login flow as before). For admins,
  a second section "Gestion des comptes" lists every user with full CRUD: create with first/last
  name, email, multi-role (admin + accountant via a multi-select), optional company + free-form
  note; edit; reset password; soft delete (deactivate) and hard delete (only when the user has
  never logged in). Temporary passwords are generated server-side and **emailed via SMTP** — never
  displayed or logged. The flow uses an "email first, persist second" ordering so a failed email
  never leaves a half-created account behind. Self-protection guards on both client and server:
  cannot delete self, cannot remove own `admin` role, cannot reset own password from the admin
  table (use the "Mon mot de passe" section on the same page). A "last admin" guard rejects any
  action that would leave zero active admins (`400 LAST_ADMIN`). The legacy paths
  `/settings/password` and `/comptes` redirect to `/account`; the `Paramètres > Mot de passe`
  submenu and the standalone `Comptes` sidebar entry have been removed.
- **Forced first-login re-authentication.** When a user changes the temporary password they
  received by email, the server now **destroys the session** and the client redirects to
  `/login?reason=password-changed` with a one-shot snackbar. Voluntary password changes from
  `/settings/password` (when `mustChangePassword` was already cleared) keep the session active —
  unchanged UX.
- **SMTP configuration in `/parametres`** (`Envoi d'emails (SMTP)` card). Fields: host, port,
  STARTTLS/TLS implicit, username, password (encrypted at rest with AES-256-GCM, masked on read
  via `passwordSet: boolean`), `fromEmail`, `fromName`, `publicUrl` (used in the welcome email).
  "Envoyer un mail de test" button hits `POST /api/settings/smtp-test` which dispatches an
  "Email de test GuestFlow" to the current admin's address; the response detail surfaces transport
  errors verbatim for diagnosing creds.
- **Multi-role users.** The single `users.role` column is replaced by a `user_roles(userId, role)`
  join table with `ON DELETE CASCADE`. A user holds an array `roles` everywhere (safe shape,
  session, JWT-like payload). The middleware (`enforceRoleAccess`) and the client now read from
  this array; combined `admin + accountant` always wins as admin. `server/src/constants/roles.js`
  is the new single source of truth (mirrored client-side as `client/src/constants/roles.js`).
- **Shared `MonthYearPicker` component** (`client/src/components/MonthYearPicker.js`). Single source
  of truth for the month + year selection card, with optional `description` caption,
  `maxMonth = 'YYYY-MM'` to disable forward months, and `helperText` under the Mois field. Exposes
  `toYearMonth({month,year})` / `fromYearMonth('YYYY-MM')` helpers so callers that hit endpoints
  expecting the string format (tourist tax) can convert without owning the logic. Now used by
  `/comptabilite` and `/finance/tourist-tax` — both pages look and read the same.
- **Per-platform tourist tax collection** (spec `per-platform-tourist-tax-collection.md`).
  Each iCal source now carries a **`collectsTouristTax`** flag (default `1`, mirrors the previous
  hardcoded "non-direct = platform collects" rule). The pricing engine resolves it per reservation:
  direct → owner always collects; non-direct → look up the property's iCal source for that platform
  key (case-insensitive), follow its flag; no matching source → default to "collects" (legacy
  safe). The **Suivi taxe de séjour** extraction now lists direct bookings **plus** non-direct
  bookings whose platform was explicitly switched to "owner collects" — coherent with what's
  charged on the quote. New UI: a `Switch` "La plateforme collecte la taxe de séjour" under the
  iCal source form on the property page, plus a "Taxe collectée" column (`Plateforme` / `Vous`
  chip) in the sources table. Unit tests: `pricing-tourist-tax-platform-collection` (6 cases).
  Full server suite green at 446.
- **Reservation: 3rd payment slot "Complément à percevoir"** (spec
  `accountant-accounting-export.md`, rule 28). When the deposit and the balance are marked paid and
  the total stay TTC has *since* grown — typical case: options or extras added after the payments
  were recorded — the pricing engine now surfaces the leftover as `complementAmount =
  max(0, totalStayPrice − depositAmount − balanceAmount)`. The FinanceSection renders a 3rd block
  (orange-tinted) under Solde with a single "Marquer complément payé" button + a "Payé le" date,
  visible **only** when the complement is > 0. Once paid the amount is frozen in the DB like
  deposit/balance — the engine never erodes received money. Typically settled at end of stay for
  on-site extras. The accounting export treats it as a 3rd encaissement type alongside deposit and
  balance (same balanced double-entry shape, dated at `complementPaidDate`). Migration backfills
  the column on existing fully-paid reservations so any silent gap (e.g. production res #12087:
  240 € unbilled) becomes immediately visible. Unit tests: `pricing-complement` (7). Full suite
  green at 440. Also fixes a quiet inaccuracy: the export now pro-rates against `totalStayPrice`
  (= finalPrice + tourist tax) instead of `finalPrice`, so D + B + C = 100 % exactly.
- **Accountant access + monthly accounting CSV export** (spec
  `accountant-accounting-export.md`, PR 3 — closes the feature):
  - New **`accountant`** user role and a dedicated **`/comptabilite`** page (nested under "Suivi
    financier" in the admin sidebar). The accountant logs in, picks a month + year, downloads the
    sales CSV, and changes their own password — and can do **nothing else** (read-only by construction).
  - **Sales CSV** (`GET /api/accounting/sales.csv?month=&year=`) — one row per double-entry journal
    line, balanced: client auxiliary account `C<NAME>` debited TTC, revenue accounts (`70600000` /
    `70600010` / `70601000`) credited HT pro-rated per encaissement, VAT accounts (`44571100` /
    `44571200`) credited per rate. One entry **per encaissement** (deposit or balance) whose
    `depositPaidDate` / `balancePaidDate` falls in the month, so a reservation paid across two months
    appears in both. Caution and tourist tax are excluded; `kind='devis'` rows never exported.
    Trailing info columns (`Plateforme`, `Prix payé client`, `Commission`) carry the platform data on
    the debit row only. **Format:** `;` separator, UTF-8 BOM, comma decimals, FR-Excel friendly.
  - **Platform commissions preview** (`GET /api/accounting/platforms?month=&year=`) — JSON used by
    the page table.
  - **Turnover basis = net** (the owner-received `finalPrice`) — chosen as the simple default; the
    brut + commission appear only in info columns. One-line switch in
    `constants/accounting.js::RECOGNISE_REVENUE_ON` when the accountant's example CSV arrives.
  - **Role enforcement** — new `middleware/enforceRoleAccess.js` (fail-closed): accountants reach
    only `GET /api/accounting/*` + self routes (`me`, `logout`, `change-password`, `version`); every
    other endpoint returns **`403 FORBIDDEN_ROLE`**. Admin keeps full access.
  - **Admin can create / reset the accountant** from **Paramètres → Accès comptable** (new
    `SettingsAccountantAccessSection`). The accountant must change the temporary password on first
    login (reuses `mustChangePassword`).
  - **Client account format:** `C` + first 6 chars of the last name, uppercased, accent-stripped,
    padded with `X` if shorter — a common French convention. Trivially tunable in `accounting.js`.
  - **Visual journal preview** above the platforms table — one card per encaissement mirroring
    exactly what will be in the CSV, with the per-line account number paired with its human label
    (`Location gîte`, `TVA 10 %`, `Compte client`…), coloured by type (client/amber, revenue/green,
    VAT/blue), balanced badge per card and `Tout équilibré` chip in the header. Backed by a new
    `GET /api/accounting/sales` JSON endpoint (strict mirror of the CSV via
    `buildStructuredEntries`). For **admin only**, the client name is a link to the reservation file
    (accountant sees plain text).
  - **Dedicated change-password page** at `/settings/password`, accessible to every authenticated
    role (admin and accountant). Replaces the previous duplicate "Sécurité" cards on `SettingsPage`
    and `AccountingPage`. Admin sees a "Mot de passe" sub-item at the bottom of the Paramètres
    group; accountant has a minimal sidebar (Comptabilité, Mot de passe, Se déconnecter) and is
    client-side-redirected to `/comptabilite` from anywhere outside the two allowed paths.
  - New files: `constants/accounting.js`, `middleware/enforceRoleAccess.js`, `models/accountingModel.js`,
    `models/usersModel.js` (extended), `controllers/{accountingController, usersController}.js`,
    `routes/{accounting, users}.js`, `utils/{csv, accountingExport}.js`,
    `pages/AccountingPage.js`, `pages/ChangePasswordPage.js`,
    `components/SettingsAccountantAccessSection.js`.
  - Unit tests: `csv` (6), `accounting-export` (19), `enforce-role-access` (8), `users-model-admin` (7) —
    full server suite green (433).
- **Reservation payment dates + platform gross / commission** (spec
  `accountant-accounting-export.md`, PR 2): each reservation now records the **real encaissement date**
  for the deposit and the balance (`depositPaidDate`, `balancePaidDate`) — defaulted to today when the
  user marks paid, editable in the FinanceSection ("Payé le"), cleared on un-pay. For
  platform-sourced bookings, a new **"Prix payé par le client"** field (`clientGrossAmount`) captures
  the TTC amount the guest paid the platform; the **commission** is derived (`gross − finalPrice`,
  clamped at 0) and served alongside reservations as `commissionAmount`. Both the gross field and the
  commission caption are **hidden** for direct bookings. The write boundary rejects a gross below the
  net (`400 GROSS_BELOW_NET`). Unit tests: `client-gross-amount` (7), `reservations-commission` (7).
  Foundation for the monthly accounting CSV (PR 3).
- **iCal import — cross-platform de-duplication** (`propertyIcalModel.syncSource`): the same booking
  appearing in two platforms' feeds (same dates + guest name, different source + UID) now maps to the one
  existing reservation instead of creating a duplicate. Stale removal is cross-source-safe — a shared
  booking is only deleted once **every** feed drops it. Combined with the existing UID / per-source-fallback
  matching and the `icalSyncLocked` guard, a re-import never duplicates or overwrites a (user-modified)
  reservation. New `reservations.icalOriginalSummary` column stores the authoritative original guest name
  at import time (hidden from the frontend), so the date-scan legacy match stays reliable even after the
  user renames the client or edits the notes — instead of re-parsing the fragile `Résumé:` notes line.
  Guards: `property-ical-dedup.unit.test.js` (7).
  - **Migration:** `ALTER TABLE reservations ADD COLUMN icalOriginalSummary TEXT`; existing iCal rows are
    best-effort backfilled from their notes' `Résumé:` line.
- **Server-owned payment status** — new `utils/paymentStatus.js` (`computePaymentStatus`) is the single
  authority for `remainingDue` / `paymentComplete` / `depositOverdue` / `balanceOverdue` / `overdueAmount` /
  `oldestDueDate`, replacing two divergent client `getRemainingDue` copies. New
  `GET /api/finance/operational` returns the whole "Suivi opérationnel" section ready to render
  (overdue sorted + count + total, pending list, flat upcoming with `nights`). Reservation list + detail
  payloads now carry `remainingDue` + `paymentComplete`. Unit tests: `payment-status` (8), `finance-model` (4).
- **Server-side French public holidays** — new `GET /api/public-holidays?years=2025,2026` endpoint
  (`utils/frenchHolidays.js` Easter computation → `[{ date, label }]`, validated `?years=`, auth-gated).
  The calendar and the pricing-seasons page now **fetch** their "férié" markers instead of computing
  them client-side. Unit tests: `french-holidays` (5).
- **Show/hide password toggle** — new reusable `PasswordField` component (MUI TextField + eye
  adornment) used on the login screen and the change-password form (forced first-login change +
  Settings). Lets the user verify what they type, which notably surfaces browser-autofilled values.
- **Admin account recovery** — `cd server && npm run reset-admin` restores the default admin
  (`admin@guestflow.local` / `ChangeMe!2026`) with a forced password change and clears sessions, for
  when the password is lost (no manual DB editing). Backed by `usersModel.resetAdminToDefault()`
  (recreates the admin if missing) + unit tests. The admin password already persists across restarts
  (the seed only runs when the `users` table is empty).
- **Security hardening — headers, rate limiting, uploads, validation** (Bloc S PR 2, spec
  `security-hardening.md`):
  - **HTTP security headers** via `helmet`, including a CSP tuned for the SPA
    (`script-src 'self'` thanks to `INLINE_RUNTIME_CHUNK=false`; `style-src`/`font-src` allow MUI inline
    styles + Google Fonts; `img-src` allows uploaded images). Verified against a production build.
  - **Rate limiting** (`express-rate-limit`): login 10 failed/15 min/IP, global API 3000/15 min/IP
    (`429`), env-configurable; public iCal export exempt. Replaces PR 1's minimal throttle.
  - **Upload hardening**: document upload gains a 10 MB limit + extension/MIME allowlist; logo extension
    is whitelisted; file deletion is path-contained (`safeUploadPath`). New pure util `utils/uploadSafety.js`.
  - **Money/percentage validation at write boundaries**: reservations `POST`/`PUT`/`PATCH payment` and
    devis `POST`/`PUT` reject negative/NaN/out-of-range values (`400`) before any DB write
    (resourceBookings computes its price server-side, nothing to validate).
  - New deps: `helmet`, `express-rate-limit`. Unit tests: `upload-safety` (6). Full suite green (247).
- **Security foundation — authentication + credential encryption** (Bloc S PR 1, spec
  `security-auth-encryption.md`):
  - **All `/api` routes now require a logged-in session** (fail-closed in `index.js`), except
    `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, the public
    `GET /api/ical/export/:token` feed, and `GET /api/version`.
  - Server-side sessions (`express-session` + `better-sqlite3-session-store`) via an httpOnly,
    `sameSite=lax`, prod-`secure` cookie (30-day sliding); password hashing with `scrypt` (no new crypto
    dep). New `users` table (multi-user-ready, `role` default `admin`).
  - **Default admin + forced first-login password change**: seeded `admin@guestflow.local` /
    `ChangeMe!2026` with `mustChangePassword`; the default password only opens the "set password" screen
    (other routes return `403 PASSWORD_CHANGE_REQUIRED`). Documented in the README.
  - **Google credentials encrypted at rest** (AES-256-GCM) in `settingsModel`, key auto-generated into
    `server/.env.local`; transparent one-time boot migration of legacy cleartext values.
  - Client: `LoginPage`, `useAuth` context (gates the app), forced password-change screen, "Se
    déconnecter" in the sidebar, "Sécurité → Changer le mot de passe" in Settings; `api.js` sends the
    session cookie and redirects to login on 401. Minimal login throttle (full rate limiting in PR 2).
  - New server files: `utils/encryption.js`, `utils/localEnv.js`, `utils/passwordHash.js`,
    `models/usersModel.js`, `middleware/requireAuth.js`, `controllers/authController.js`,
    `routes/auth.js`, `constants/authDefaults.js`.
  - Unit tests (+28): `encryption`, `password-hash`, `users-model`, `require-auth`, `auth-controller`,
    `settings-model-encryption`. Full suite green (241).
- **Pricing engine — server-authoritative, thin client** (Bloc 2, spec `pricing-engine-thin-client.md`):
  - Quote now returns `engineFinalPrice` (engine-computed price ignoring any manual override) and
    `priceOverridden`, so the UI shows the engine price struck through with the manual price in green.
    The manual price (`customPrice`) overrides the **accommodation** amount and drives the accommodation
    VAT base; options/resources add on top.
  - New `server/src/utils/financeValidation.js` (`validateMoneyAmount`, `validatePercentage`,
    `validateFinanceInputs`) enforced at `POST /api/reservations/calculate-price` (rejects negative/NaN
    amounts and out-of-range percentages with `400 NEGATIVE_AMOUNT|NOT_A_NUMBER|INVALID_PERCENTAGE`).
  - Option/resource summary lines are returned in display order (by title / name) instead of insertion
    order; custom options keep their input order last.
  - Unit tests: `finance-validation.unit.test.js` (6 cases), `pricing-offered-engine.unit.test.js`
    (6 cases). Full suite green (213).
- **School holidays** redesigned with auto-sync + Gantt timeline (spec `school-holidays.md`):
  - Page `/school-holidays` rebuilt as a **Gantt-style annual timeline**: one card per French school year (Sept → Aug), 12-month axis, 3 stacked zone lanes (A/B/C) with colored bands per period. Click a band → edit dialog.
  - **Auto-sync from `data.education.gouv.fr`** ([fr-en-calendrier-scolaire](https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/)) via Node's built-in `fetch` (no new dependency). User-configurable interval (default 60 d, range 1–365) and horizon (default 24 months, range 1–60). Scheduling is a 1-hour tick that re-reads the config from DB on every fire — settings changes take effect without a restart.
  - **Lock semantics** (per user choice "Manuel verrouille auto"): editing an auto-imported row sets `isLocked = 1`, the sync engine then skips it. A "Réactiver la mise à jour automatique" button in the edit dialog flips it back.
  - **Manual sync trigger** + **settings gear** on the page (banner + `PageActionBar` icon).
  - Full MVC backend: `routes/schoolHolidays.js` (thin), `controllers/schoolHolidaysController.js`, `models/schoolHolidaysModel.js` (factory), `utils/schoolHolidaysValidation.js`, `utils/schoolHolidaysSync.js`, `utils/educationGouvClient.js`.
  - New client components: `SchoolHolidaysTimeline`, `SchoolYearStrip`, `SchoolHolidayBand`, `SchoolHolidaysSyncBanner`, `SchoolHolidaysSyncSettingsDialog`. New `client/src/constants/schoolHolidayZoneColors.js` is the single source of truth for the zone color palette. New util `client/src/utils/schoolYear.js` groups periods by school year.
  - Unit tests: `school-holidays-validation.unit.test.js` (14 cases), `school-holidays-model.unit.test.js` (15 cases), `school-holidays-sync.unit.test.js` (10 cases) — all green.
- **Establishment closures** feature — revives orphan code into a working flow:
  - Top-level sidebar entry "Fermetures" → CRUD page at `/establishment-closures` built around the shared `PageActionBar` + `TableCard` + `FormDialog`.
  - Per-property + global scoping (`propertyId IS NULL` = blocks all logements, `propertyId = X` = blocks only logement X).
  - Server-side overlap detection: reservations conflicting with a closure return `409 CLOSURE_COVERS_DATE`; competing closures return `409 CLOSURE_OVERLAP`.
  - Calendar visualization: closed days render as gray-striped bands with the closure label, tooltip showing `<label> — du <start> au <end>`. Drag-create on closed days is auto-blocked because `getOccupiedDates` now appends closure dates.
  - Full MVC backend: `routes/establishmentClosures.js` (thin), `controllers/establishmentClosuresController.js`, `models/establishmentClosuresModel.js` (factory), `utils/establishmentClosuresValidation.js`.
  - New schema: `establishment_closures` table + `idx_establishment_closures_propertyId_dates` (added to the DB-hygiene index catalog).
  - New client util `utils/closureCalendar.js` (`expandClosuresToDates`, `getClosureForDate`).
  - Unit tests: `establishment-closures-validation.unit.test.js` (6 cases), `establishment-closures-model.unit.test.js` (~15 cases covering global/per-property semantics, night-block expansion, excludeId on edit).
- **DB Hygiene pass** (Bloc 0) — `server/src/utils/dbHygiene.js`:
  - 30 foreign-key indexes (`CREATE INDEX IF NOT EXISTS`) covering every FK column that is filtered or joined in routes — eliminates table scans on `WHERE propertyId = ?`, `WHERE reservationId = ?`, etc.
  - 2 iCal anti-overbooking lookup indexes: `idx_reservations_ical_source(sourceIcalSourceId, sourceIcalEventUid)` (primary sync lookup) and `idx_ical_import_events_reservationId` (reverse lookup on reservation deletion). Documented in `specs/db-hygiene-quick-wins.md` §1.1.
  - 2 unique indexes blocking duplicates at the DB level: `uniq_resource_bookings_slot(resourceId, date, startTime, endTime)` and `uniq_ical_sources_property_platform(propertyId, platformKey)`. Pre-check warns and skips the index when existing data already contains duplicates (no breakage).
- Unit tests: `server/src/tests/db-hygiene.unit.test.js` (13 cases covering index presence, unique-constraint rejection, duplicate pre-check warning path, FK-blocked drop graceful handling, query-planner usage).
- Shared sticky `PageActionBar` component used by every page (built-in Save + Cancel + `actionsBefore` / `actionsAfter` slots, icon-only with French tooltips, bordered IconButton style matching the legacy ReservationPage bar).
- Generic UI components: `LogoUpload`, `MaskedTextField`, `HelpedTextField`, `StatusBadge`, `StatusCard`, `SummaryItem`.
- `useDirtyFormGuard` hook encapsulating dirty-state detection + `beforeunload` + `popstate` + `window.__guestflowBeforeNavigate` integration.
- Settings page (Paramètres) redesign — three section cards (Société + Devis + Google Agenda) under the shared `PageActionBar`, humanized French vocabulary and helper texts everywhere, server-side validation for every critical field.
- "Tester la synchronisation" action on the Google Agenda section + `POST /api/google-calendar/test-connection` endpoint with friendly French error mapping (NOT_CONFIGURED / INVALID_CREDENTIALS / FORBIDDEN / CALENDAR_NOT_FOUND / UNKNOWN).
- Server-side validators (`utils/settingsValidation.js`): email, SIRET (14 digits, whitespace-tolerant), TVA intracommunautaire, IBAN (mod-97), BIC, PEM (permissive — accepts RSA, EC, PKCS8), quote validity days.
- Unit tests: `settings-validation.unit.test.js`, `settings-response.unit.test.js`, `settings-model.unit.test.js`, `google-calendar-test-connection.unit.test.js` (44 new test cases, all passing).
- **Production now serves HTTPS directly on `:4000`** (no Nginx / Caddy in front). On first deploy
  the GitHub Actions workflow runs `server/scripts/generate-self-signed-cert.sh` and stores the
  result in `~/guestflow/certs/` (persistent across deploys), then PM2 starts with
  `HTTPS_ENABLED=true` + `TLS_CERT_PATH` / `TLS_KEY_PATH` pointing at the persistent location.
  Node loads the cert via the new `server/src/utils/httpsBootstrap.js` builders and uses
  `https.createServer` instead of plain `http.createServer`. The cert generation script
  auto-detects every local IPv4 + hostname + localhost for the SAN list; it can also be invoked
  manually with explicit IPs / hostnames or with `--force` to regenerate before expiry. Cert + key
  are gitignored (`server/certs/*.crt` / `*.key`). Bootstrap pins a hard safety: when
  `HTTPS_ENABLED=true` but the cert or key files are missing, the server **refuses to boot** with
  a clear error pointing at the helper script — no silent downgrade to HTTP that would leak a
  `Secure` cookie over plain transport. 9 new test cases in `https-bootstrap.unit.test.js` lock
  the boot decision (HTTP path, HTTPS path, both files missing, one missing, env var overrides,
  no-app guard). The browser warns once per device that the cert isn't trusted by a known CA
  (expected — self-signed for a LAN-only deploy); after acceptance HSTS makes HTTPS sticky for
  1 year. README §HTTPS documents the per-device cert-trust workflow (accept-once OR install
  rootCA) + the HSTS-clearing instructions for every major browser. Access changes from
  `http://<your-pi-lan-ip>:4000` to `https://<your-pi-lan-ip>:4000`.
- **Admin visibility of WordPress booking requests** (spec `admin-public-request-visibility.md`, 2026-06-09). In the Devis list, booking requests submitted from the WordPress showcase site (public API, `requestOrigin='public'`) now show a **"WordPress"** badge, and a new **"Origine"** filter (Toutes / Demandes WordPress / Devis internes) lets the operator narrow to them. Server-side filter on `GET /api/devis?requestOrigin=public|internal`. +1 server test. (Builds on the public API.)
- **SAS d'arrivée et de départ (check-in / check-out guidés)** (spec `arrival-departure-sas.md`, 2026-06-12). Un clic sur une carte d'arrivée (resp. une ligne de départ) du planning ouvre une **suite de pages guidées**, chacune avec un bouton **Quitter**. Tout est accumulé en mémoire et **enregistré en une fois** au récapitulatif final.
  - **Arrivée** : récap séjour → **code portail** → **caution** (Fait / Reporté) → options réservées → **linge de lit** (si l'alerte couverture/non-pris) → **éléments manquants tarifés** → **ménage** (inclus = rappel vaisselle/poubelles ; sinon proposer au tarif du logement) → **récapitulatif** du complément (existant + ajouts détaillés). Les ajouts sont écrits en options custom *in-complément* et le complément d'arrivée est mis à jour.
  - **Départ** : ménage fin de séjour (OK / Pas OK) → **serviettes/draps manquants** (liste tarifée) → **réception des clés** → **rendre la caution** (Rendue / Litige) → récap. Le ménage non fait + les éléments manquants alimentent un **complément de fin de séjour séparé** (nouveau montant sur la résa).
  - **Réglages → « Stock blanchisserie » renommé « Blanchisserie »** : deux tableaux éditables de tarifs (éléments de linge de lit + serviettes, variantes libres) ; nouveau champ **Code portail** (global, dans les Réglages généraux).
  - Nouvelle table `linen_priced_items` ; colonnes `endOfStayComplement*` sur `reservations` ; `app_settings.portalCode`. Endpoints `GET /reservations/:id/sas`, `POST …/sas/arrival`, `POST …/sas/departure`, `GET/PUT /settings/linen-items`. +8 tests serveur.
- **Aventura Lodge — tarification tout compris 2026** : première recette livrée. Prix tout compris (linge et ménage inclus), cible nette remontée par la commission de chaque canal, **dégressivité du document tarifaire reprise telle quelle** (24/33/38/41/43/45 % de 2 à 7 nuits — les huit cas de contrôle du document sont reproduits à l'euro près), supplément personne supplémentaire facturé **par nuit** et soumis à la même dégressivité, week-ends fériés montés d'un cran de saison **avec un minimum de séjour égal à la longueur du pont** (2 nuits pour un férié vendredi ou lundi, 3 nuits pour un pont), fermeture hivernale du 15 octobre au 31 mars.
- **Supplément lit bébé** (spec `baby-bed-supplement.md`, 2026-08-20). Ajouter un lit bébé sur une fiche facture désormais **5 € par lit, pour l'ensemble du séjour**, sur tous les canaux. La ligne est dérivée par le moteur de prix depuis le compteur « Lits bébé » — rien à cocher, et sur une réservation plateforme elle part automatiquement en complément encaissé sur place. Le tarif s'édite dans Paramètres → Options (prix unique ou par logement ; un prix de 0 € retire complètement la ligne pour ce logement), et le bouton « Offrir » du récapitulatif l'annule en un clic. Le devis, le PDF et le tunnel du site public appliquent le même prix. **Aucune réservation déjà enregistrée ne bouge** : une résa vendue avec un lit bébé avant cette version ne prendra jamais la ligne, quel que soit le recalcul. +39 tests serveur, +6 tests client.
- **Off-device backup & restore of the production Pi** (spec `backup-restore.md`, 2026-08-09).
  `scripts/backup-from-pi.sh` pulls a complete snapshot from the Raspberry Pi to a workstation —
  SQLite database via `sqlite3 .backup` (WAL folded in, `PRAGMA integrity_check` enforced),
  `data/.env.local` (the encryption key, without which the encrypted settings columns are
  unreadable), `certs/` and `server/uploads/` — into a timestamped `0700` directory with a
  manifest, SHA-256 checksums, a `latest` symlink and 30-backup rotation.
  `scripts/restore-to-pi.sh` pushes a backup back: stops PM2, archives the current DB and
  `.env.local` as `*.pre-restore-<stamp>`, clears the stale WAL/SHM, re-creates the deploy
  symlinks and restarts PM2. Documented in README §"Backup & restore" with the disaster-recovery
  runbook. No application code touched.
- Réservations : si un paiement en ligne est encaissé alors que les dates sont devenues indisponibles, la réservation est créée mais **signalée en conflit** — un email avertit l'admin et un badge « Conflit de dates » apparaît sur la fiche et le calendrier.
- **Booking notifications & site-request dashboard alert** (spec `site-booking-notifications.md`, 2026-06-11). GuestFlow now emails the operator on **a new website devis** and on **each new iCal reservation** imported — sent from the SMTP sender to a configurable recipient (empty → falls back to the sender), with a direct link (reusing the public URL). A new **Paramètres → Notifications** block adds an on/off switch (ON by default) and the recipient address. The dashboard gains a **"Demandes de devis depuis le site"** alert listing pending site-origin devis. Notifications are best-effort (never block the booking response or the iCal sync). +12 server tests.
- **Breakfast time** (spec `breakfast-time.md`, 2026-06-08). The breakfast option carries a default hour (`options.breakfastTime`, default 09:00, editable on the Options page), overridable per reservation via a "Heure souhaitée" field on the reservation page (`reservations.breakfastTime`). The planning breakfast card shows each breakfast's time and lists same-day breakfasts sorted by time (ascending). Effective time resolved server-side as COALESCE(reservation, option, 09:00). +4 tests.
- Finance : le complément de fin de séjour (relevé au SAS départ) est désormais traité comme le complément d'arrivée — interrupteur « payé » + date sur la fiche, pris en compte dans le suivi financier, la compta et l'export.
- Finance : chaque complément (arrivée + fin de séjour) peut être marqué « Caisse interne » — il reste compté dans le suivi financier (c'est de l'argent encaissé) mais est exclu de la comptabilité et de l'export comptable. Visible sur la fiche.
- **Indemnité d'annulation versée par la plateforme** (spec `cancellation-compensation.md`, 2026-08-19).
  Valider une annulation iCal demande désormais si la plateforme doit une indemnité pour le séjour
  annulé : la réservation est supprimée comme avant, mais un instantané (logement, plateforme, client,
  dates, prix du séjour perdu) est figé dans la même transaction. L'indemnité reste **modifiable tant
  qu'elle n'est pas versée**, est rappelée sur le tableau de bord (badge « En retard » passé la date
  prévue), puis s'encaisse à sa date réelle — moment où elle produit une écriture équilibrée (débit
  compte client / crédit `75880000`, hors TVA par défaut) dans le journal **et** le CSV du mois du
  versement. Nouvelle section « Indemnités d'annulation » sur la page Comptabilité (lecture seule pour
  le rôle comptable), compte paramétrable dans le Plan comptable, taux de TVA dans Réglages → Général.
  +48 tests serveur, +11 tests client.
- **Assurance annulation de séjour** (spec `cancellation-insurance.md`, 2026-08-19). Nouvelle option
  « Assurance annulation » au catalogue, avec un nouveau type de prix générique **« % du montant du
  séjour »** : la prime se calcule sur l'hébergement du séjour (nuits après remise + supplément
  voyageurs, hors options, ressources et taxe de séjour), avec un pourcentage paramétrable — global
  ou par logement — ou, au choix, un montant fixe. Tant que le tarif est à 0, l'assurance n'est
  proposée nulle part. Sur le site WordPress, elle sort de la liste « Options & suppléments » pour
  avoir **son propre encart, avec un choix Oui / Non obligatoire** avant validation : le montant réel
  du séjour y est affiché, calculé par le serveur. Prime figée une fois le séjour vendu, jamais
  proposée au check-in. +36 tests serveur, +4 tests client, plugin WordPress 1.5.0.
- **Personnes servies sur une option à carte** (spec `card-option-served-persons.md`, 2026-08-20). Un repas ou un petit déjeuner facturé par personne n'est plus imposé à toute la tablée : le nombre de couverts se règle **au check-in** (un pas-à-pas sous la grille des moments, pages « Quels matins ? » et « Restauration ») **et sur la fiche** (champ « Personnes servies », à la place du « Qté » masqué des options à carte). Le moteur facture `moments × personnes servies` (borne : 1 → capacité du logement), la carte du planning annonce « 2 couverts » à la cuisine, la préparation du petit déjeuner et son pré-remplissage (viennoiseries, pain) suivent le nombre vendu, et l'historique du check-in détaille « 1 × 2 pers. servies ». Rien ne change pour une prestation servie à toute la tablée.
- **Jour de changement** : une saison (ou une plage de dates) peut imposer un jour d'arrivée et/ou de départ (« du samedi au samedi »). Contrôlé à l'enregistrement d'une réservation comme le minimum de nuits, avec la même possibilité de forcer ; les imports iCal ne sont jamais bloqués. Le calendrier de la gestion tarifaire signale les jours d'arrivée et de départ autorisés, affiche désormais le minimum de nuits dès qu'il dépasse 1 (et plus seulement sur les plages qui surchargent leur saison) et gagne une légende.
- **Minimum de séjour sur les ponts** : une recette peut imposer, sur chaque bloc de jours fériés, un minimum égal à la longueur du pont — plus de nuit isolée sur un week-end férié.
- Check-in (SAS d'arrivée) : nouvelle page d'alerte météo affichée juste avant le récapitulatif quand une vigilance Météo-France Orange ou Rouge (canicule, orages…) touche le domaine pendant le séjour du client. Le phénomène, la couleur, le créneau (dates/heures) et un message sont repris, avec des consignes spécifiques (canicule → feux interdits + zones fumeurs ; orages → horaire de l'épisode). Rafraîchie en arrière-plan à l'ouverture du check-in ; s'affiche uniquement en cas d'alerte.
- Paramètres : nouvelle carte « Alertes météo » pour renseigner la clé API Météo-France (Vigilance). Sans clé, la fonction reste inactive.
- **CI: unit tests on every PR to master** — new `.github/workflows/unit-tests.yml` runs the server (`node --test`) and client (`vitest`) suites on each pull request to `master` (and on push to `master` as a post-merge guard), in two parallel jobs. This gates the full public API coverage (auth, anti-leak projections, price-immutability, read-only GET, quote + booking flows, and the HTTP integration test for router wiring + rate limiters) on every PR, alongside the existing Playwright E2E smoke workflow. Mirrors the E2E workflow conventions (Node 24, `better-sqlite3` rebuilt from source).
- Fiche client : l'adresse se saisit désormais en une seule ligne (« 12 rue des Lilas 07000 Privas ») et
  le serveur la répartit entre le numéro, la rue, le code postal et la ville — les quatre champs restent
  visibles et corrigeables.
- Fiche client : un lien déposé depuis une page web dans les champs Email ou Téléphone n'insère plus son
  `href` brut. Seule la valeur utile est conservée (`mailto:…?subject=…` → `jean.dupont@example.com`,
  `tel:+33627753922` → `0627753922`). Seul l'indicatif `+33` est ramené à `0` : les numéros étrangers
  gardent le leur (`+32475123456`).
- **Clients : « À venir » et « Passés », avec la date de séjour.** La page Clients s'ouvre sur les
  clients attendus (séjour en cours ou à venir, plus ceux sans séjour), avec un onglet « Passés » à
  côté ; chaque onglet affiche son nombre de résultats pour la recherche en cours. Une colonne
  « Séjour » donne la date du prochain séjour — ou du dernier quand il n'y en a plus — et les entêtes
  Nom, Prénom et Séjour trient la liste d'un clic, comme sur les tarifs facturables. (#19)
- Réglages → Notifications : nouvel interrupteur « Email à chaque nouvelle réservation plateforme (iCal) » (activé par défaut) pour désactiver l'email envoyé lors d'une nouvelle réservation importée d'une plateforme, sans toucher à l'email de nouvelle demande de devis ni à l'interrupteur maître.
- **Design system « Maison » — phase 2: component library & feedback** (spec `ds-components.md`, 2026-07-15). New shared generics: `LoadingState`, `EmptyState`, `ErrorAlert` (with « Réessayer »), `PlatformChip`, `UnsavedChangesDialog` (one canonical dirty-form prompt), `ResponsiveTable` (table on desktop, cards on mobile), app-level `ErrorBoundary` + a « Page introuvable » screen for unknown URLs (both used to render a blank page). One feedback channel: `useToast()` success/error snackbars replace the 6 divergent patterns (inline Alerts, `window.alert`, success modals, silent saves — PropertyDetail now confirms its save); load failures show a persistent retryable `ErrorAlert` instead. Shared dialogs (`FormDialog`/`ConfirmDialog`/alert) are now truly fullScreen on mobile. Clients / Historique emails / Options / Ressources get the sticky action bar via the scaffold; the status chips move to the soft « Maison » style; the comptabilité-plateformes table is scroll-contained. `/design` v2 showcases every component interactively; written reference in `specs/design-system-reference.md`. +24 client tests, +1 E2E smoke.
- **Acompte éditable** (spec `editable-deposit-amount.md`, 2026-06-11). Sur une réservation directe, le montant de l'acompte peut être saisi manuellement : il est alors figé et le solde absorbe toute évolution du tarif (options ajoutées, etc.). Vider le champ rétablit le calcul automatique (% du logement). +9 tests serveur.
- Historique des emails : bouton « Renvoyer » sur chaque ligne (envoyé, échec ou ignoré) pour ré-expédier un email déjà traité — le contenu est régénéré à partir du modèle et reste éditable avant l'envoi.
- Possibilité de générer les emails d'une réservation **en français ou en anglais** : une langue d'email se choisit sur la fiche de réservation, et les rappels J-7 / J-2 par défaut sont désormais fournis avec leur traduction anglaise. Un modèle peut porter un sujet/corps anglais (champs « Sujet (EN) » / « Corps (EN) » dans l'éditeur) ; sans version anglaise, l'email part en français.
- **Emails page — fix a missing client email in one click** (spec `email-automation.md`). In the « Emails à envoyer » list, the red **« Adresse manquante »** chip is now clickable: it opens the client's fiche (same form as elsewhere) with the cursor on the **email** field. Saving updates the client (`PUT /api/clients/:id`) and refreshes the queue, so the email can be sent without leaving the page. `listPending` now exposes `clientId`. +2 tests.
- SAS : contrôle du **plomb des extincteurs** à l'arrivée et au départ. À l'arrivée c'est un constat (par défaut considéré présent) ; au départ, si le plomb est manquant alors qu'il était présent à l'arrivée, le **remplacement est facturé** dans le complément de fin de séjour. Le montant — et d'autres **montants de réparation** — se règle dans Réglages → **« Tarifs facturables »**, une nouvelle section qui regroupe aussi le **prix du linge** (déplacé depuis la page Stock blanchisserie). Les SAS gagnent au passage un bouton **« Précédent »** pour revenir à l'étape précédente.
- **Suivi financier** : chaque carte de montant (Revenu total, Encaissé, En attente de règlement, Revenus depuis le début de l'année, Revenu total sur l'année) est désormais cliquable et ouvre le détail des réservations qui composent ce montant, avec une colonne dont le total correspond exactement au chiffre de la carte ; un clic sur une ligne ouvre la fiche de réservation.
- Suivi financier « Vue générale » — le graphique devient « **Revenu par logement** » avec deux
  onglets : « Sur la période » (fenêtre du/au, comportement existant) et « **Depuis le début de
  l'année** » (1er janvier → aujourd'hui, même base que la carte annuelle globale). Chaque barre
  affiche son montant TTC avec le **HT en dessous, en discret** (et l'infobulle TTC + HT) ; la
  légende précise « montants TTC ». Même base de calcul que les cartes globales (Σ total de séjour,
  net de commission, caisse interne exclue, par date de départ), filtrée par logement.
  (specs/finance-per-property-revenue-chart.md)
- **Exercice comptable paramétrable + nuits vendues par logement** (spec `fiscal-year-and-nights-sold.md`, 2026-08-12). Paramètres → Général accueille une carte « Exercice comptable » où l'on choisit le **mois de clôture** (défaut décembre = année civile) : régler septembre fait courir l'exercice du 1er octobre au 30 septembre, et tout le Suivi financier se lit désormais à travers cet exercice, avec un **sélecteur d'exercice** (mémorisé dans l'URL, `?exercice=`) qui permet de consulter un exercice passé. Les deux cartes annuelles affichent le **nombre de nuits vendues par logement** (« Gîte 53 nuits · Aventura lodge 20 nuits »), le graphique « Revenu par logement » les affiche sous le montant HT de chaque barre (et au-dessus de la barre quand elle est trop courte), et le détail d'une carte gagne une colonne « Nuits ». +49 tests serveur, +7 tests client, +1 test E2E.
- **J-1 arrival reminder email** (spec `j1-arrival-reminder-email.md`, 2026-06-12). A new default template **"Rappel arrivée — J-1"** (manual mode) recaps the stay (dates, hours, booked **options _and_ resources**) and adds three warm, conditional reminders shown only when relevant: bring a **caution cheque** when the deposit is still owed (`{{#if cautionNotReceived}}`, keyed on `cautionReceived`), bring **your own bed linen** when the linen option was not booked (`{{else}}` of `{{#if hasBedLinenOption}}`), and that the **end-of-stay cleaning is at your charge** when the "Ménage" option was not booked (`{{else}}` of the new `{{#if hasCleaningOption}}`). New template tokens/flags: `{{resourcesList}}`, `hasResources`, `cautionNotReceived`, `hasCleaningOption` — all available to every template and exposed as picker chips in the editor. +11 server tests. NOTE: existing installs get the J-1 template on next boot (insert-only seed); an operator who already created a J-1 keeps theirs.
- **J-1 reminder — unpaid complement to collect** (spec `j1-complement-to-collect.md`, 2026-06-12). When a reservation still has an **unpaid complement**, the J-1 email now tells the guest the amount to settle on arrival, and — when the complement is made of identifiable items — lists **what it corresponds to** (the options/resources/custom-options flagged *in complement*, plus the tourist tax when applicable), e.g. *« Un complément de 55,00 € sera à régler directement sur place à votre arrivée. Il comprend notamment : Petit déjeuner (15,00 €), Bain nordique (40,00 €). »*. Computed server-side as `{{complementNotice}}` + `complementToCollect` flag (and a `{{complementAmount}}` token); the email loader now also reads `reservation_custom_options`. The seeded J-1 body is upgraded in place on existing installs (operator edits preserved). +8 server tests.
- **J-7 email — baby-bed notice** (spec `j7-email-baby-beds.md`, 2026-06-08). For bookings with one or more babies, the J-7 arrival reminder now says either how many baby beds are provided, or — when no baby bed is available for the dates — that the guest should bring one. Computed server-side as a `{{babyBedNotice}}` variable + `{{#if hasBabyBedNotice}}` flag; added to the default J-7 template body. +7 server tests. NOTE: existing (operator-owned) J-7 templates are not auto-updated — add the `{{#if hasBabyBedNotice}}{{babyBedNotice}}{{/if}}` snippet via Paramètres → Emails, or delete the J-7 template to re-seed.
- Blanchisserie : nouvelle option « Tapis de bain » (comme le linge de lit/toilette) avec prix, « offert » et « inclus par défaut » par logement, plus une quantité de tapis par location configurable par logement. Les tapis sont comptés dans les cartes blanchisserie du Planning (à apporter / à récupérer) et dans la projection de stock, avec un nouveau champ de stock « Tapis de bain ».
- Options : nouvel interrupteur « Afficher côté client (fiches & emails) » sur chaque option. Désactivé = usage interne (le tapis de bain l'est par défaut) : l'option est masquée des fiches de réservation, des emails clients, du devis et de la réservation en ligne. Selon le type d'option, elle reste utilisée en interne — les options de linge sont comptées dans les cartes blanchisserie et le stock, les autres (petit-déjeuner, repas…) conservent leur carte de préparation dans le planning.
- Blanchisserie : **voyage exceptionnel** à une date libre (spec `laundry-extra-trip.md`, 2026-08-19). Depuis la barre d'action du Planning (admin uniquement), on déclare un aller-retour hors du jour hebdo : on apporte tout le linge sale accumulé et on récupère tout ce qui est à la blanchisserie — ou seulement une partie, saisie par type de linge (préremplie et plafonnée par ce qui s'y trouve). La carte « Voyage blanchisserie exceptionnel » apparaît ce jour-là (crayon / corbeille, reste à la blanchisserie en cas de récupération partielle), les cartes hebdo voisines sont recalculées (dépôt depuis le voyage exceptionnel, récupération de tout ce qui est à la blanchisserie), et la projection de stock + l'alerte de rupture suivent, y compris pour une date passée. Le rôle accueil voit la carte sans pouvoir créer, modifier ni supprimer. Le calcul « À apporter / À récupérer » repose désormais sur une séquence de voyages (hebdo non sautés + exceptionnels) avec un stock à la blanchisserie en pool — identique à l'existant sans voyage exceptionnel. +47 tests serveur, +13 tests client, +3 E2E.
- **Blanchisserie : retirer le linge que vous lavez vous-même.** Le crayon de la carte blanchisserie
  accepte désormais des valeurs négatives : « −2 draps simples » sort ce linge du voyage (il n'est plus
  ni à apporter ni à récupérer) et le remet en stock propre le jour même. La carte l'annonce avec une
  mention « dont lavé par vos soins », distincte de « dont ajout manuel ». Le retrait est plafonné à ce
  qui est réellement sale, et les quantités affichées ne descendent jamais sous zéro. (#428)
- **Create an email from a template on demand** (spec `manual-email-from-template.md`, 2026-06-12). The Emails page gains a **« Créer un email »** button: pick a reservation (searchable by client name over all reservations) and a template, and the email lands immediately in **« Emails à envoyer »** — independent of the template's date window. Manually-added rows carry an **« Ajouté manuellement »** badge. If that template was already **sent** for that reservation, a confirmation warns with the last send date and lets the operator **recreate** (resend) or cancel. Sending or skipping the email removes it from the queue. New `email_manual_queue` table + `POST /api/emails/queue` and `GET /api/emails/eligible-reservations`; the pending list now merges date-driven + manually-queued pairs (deduped). +17 server tests.
- Planning laundry card: a **＋ button** lets the operator add **manual linen** (draps simple/double/bébé, serviettes grande/moyenne/petite) to a laundry trip on top of what the reservations imply. The amounts fold into « À apporter », come back on the next trip's « À récupérer », and impact the « disponible après ce dépôt » stock — washed like reservation linen (and deferred to the next trip when a trip is skipped). A discreet « dont ajout manuel » caption shows the manual part.
- **Mark a pending email as sent** (spec `mark-email-sent-manually.md`, 2026-06-12). In « Emails à envoyer », a new **« Marquer comme envoyé »** action records an email as sent **without** GuestFlow sending it — for messages the operator sends from the booking platform's own messaging (Airbnb, Booking…). It leaves the queue and is logged as **sent** with the new `email_log.channel='manual'`, shown in the history as a distinct **« Envoyé manuellement »** badge (vs « Envoyé » for SMTP sends). No recipient email required. New `POST /api/emails/pending/:templateId/:reservationId/mark-sent`. +5 server tests.
- **Durée maximale de séjour** : une saison (ou une plage de dates) peut plafonner le nombre de nuits. Contrôlé à l'enregistrement comme le minimum, avec la même possibilité de forcer ; les imports iCal ne sont jamais bloqués. Sur un séjour à cheval sur plusieurs saisons, c'est le plafond le plus restrictif qui s'applique. L'Aventura Lodge est plafonnée à **7 nuits**.
- **Dates bloquées à l'application d'une recette** : les périodes que la recette n'a pas pu écrire — parce qu'une saison créée à la main les occupe — sont désormais listées date par date dans un encart rouge de l'aperçu, avec le nom de la saison qui bloque, au lieu d'être noyées dans un message.
- **Fermetures dans la gestion tarifaire** : les jours fermés apparaissent en gris sur le calendrier (sans couleur de saison, sans marqueur) et disparaissent des plages affichées dans le tableau des saisons. **Masquage d'affichage uniquement** — les plages enregistrées gardent leur étendue complète, donc déplacer ou supprimer une fermeture réaffiche les jours sans rien réappliquer.
- **Tableau des saisons trié par date**, à partir de la première date réellement couverte par chaque saison.
- **Prestations vendues en cours de séjour → complément de fin de séjour** (spec
  `mid-stay-extras-to-end-of-stay-complement.md`, 2026-08-06). Une option, une ressource ou une ligne
  personnalisée ajoutée **après l'arrivée du client** est désormais facturée dans le **complément de
  fin de séjour**, détaillée ligne par ligne (« Petit-déjeuner : 2 × 12 € = 24 € »), visible sur la
  fiche de réservation et dans le SAS de départ, et encaissée au check-out. Auparavant cet argent
  n'était réclamé nulle part : les quatre buckets se figent dès qu'ils sont réglés, donc le total du
  séjour montait sans qu'aucune échéance ne bouge (réservation soldée à tort, CA sous-évalué, et
  écriture comptable `complement` qui créditait plus de produit qu'elle ne débitait). Le découpage se
  fait **au montant** : passer une option de 1 à 2 unités pendant le séjour ne bascule que l'unité
  ajoutée. Le « Total du séjour » de la fiche intègre maintenant tout le complément de fin de séjour,
  comme la page Finances le faisait déjà. Un montant déjà encaissé n'est jamais modifié
  automatiquement. +34 tests serveur, +2 tests client.
- **Notes en séjour — encaisser une prestation pendant le séjour** (spec `mid-stay-notes.md`,
  2026-08-06). Un client qui prend une option en cours de séjour peut désormais la **régler tout de
  suite** (CB ou caisse interne) ou la **laisser pour le départ**, prestation par prestation.
  Nouveau bouton **« + Nouvelle note »** sur la fiche : une fenêtre où l'opérateur coche ce qui reste
  à percevoir, ajoute des prestations au catalogue (mêmes catégories que la fiche), et clôt la note
  d'un seul choix de règlement. Les notes réglées s'accumulent dans un nouveau bloc **« Encaissements
  en séjour »** (total courant + historique dépliable avec date, mode et détail, chaque note
  annulable). Le complément de fin de séjour devient simplement **le reste** : ce qui n'a pas été
  réglé pendant le séjour + ce que le SAS de départ facture, encaissé au check-out comme avant.
  Chaque note produit **sa propre écriture comptable** à sa date (TVA au taux général, compte
  produit « options ») ; une note en caisse interne reste comptée dans le suivi financier mais hors
  compta, comme les compléments. Le découpage tient le cas du bar : 2 petits-déjeuners d'hier non
  réglés, le client ne paie que celui d'aujourd'hui → la ligne est scindée, le reste demeure dû.
  +26 tests serveur, +14 tests client.
- Online-payments groundwork: a secure **Qonto** bank connection (OAuth2) for issuing payment links, the encrypted token storage + auto-refresh, the `payment_links` data model, and fully operator-configurable payment reminder/deadline durations. First step of the online-payment feature (deposit / balance) — not yet operator-facing.
- Les options de séjour peuvent être rangées dans une **catégorie** (champ libre dans Paramètres →
  Options, avec suggestion des catégories déjà utilisées). Sur la fiche réservation et sur le widget
  de réservation du site, chaque catégorie s'affiche en **menu dépliant replié par défaut**, placé
  après les options sans catégorie. Les options déjà cochées restent visibles même menu replié, avec
  un compteur dans l'en-tête — un menu fermé ne peut jamais masquer une ligne facturée.
- Nouveau catalogue **Boissons** (9 articles : bières du Pilat, jus du Pressoir du Pilat, champagne)
  et **Restauration** (5 planches apéro Terroir Ardèche + Le repas des trappeurs), au tarif de vente.
  Les articles sont modifiables comme n'importe quelle option ; les archiver les retire
  définitivement.
- **Cartes planning pilotées par une option.** Une option peut afficher une carte dans le Planning quand une réservation la choisit (ex. « Repas »), pour chaque jour du séjour : **une fois par jour** (une heure) ou **plusieurs fois par jour** (liste de créneaux). Sur la fiche de réservation, on règle l'heure (ou les heures) puis on coche les jours concernés dans la fenêtre du séjour ; les créneaux hors présence (avant l'arrivée le jour d'arrivée, après le départ le jour de départ) sont automatiquement exclus, et la quantité facturée s'ajuste (par personne × occurrences retenues). Les cartes apparaissent dans le Planning au format des cartes arrivée/départ (titre de l'option + heure, logement, client + composition de la famille), avec un **cercle « fait »** + un badge **« Fait »** pour marquer une occurrence préparée (carte verte), comme le « Prêt » des arrivées.
- **Échéancier de paiement et annulation pour impayé** (spec `payment-schedule-and-cancellation.md`,
  2026-08-19). Les réservations directes suivent désormais un échéancier unique : **l'acompte est dû à
  la réservation** (date de réservation + 7 jours, réglable par logement — il remplace l'ancien « jours
  avant l'arrivée » et ne bouge plus jamais une fois posé) et **le solde 30 jours avant l'arrivée**
  (7 auparavant), sans jamais tomber avant le jour de la réservation : un séjour réservé tardivement
  est intégralement exigible tout de suite. GuestFlow relance seul — demande d'acompte envoyée avec la
  réservation, relance à l'échéance de l'acompte, demande de solde à J-30 pour **toutes** les
  réservations directes (et plus seulement celles payées en ligne), relance du solde à J+3 annonçant
  la date d'annulation. Une carte **« Échéances de paiement »** sur le tableau de bord liste tout
  retard (acompte en retard / solde en retard / annulation possible / arrivée non réglée) avec
  « Relancer », « Reporter » (7 jours, sans déplacer l'échéance) et, 7 jours après l'échéance du solde,
  **« Annuler le séjour »** — jamais automatique, toujours d'un clic de l'opérateur. L'annulation
  libère les dates (calendrier, planning, ménage, linge, export iCal, Google Agenda), conserve
  l'acompte encaissé et le **requalifie en indemnité hors TVA** au mois de l'annulation : un avoir
  annule le CA hébergement + sa TVA, une fiche d'indemnité « Acompte conservé » le recrédite en
  `75880000`. Le mois d'origine de l'acompte, lui, ne bouge pas — rien n'est réécrit chez le comptable.
  Mail d'avis d'annulation au client en option. +54 tests serveur, +9 tests client.
- New **Paramètres → Paiements** page: connect the Qonto bank account (OAuth + payment-links provider) and configure the payment reminder/deadline durations (deposit & balance reminders, abandonment delays, link expiries). Part of the online-payment feature.
- Page Options : toute option (plus seulement le linge) peut être « incluse par défaut » **par logement**, à côté du prix par logement — un interrupteur « Inclus par défaut » + « Offert » pour chaque logement applicable. La carte « Options incluses » de la fiche logement liste désormais toutes les options applicables (plus seulement le linge). Les options horaires automatiques sont exclues. Inchangé : ne s'applique qu'aux nouvelles réservations.
- **Per-property option prices** (spec `per-property-option-prices.md`). An option can now carry an optional **price override per property** — the same option (incl. a "Tous les logements" global one) can cost a different amount depending on the property (e.g. Ménage 40 € on one gîte, 60 € on another). New `property_option_prices (propertyId, optionId, price)` pivot (mirrors `property_resource_prices`); the effective price = override when set, else the option's base price, resolved server-side in the pricing engine (`getApplicableOptions`) and in `optionsModel.listForProperty`, so it flows through reservation/devis quotes **and** the public API → the WordPress booking form (which is unchanged). Edited on the Options page via a **"Prix différent selon le logement"** toggle: OFF = the usual single price; ON = the single price is replaced by one price line per applicable property (blank = inherit the base price; explicit `0` = free for that property). Progressive-tier options keep global tiers (out of scope); only the unit price value is overridable, not the price type. Additive migration, fully backward compatible (no override rows → identical to before). +10 server tests.
- **Planning — alerte linge de lit sur les fiches d'arrivée** (spec `planning-arrival-alerts.md` §3 rule 6). La carte d'arrivée signale désormais, via un badge orange, quand le client **n'a pas pris le linge de lit** (« Linge de lit non pris ») ou quand le **linge ne couvre pas le nombre de personnes** (« Linge de lit insuffisant : N couchage(s) pour M pers. », même formule que la validation du formulaire de réservation). Calculé **côté serveur** (`reservation.bedLinenAlert`, exposé par `getByIdWithDetails`). **Aucune alerte** pour les logements où le linge de lit est une option par défaut. +9 tests (6 serveur, 3 client).
- Planning breakfast card (specs/planning-breakfast-prep-popup.md): clicking the card now opens a « what to prepare » popup — serving time in the amber pill, headcount, then only the non-zero items (Café/Thé/Chocolat chaud/Lait/Viennoiseries/Céréales) with the check-in SAS pictograms, plus the note. The reservation fiche stays one tap away via the popup's « Fiche » button.
- **Planning: unpaid caution surfaced on the arrival card** — when a reservation's security deposit (caution) has not been received yet, its arrival tile now shows a red **"Caution à percevoir : X €"** badge with a shield icon, so the host knows what to collect at check-in (mirrors the existing "Complément à percevoir" block). The amount is the reservation's `cautionAmount`; the badge disappears once `cautionReceived` is set. +3 client tests.
- **Commission plateforme affichée dans le résumé de la fiche** (spec `platform-commission-line.md`, 2026-06-20). Pour une réservation via une plateforme, le résumé (panneau de droite) montre désormais le détail : **Total du séjour TTC (brut)** = ce que le client a payé à la plateforme, **Commission plateforme** = − le montant prélevé, **Net perçu TTC** = ce que vous touchez. La commission (= brut saisi − net) est **calculée par le moteur de prix** côté serveur ; elle se met à jour en direct quand vous modifiez le « Prix payé par le client ».
- Fiche réservation (plateforme) : nouveau champ **« Commission plateforme »** (€) à saisir, et le bloc « Total du séjour » affiche désormais **Total du séjour TTC (brut)** = total des nuits + options + ressources, **− Commission plateforme**, puis **Net perçu TTC** = total du séjour − commission. Le **solde correspond désormais au Net Perçu** (la commission est déduite du solde, jamais ajoutée au complément), et la **comptabilité encaisse ce solde net**. En direct, la commission est toujours nulle (bloc à une seule ligne).
- **Acompte par plateforme.** Dans « Logement › Plateformes et iCal », une nouvelle colonne « Acompte » (Oui / Non) permet de dire, par plateforme, si ses réservations prennent un acompte. Par défaut **Non** (tout dans le solde, comme avant). En « Oui », la réservation suit le découpage acompte/solde normal du logement ; l'acompte est modifiable manuellement (un acompte plus faible agrandit le solde) et, quand une commission est saisie, elle se répartit proportionnellement sur l'acompte et le solde (l'acompte + le solde = net perçu).
- Fiche de réservation, partie « Paiement plateforme » : nouveau bouton « Calculer la commission » qui déduit la commission solde des montants saisis (montant client − virement, moins une éventuelle commission acompte), de sorte que le net perçu se réconcilie avec le virement. Le calcul ne se déclenche qu'au clic et la valeur reste librement modifiable.
- Fiche réservation (plateforme) : nouveau bloc **« Paiement plateforme »** où l'on saisit directement les chiffres de la plateforme — **Montant total payé par le client** (le brut, qui **fixe le total du séjour** : l'hébergement s'ajuste tout seul = brut − options), **Commission**, et **Virement reçu** (contrôle, avec un ✓ « cohérent » si net perçu = virement). Plus besoin de bricoler le « Prix ajusté » (masqué en plateforme) pour faire coller le total. Le net perçu et la compta sont inchangés.
- **Échéance de virement plateforme.** Une réservation OTA porte désormais une échéance de solde qui a
  un sens : le virement de la plateforme, attendu `payoutDueDays` jours après le départ du client
  (10 par défaut, réglable par plateforme sur la fiche logement). Elle est posée dès la création de la
  réservation, import iCal compris, et suit le départ quand les dates bougent.
- **Alerte « Virement plateforme en retard »** sur le tableau de bord : la carte « Échéances de
  paiement » liste maintenant les virements de plateforme non reçus passé leur échéance, avec le nom de
  la plateforme. Ni relance client ni annulation sur ces lignes — l'argent est dû par la plateforme et
  le séjour a déjà eu lieu.
- **Alerte « Montant manquant »** : une réservation importée d'une plateforme dont le montant n'a
  jamais été saisi (aucun prix, aucun acompte, aucun solde) remonte sur la même carte à l'échéance de
  virement — quand l'argent aurait dû arriver, la réservation doit être complète. C'est la seule ligne
  sans date de péremption : un montant absent des comptes ne devient pas acceptable en vieillissant.
- **Commission plateforme par échéance.** Sur une réservation plateforme, la commission se saisit désormais **par échéance** : un champ « Commission acompte » dans le bloc Acompte et un champ « Commission solde » dans le bloc Solde. Chaque montant est comptabilisé sur le **compte de commission de la plateforme**, sur l'écriture de son échéance. Les montants acompte/solde affichés sont le **brut** (ce que paie le client) ; le résumé montre « Commission acompte / Commission solde » puis le **net perçu = total − commissions**. Remplace l'ancienne commission unique répartie proportionnellement.
- Page tarif d'un logement : nouvelle section « Prix plateformes ». Pour chaque plateforme (agrégées des imports iCal) et chaque saison tarifaire, le prix /nuit à afficher sur la plateforme est calculé pour que, après la commission, le tarif net soit conservé (brut = net ÷ (1 − commission%)). Le % de commission est éditable par plateforme (commun à tous les logements) directement dans le tableau.
- **Déploiement tarifaire vers les plateformes — procédé et compte rendu archivés** (2026-08-14). Le skill `platform-tariff-rollout` documente la boucle complète (dériver la grille depuis la recette → arbitrer avec l'opérateur → relever l'existant → configurer → prouver par devis client → publier une page de vérification), avec les cartes des trois consoles (Lodgify, Abracadaroom/Unic Stay, GreenGo) et leurs pièges vérifiés un par un. `build-verification-page.mjs` fabrique la page auto-portante : `cases.json` ne déclare que les entrées, tout le reste est recalculé et un écart est signalé en rouge avec un code de sortie 2. Premier compte rendu archivé dans `docs/tarifs/`, couvrant le déploiement de la grille de l'Aventura Lodge et la mise en place des saisons 2027.
- **Minimum nights per period + calendar season painting** (spec `pricing-min-nights-per-range.md`, 2026-08-01). On a property's Gestion tarifaire page, a season's date range can now carry its **own minimum nights** — so you can require e.g. 3 nights on a single May « pont » without changing the price or the minimum of the rest of the season. Select a period directly on the season calendar (drag on desktop, or the new « Affecter une période » button + date pickers on mobile) to (re)assign it to a season — existing or brand-new — the covering season is **split** around it server-side; a season fully absorbed is removed. The seasons list shows a `min N` chip on each overriding range and the calendar badges the affected days. The booking engine resolves the minimum **per night** (range override ⇒ season default ⇒ 1) and the existing `409 MIN_NIGHTS` guard blocks too-short stays that touch the period. No database migration (the per-range minimum lives in the existing `dateRanges` JSON). +17 server tests.
- **Public API: per-property resources** (spec `public-api.md`). New `GET /public/v1/properties/:id/resources` returns the resources applicable to a property (`resource_properties` pivot, empty = global) with their **effective per-property price** (`property_resource_prices`), projected to `{ id, name, description, priceType, price }` (stock, slots and opening hours stripped). `POST /public/v1/quote` and `POST /public/v1/booking-requests` now also accept **`resources: [{ resourceId, quantity }]`** — sanitised exactly like options (no client-set price/offered can reach the engine), priced through the existing engine, with the quote projection gaining `resources[]` + `resourcesTotal`. A resource not applicable to the property → 422. This lets the WordPress booking flow list and price options **and** resources for each accommodation. +6 server tests; full suite green.
- **Public API for the WordPress showcase site** (spec `public-api.md`, 2026-06-08). A separate, key-authenticated API tree under `/public/v1/*` lets a trusted server-to-server proxy (the WordPress backend) read the catalog and submit booking requests, without ever touching the internal `/api/*` admin API: `GET /public/v1/properties`, `/:id` (with a "from €X/night" teaser), `/:id/options`, `/:id/availability` (consolidated blocked dates incl. iCal platform blocks + closures, source-opaque) — read-only; `POST /public/v1/quote` (computes via the existing pricing engine, price-override fields ignored, platform forced to `direct`); `POST /public/v1/booking-requests` (creates a draft devis `requestOrigin='public'`, never a confirmed reservation; resolves/creates the client by email; honeypot + dedicated rate limiter). Auth via a dedicated `PUBLIC_API_KEY` (auto-generated in `server/.env.local` on first boot), distinct from the admin session. Uniform error envelope `{ error: { code, message, details? } }`.
- **Acompte en ligne par logement sur le site** (spec `public-online-deposit.md`, 2026-07-03). Nouveau bouton « Acompte en ligne » sur chaque logement (Acompte & Solde) — **désactivé par défaut**. Quand il est actif, le visiteur du site règle l'**acompte** à la réservation (le récapitulatif affiche « Acompte à payer maintenant » + « Solde à régler avant le … », bouton « Payer l'acompte ») ; le **solde** est ensuite demandé automatiquement par email (nouveau modèle `balance_request`, lien Qonto) à l'échéance, avec un bouton manuel « Envoyer la demande de solde » sur la fiche réservation. Quand il est inactif : comportement inchangé (paiement unique du séjour, sans lignes acompte/solde). La décision du mode est 100 % serveur (le montant de l'acompte vient de la colonne stockée du devis). +10 tests serveur.
- Site web : un client peut désormais **payer la totalité de son séjour en ligne**. Depuis une demande de réservation du site, un appel crée le lien de paiement Qonto (montant moteur, dispo re-vérifiée, URL de retour vers le site), et un endpoint de statut permet à la page de succès de suivre le paiement. À la réception du paiement, la réservation est **confirmée automatiquement** (dates bloquées) et le mail de confirmation est envoyé.
- Public `/quote` now returns `totalStayPrice` — the stay grand total **including** the tourist tax (the existing `finalPrice` stays tax-exclusive). Public consumers should display `totalStayPrice` as the headline "Total du séjour".
- Push settings: a « Envoyer une notification de test » button sends a test push to all of your devices, so you can verify notifications work without waiting for a real reservation or arrival/departure.
- Notifications push (PWA) : GuestFlow est désormais installable et peut envoyer des notifications, même fermé. Chaque utilisateur active les notifications sur son appareil et choisit ce qu'il reçoit (nouvelle réservation / arrivées / départs) dans Réglages. Une push est envoyée à l'arrivée d'une nouvelle réservation (import iCal + demande de devis du site), et à l'heure de check-in (arrivée) / check-out (départ) de chaque réservation.
- **Paiement en ligne de l'acompte via Qonto (Phase 2)** (spec `online-payments-qonto.md` §3.4/§10, 2026-06-29). Depuis un devis, un bouton **« Envoyer la demande d'acompte »** génère un **lien de paiement Qonto** (page hébergée Mollie, montant = l'acompte du devis) et l'ouvre. Quand le client paie, GuestFlow le détecte (sonde 2×/jour + bouton **« Vérifier le paiement »**) et **convertit automatiquement le devis en réservation** (dates bloquées) avec l'**acompte marqué payé**. Auth Qonto en **OAuth2** (obligatoire pour les liens de paiement) ; détection via la sous-ressource `…/payments` (statut `paid`). Nouveaux endpoints `POST/GET /api/payments/reservations/:id/payment-links` + `POST /api/payments/poll`, `utils/paymentPollRunner`. Validé de bout en bout sur le sandbox Qonto. +4 tests serveur.
- Devis : nouvelle relance d'acompte **manuelle** `deposit_reminder` (FR + EN, éditable sur la page Emails) qui apparaît dans la file d'emails à envoyer **avant l'expiration du devis** (ancrée sur la date de validité `validUntil`, J-3 par défaut) tant que l'acompte n'est pas payé et que le devis n'est pas converti. L'email rappelle la date d'expiration et propose à nouveau le lien de paiement de l'acompte existant. L'hôte l'envoie à la main depuis la file.
- Devis : le bouton **« Envoyer la demande d'acompte »** envoie désormais au client un **email** contenant le lien de paiement de l'acompte (récap du séjour, montant de l'acompte, total, et l'avertissement que payer bloque les dates) — au lieu d'ouvrir un onglet. Nouveau template `deposit_request` (FR + EN), éditable sur la page Emails. Le règlement de l'acompte confirme la réservation et déclenche l'email de confirmation existant.
- Paiements : ajout d'un **webhook Qonto** (`POST /api/payments/qonto/webhook`, signature HMAC vérifiée) qui confirme une réservation **dès** que le paiement réussit, sans attendre le polling. Le polling reste actif comme filet de réconciliation.
- Online payments: a **reservation-confirmation email** (montant du séjour + dates + options) is now sent to the guest automatically the moment an online payment confirms the stay — when the deposit is paid (devis flow) or the full stay is paid (website flow). New editable `reservation_confirmation` template (FR + EN); the send is best-effort and never blocks the payment flow.
- Paiements : bouton **« Enregistrer le webhook »** sur la page Paiements (Qonto connecté) qui crée l'abonnement webhook `v1/payment-links` côté Qonto (URL de rappel + secret partagé), pour confirmer les paiements en temps réel. Nécessite `QONTO_WEBHOOK_SECRET` + l'URL publique configurée + le scope OAuth `webhook`.
- **Rappel du complément d'arrivée non perçu au check-out.** Si on oublie de faire le check-in (ou qu'on n'a pas encaissé le complément d'arrivée), le SAS de départ le **rappelle** : le récapitulatif de fin de séjour affiche une section « Compléments d'arrivée non perçus » avec son détail (taxe de séjour, extras, linge/ménage), additionne son montant au complément de fin de séjour pour donner le **total à percevoir**, et un bouton « Compléments encaissés » marque les deux compléments payés à la validation. Les deux montants restent séparés en base (la taxe de séjour garde son compte 46710000, le complément de fin de séjour son compte 70600010).
- **SAS check-in : bouton « Complément encaissé »** sur le récapitulatif d'arrivée pour confirmer l'encaissement du complément (sinon il reste dû et sera rappelé au départ).
- Suite E2E : couverture du rôle « Accueil » (7 specs Playwright) — la fenêtre d'édition du jour
  (SAS actif aujourd'hui, verrouillé hier / demain / déjà validé, refus serveur avec motif) et le
  confinement du rôle (routes interdites redirigées, aucune donnée financière ni PII client dans les
  payloads, appels hors périmètre en 403). La suite sait désormais jouer un scénario sous un compte
  non-admin : `seed-e2e.js` crée un compte accueil et `global-setup.js` capture une seconde session.
- **« Accueil » role — on-site check-in/out, no financials** (spec `reception-role-checkin-only.md`, 2026-07-22). A new `reception` role (label « Accueil ») can be assigned from Gestion des comptes. A reception-only account sees a finance-free home (day's arrivals/departures, no Paiements column / KPI tiles / month calendar), runs the full arrival/departure SAS on the Planning, and reaches nothing else — clients, reservations sheets, finance, accounting, devis, emails and settings are blocked both client-side (redirect) and server-side (403). Reservation + property payloads are finance-stripped server-side for this role (caution + complement to collect are kept; deposit/balance/total/commission/client PII are dropped), and `PATCH /reservations/:id/payment` accepts only the check-in/out status flags. +32 server tests, +4 client tests.
- A completed check-in / check-out SAS can now be **re-opened and edited** from the planning: the green ✓ button on an arrival card / departure row stays clickable (« Revoir / modifier le check-in/check-out ») and re-opens the wizard pre-filled with everything previously entered (caution, complement, linge, extincteur, petit-déjeuner, note de passation). Re-validating **replaces** the prior data — the arrival complement is never double-charged — and un-ticking « caution reçue/rendue » now reverts the marker. A complement that has already been paid stays frozen.
- Chaque réservation a désormais un **numéro de réservation** lisible (`AAAA-MM-###`), généré automatiquement mais modifiable sur la fiche. Les réservations existantes sont numérotées automatiquement au démarrage.
- Nouvelle **recherche de réservation** en haut du Calendrier et du Tableau de bord : tapez un numéro, un nom, un prénom ou « nom prénom » et les résultats s'affichent au fur et à mesure ; un clic ouvre la fiche.
- **Remboursements — rendre de l'argent sans toucher à la vente** (spec `reservation-refunds.md`, 2026-08-10).
  Un départ anticipé où la nuit reste facturée mais les petits-déjeuners non pris sont rendus n'avait
  aucune représentation : réduire la ligne cassait le « reste à payer » et laissait la compta au prix
  fort. La fiche gagne un bloc **« Remboursements »** (total, historique, suppression) et une fenêtre
  qui liste les prestations facturées avec leur plafond, accepte une ligne libre, et se ferme sur une
  date + un moyen (virement / espèces / caisse interne, cette dernière hors compta comme les
  compléments en liquide). La vente, les échéances et les flags « payé » ne bougent jamais : le
  montant rendu est déduit du « total de séjour », de l'encaissé et du CA, et l'export mensuel du
  comptable porte une **écriture d'avoir** datée du virement (crédit compte client / débit 70xxx +
  TVA, la taxe de séjour sur le 46710000). Plafonds serveur par ligne et sur le séjour, TVA figée à
  l'émission, admin uniquement, disponible sur une réservation passée verrouillée.
  **La taxe de séjour se rembourse à la nuit** et la déclaration suit : la nuit rendue sort des
  « Nuits », des « Adultes-nuits » et du montant de la page Taxe de séjour — ligne, récap par logement
  et totaux du mois — avec la mention « dont 1 nuit remboursée (− 4,40 €) ». Tous moyens confondus,
  caisse interne comprise : ce qui est reparti chez le client n'est pas dû à la commune. Une taxe
  entièrement rendue fait sortir la réservation de la déclaration.
  +47 tests serveur, +18 tests client.
- Les ressources horaires (ex. bain nordique) peuvent être planifiées par séances directement depuis la fiche de réservation (date + heure de début/fin), avec une grille tarifaire horaire paramétrable sur la ressource : tarif jour, heure de bascule soir, tarif soir, et un tarif « extérieurs » distinct pour les réservations sans logement. Le prix (prix × durée par tranche de 30 min, 1ère heure offerte par logement) est calculé côté serveur, et chaque séance apparaît comme une carte sur le planning avec un bouton « fait ».
- **Planning : une tâche « Démarrer » la veille pour le bain nordique.** Une ressource qui met des heures
  à chauffer (`Montée en chauffe` dans Réglages → Ressources) fait apparaître une tâche « Démarrer … »
  le jour où il faut l'allumer, avec sa propre coche : une séance à 9 h avec 8 h de chauffe s'allume à
  1 h du matin, donc la tâche tombe la veille au soir. Une séance de l'après-midi, allumable le matin
  même, n'en crée aucune — pas plus qu'une ressource encore chaude d'une séance précédente. (#13)
- SAS d'arrivée : propose le **linge de toilette** quand le client ne l'a pas pris, au **prix par personne** (même moteur que la réservation). Réglable **en fin de séjour** (complément de fin de séjour, affiché au check-out) ou **maintenant** (complément d'arrivée, encaissable en caisse interne).
- SAS d'arrivée : vendre le **petit déjeuner** et la **restauration** au check-in. Le petit déjeuner
  s'ajoute en choisissant les matins dans la même fenêtre qu'à la réservation (matins bornés par les
  nuits du séjour, nombre de petits déjeuners affiché comme sur la fiche) puis enchaîne sur la page de
  composition pré-remplie ; la restauration propose les options « Restauration » du logement, au moment
  (repas) ou à la quantité (planches). Les prestations vendues deviennent de vraies options de la
  réservation — cartes du planning et préparation comprises — et leur montant rejoint le complément à
  percevoir, réglé sur le récap. Vendues sur un complément déjà encaissé, elles suivent le circuit des
  ventes en séjour : payables de suite par une note ou au check-out.
- SAS arrivée : nouvelle page « Petit déjeuner » (quand l'option est prise) pour saisir le nombre de cafés / thés / chocolats chauds, ajuster l'heure et laisser une note libre — avec un avertissement si le total des boissons ne correspond pas au nombre de personnes. Ces infos enrichissent la carte petit-déjeuner du planning (icône + libellé + nombre, les zéros sont masqués, la note s'affiche). En fin de SAS arrivée, une « note pour le départ » peut être laissée ; elle réapparaît dans le SAS de départ et sur la carte de départ du planning.
- SAS breakfast step (specs/sas-breakfast-bread-and-push.md): the « À manger » heading gives way to a strong divider, a « Pain (baguette) » counter joins in half-baguette steps (« 1,5 »), and quantities pre-fill server-side while the check-in was never validated (viennoiseries = persons, pain = ½ baguette per person). The preparation popup and the planning card show the bread count too.
- Breakfast push notification: `lead` minutes before each breakfast's serving time (default 30, configurable on the breakfast option's edit form), one push per reservation per day with a boot-safe guard; tapping it opens the planning preparation popup directly (`/planning?breakfast=…&date=…`). New « Petit déjeuner » switch in the push-notification settings (ON by default).
- Arrival-SAS breakfast step (specs/sas-breakfast-milk-and-food.md): « Lait » joins Café/Thé/Chocolat chaud (and the drinks-vs-persons hint), a new « À manger » section counts Viennoiseries and Céréales with its own non-blocking coherence hint, and the breakfast hour is now displayed big and bold (full-width on mobile). The planning breakfast card shows the new counts (Lait + Viennoiseries/Céréales chips) so the tray can be prepared at a glance.
- Les SAS de check-in et de check-out alimentent enfin l'**historique des modifications** de la fiche
  réservation, sous les entrées « SAS arrivée » et « SAS départ » : caution reçue / restituée, ménage et
  linge de toilette pris ou retirés, éléments de linge facturés, complément à percevoir et son
  encaissement (ou son report en fin de séjour), complément de fin de séjour et son détail, composition et
  heure du petit déjeuner, note pour le départ, état de l'extincteur. Seuls les champs réellement modifiés
  apparaissent ; un SAS qui ne change rien n'écrit aucune entrée.
- **SAS : offrir une ligne du complément.** Sur le récapitulatif du check-in comme du check-out, chaque
  ligne à percevoir porte un bouton « Offrir » : la ligne passe à 0 €, son prix réel reste affiché barré,
  et le total suit. Le geste est réversible (rouvrir le SAS le rend au client) et tracé dans l'historique
  de la réservation. La taxe de séjour, reversée à la commune, n'est jamais offrable. Un ménage ou un
  linge de toilette offert reste activé sur la réservation, donc toujours compté par la blanchisserie et
  le stock de linge. (#429)
- **SAS d'arrivée — « Planifier les ressources »** (spec `hourly-resource-quantity-and-sas-scheduling.md`, 2026-08-17). Les heures vendues sur le devis se posent maintenant **avec le client au check-in**, sur une grille de créneaux pensée pour le téléphone. Le serveur ne propose que des créneaux réellement réservables — heures d'ouverture, séjour (jamais avant l'arrivée ni après le départ), capacité et remise en état — et **étiquette** les autres (`réservé`, `montée en chauffe`, `passé`, `fermé`) plutôt que de les cacher ; les réservations existantes du jour sont affichées en horaires seuls, sans nom, pour permettre de se coller à l'une d'elles. Nouveau **modèle thermique** par ressource : `heatUpMinutes` (montée en chauffe à froid) et `heatRetentionMinutes` (durée pendant laquelle elle reste utilisable après un passage) — un créneau proche d'un autre ne coûte que la remise en état et porte un badge 🔥, un créneau isolé attend la chauffe complète. Les créneaux du soir affichent leur supplément, versé au complément d'arrivée. Étape passable (« Planifier plus tard ») avec rappel au récapitulatif. +24 tests serveur, +11 tests client.
- Ajout de `npm run stop` : libère les ports de dev de l'application (client :3000 + API :4000) en arrêtant les serveurs qui y écoutent, utile quand un serveur de test est resté en route. Idempotent, sans dépendance (Node + `lsof`).
- **Journal des changements tarifaires** (spec `tariff-change-journal.md`, 2026-08-14). Une grille change en deux temps — la recette est appliquée dans GuestFlow, puis les prix sont mis en ligne sur les plateformes — et aucun des deux n'était conservé : la seule trace était `properties.updatedAt`, que le prochain enregistrement de la fiche logement écrasait. **Paramètres → Recettes tarifaires** porte désormais un journal daté : l'application d'une recette s'y inscrit **automatiquement** (et seulement si elle change effectivement quelque chose), la mise en ligne sur les canaux se **déclare à la main** avec sa date d'effet. La date d'effet et la date de saisie sont deux colonnes distinctes, pour pouvoir dater après coup un déploiement fait la veille. Objectif : mesurer plus tard l'influence d'un changement de grille sur les réservations. +13 tests serveur, +3 tests client.
- Le supplément personne supplémentaire de l'Aventura Lodge passe à **15 € la 1ʳᵉ nuit puis 8 €/nuit**
  (au lieu de 27 €/nuit dégressifs). Une recette tarifaire peut désormais déclarer le supplément sous
  forme de paliers par nuit ; les réservations déjà enregistrées gardent leur prix figé.
- Une recette peut déclarer des **événements récurrents** dont les dates ne se déduisent d'aucune règle
  de calendrier. La semaine de **L'Ardéchoise** passe en haute saison avec **1 nuit autorisée**, y
  compris là où un pont férié imposerait un minimum de séjour. Dates connues : 8→13 juin 2026 et
  7→12 juin 2027.
- Les dates de l'événement sont visibles dans le tableau des saisons, sur le calendrier et dans la
  carte « Recette tarifaire » ; une année d'horizon dont les dates ne sont pas encore publiées est
  signalée avec le lien vers la source, au lieu d'être devinée.
- **Recettes tarifaires** : un modèle tarifaire complet (saisons, découpage du calendrier, prix, dégressivité, minimum de nuits, jour de changement, fermetures) se déclare dans un document JSON appliqué à un logement. Nouvelle page **Paramètres → Recettes tarifaires** (consultation), carte de choix + aperçu du diff avant écriture sur la page tarifaire du logement. Les saisons sont calculées à partir du calendrier — jours fériés compris — sur un horizon de 2 ans étendu automatiquement par une tâche planifiée, avec une alerte Dashboard à relire. Les recettes sont livrées avec l'application et peuvent être ajoutées ou remplacées sans release en déposant un fichier dans le dossier `recipes/` des données du serveur.
- Tourist-tax extraction page: a « Déclarée » checkbox in front of every reservation row records when it was declared to the commune (date shown on hover) and persists across reloads (specs/tourist-tax-declared-checkbox.md).
- Réservations : une nouvelle réservation en direct ou via Lodgify arrive avec le **pack de bienvenue** du logement déjà coché — les 2 petits-déjeuners du premier matin et le jus de pomme 1 L sur l'Aventura Lodge, repris de la recette de tarification (`freeUnits`), jamais une unité facturée. Changer de plateforme retire le pack ; y revenir le remet, tant que la réservation n'est pas enregistrée. Dès que vous touchez une de ces options, elle vous appartient : le pack ne la retire ni ne la remet plus.
- Plugin WordPress (v1.3.0) : le bloc « Devis & demande de réservation » gagne une option **Paiement en ligne**. Le visiteur règle la totalité de son séjour sur la page sécurisée Qonto puis revient sur une vue de confirmation qui suit l'état du paiement ; au paiement, GuestFlow bloque les dates et envoie l'e-mail de confirmation. Nouvelles routes proxy `/booking-requests/{id}/pay` et `/booking-requests/{id}/status`.
- **WordPress plugin "GuestFlow Booking"** (spec `wordpress-plugin.md`, 2026-06-08) in `integrations/wordpress/guestflow-booking/`. A build-free plugin that connects a WordPress showcase site to GuestFlow's public API: three Gutenberg blocks (availability calendar, devis & booking-request wizard, property list), a **PHP REST proxy** (`/wp-json/guestflow/v1/*`) that relays to GuestFlow `/public/v1/*` with the API key injected server-side (**never exposed to the browser**), a settings page (API URL/key — `wp-config` `GUESTFLOW_API_KEY` constant wins over a masked option — cache TTLs, default property, booking page, "Test connection"), transient read cache, honeypot + WP REST nonce on the booking write, and `bin/make-zip.sh` packaging. Inert for the Raspberry Pi deploy (allow-list archive).
- **WordPress plugin: SSL-verification control + install guide** (spec `wordpress-plugin.md`). The GuestFlow Booking plugin (bumped to 1.1.0) can now talk to a GuestFlow server that uses a **self-signed TLS certificate** (common on a local/LAN PM2 deploy): a new **"Vérification SSL"** setting (option `ssl_verify`, default ON; overridable by a `GUESTFLOW_SSL_VERIFY` wp-config constant) lets an operator turn off certificate verification for a trusted local server — otherwise the proxy rejected the cert and every call returned 502. Default stays secure (verification on). Added `integrations/wordpress/INSTALL.md` documenting build → install → configure (incl. the `wp-config.php` key/SSL constants), the HTTPS/self-signed caveat, the Docker-`localhost` pitfall, and a troubleshooting table.

### Changed
- **Responsive rework of the Paramètres pages** (specs `settings.md`,
  `linen-inventory-shortage-tracking.md`, `establishment-closures.md`,
  2026-06-08). The Paramètres page and the Stock blanchisserie page now
  use a CSS **masonry** (1 column ≤ md, 2 balanced columns on lg+) inside
  a wider centered container (`maxWidth lg: 1240`), so small sections no
  longer waste the desktop width; both stay single-column + mobile-friendly
  on phones. The Fermetures table container widened (920 → 1200 on lg).
  Pages already full-width + responsive (Logements grid, Clients / Options
  / Ressources via DataPageScaffold, Comptes) were left unchanged. Vacances
  scolaires excluded by request.
- **Property detail page layout** (spec `properties-mvc.md` §6.1,
  2026-06-08). `/properties/:id` moves from an even `Grid` (which left big
  gaps under short cards) to **two explicit columns** on desktop (1 on
  mobile): left = Informations + Acompte & Solde, right = Horaires &
  Ménage + Options horaires + Options par défaut; the wide cards
  (Tarification + its seasons table, Documents, iCal Export, Connexions
  iCal) span full width below. Explicit columns keep card placement
  deterministic and spacing regular. Layout-only, no behaviour change.
- **Editing a template refreshes the « Emails à envoyer » queue.** The
  pending queue is rendered live (never a stored snapshot), so a
  template's content always reflects its current version; the Emails
  page now also re-fetches the queue after any template create / edit /
  delete / enable-toggle so a changed `dayOffset` / `sendMode` /
  `enabled` reshapes the on-screen list immediately.
- **Emails page route** renamed `/emails/modeles` → `/emails` (the page
  now hosts both the queue and the templates, not just templates). The
  old path redirects to the new one.
- **Emails page rework** (spec `email-automation.md` §6.10, 2026-06-08).
  `/emails/modeles` is now a unified **Emails page** with two cards:
  « Emails à envoyer » (the manual-email queue, previously only behind
  the dashboard popup — now an inline list, hidden when empty) and
  « Modèles d'emails ». Clicking a **template row** opens its edit
  dialog (the per-row edit icon is dropped). In the queue, clicking a
  **row** opens the editable preview/send dialog, while clicking the
  **client name** opens the matching reservation. The dashboard
  « Emails à vérifier » widget now **navigates** to the Emails page
  instead of opening a popup; the `EmailPendingDialog` component is
  removed and replaced by the presentational `EmailPendingList`.
- **Send an email to a client with no address on file** (spec
  `email-automation.md` §3 rule 10, 2026-06-08). Every « Emails à
  envoyer » row is now clickable, even when the client has no email.
  In that case the send dialog's banner shows an **editable address
  field**; on a successful send the typed address is **saved onto the
  client record** (`clients.email`, never overwriting an existing one),
  so the next email finds it on file. New server guards: `400
  INVALID_EMAIL` on a malformed typed address, `404 CLIENT_NO_EMAIL`
  only when nothing is on file and nothing typed.
- **Selective cleanup popup on `/clients`** (spec
  `clients.md` §3 rule 8, 2026-06-06). Clicking the **Cleanup clients**
  button no longer triggers an immediate bulk delete. It now opens a
  popup listing every client with no reservation and no devis, with a
  checkbox per row (all checked by default) plus a master "Tout cocher
  / décocher" toggle. The footer offers **Annuler** (pure no-op) and
  **Supprimer (N)** (disabled when N=0). Only the checked clients are
  deleted on confirm.
  Backend additions:
  - `GET /clients/cleanup-orphans/preview` — returns the orphan list
    server-sorted by `lastName, firstName` with `{ id, firstName,
    lastName, email, phone }`.
  - `POST /clients/cleanup-orphans/delete` — `{ ids: number[] }` body,
    returns `{ ok, deletedCount, skippedCount }`. Each id is
    re-validated as still-orphan inside a transaction; non-orphan or
    unknown ids count as `skipped` (race-safe against concurrent
    reservation creation).
  - The pre-existing bulk `POST /clients/cleanup-orphans` is kept for
    headless / programmatic callers but is no longer invoked by the
    UI.
  10 new server-side cases in
  `tests/clients-cleanup-orphans.unit.test.js` (1052 → 1062 green). 7
  new Vitest cases in `components/__tests__/ClientCleanupDialog.test.js`
  (273 → 280 green).
- **Bed configuration moves inside the "Linge de lit" option card**
  (spec `bed-config-in-linen-card.md`, 2026-06-05). The 3 bed
  counters (Lits doubles / simples / bébé) + the "Suggérer les
  lits" button + the capacity-mismatch warning leave the
  "Voyageurs et couchages" card (renamed to "Voyageurs") and move
  into the "Linge de lit" option card inside the
  "Options et ressources" section. The sub-block is rendered ONLY
  when the bed-linen Switch is ON; toggling it OFF auto-zeroes the
  form state for the 3 bed counts.
  **Why** — pre-change, the operator could enter bed counts on a
  reservation without ticking the bed-linen option (the counts then
  sat in the DB but contributed zero to the laundry aggregation), OR
  tick the option while leaving the counts at 0 (silent "0 sheets
  to drop off" for a reservation that obviously has beds). The two
  surfaces are now coupled in the UI and on the server.
  **Server invariant** — `reservationsController.create` and
  `update` coerce `singleBeds / doubleBeds / babyBeds` to `0`
  whenever the final `reservation_options` (after the property-
  defaults auto-merge on create; as-submitted on update) contains
  no option flagged `countsAsBedLinen = 1`. Capacity validation
  uses the coerced values so a misbehaving client can't trip a
  "beds exceed property capacity" error on counts that won't
  even be saved.
  **Migration** — one-shot idempotent
  `zero_beds_when_no_bed_linen_option_v1` runs at boot, in a single
  SQL pass via `utils/zeroBedsWhenNoBedLinenMigration.js`. Zeroes
  the bed counts on every reservation (`kind = 'reservation'`) that
  has no bed-linen-flagged option in `reservation_options` AND
  whose property has no bed-linen-flagged option in
  `property_option_defaults`. Devis (`kind = 'devis'`) are skipped
  — they don't feed the laundry and they convert through the
  reservation controller anyway. **No data loss** for the laundry
  feature: the affected rows already contributed `0` to the
  aggregation (the SQL in `laundryModel.js` requires a flagged
  option to count).
  **Multi-option edge** — if the catalog carries more than one
  option flagged `countsAsBedLinen = 1` (rare; the seeded "Linge
  de lit" is the typical singleton), the inputs render exactly
  once, under the FIRST enabled bed-linen-flagged option in
  catalog order. The same form state (`form.singleBeds` etc.)
  backs them, so editing in one place is the only source of
  truth.
  **Hotfix 2026-06-05 follow-up (same PR)** — Adrien reported that on
  his Gite property (which has `Linge de lit` as a property default),
  EXISTING reservations whose `reservation_options` predate the
  default were showing the Switch OFF instead of ON — the form was
  treating `form.selectedOptions` as the only source of truth,
  ignoring the property contract. Fix:
  - **Server** — `reservationsController.update` now re-merges
    property defaults THAT ARE `countsAsBedLinen = 1` before the
    invariant runs. Other property defaults stay frozen on update
    (historical preservation rule from other specs). Pin via a new
    controller test.
  - **Client** — `ReservationFormContext` exposes
    `bedLinenForcedOptionIds: Set<number>` derived from
    `propertyOptionDefaults ∩ propertyOptions.filter(countsAsBedLinen=1)`.
    `firstEnabledBedLinenOptionId` now considers forced-by-default
    options as enabled. `ExtrasSection` renders the Switch as
    `checked + disabled` for forced options, with the "Inclus par
    défaut" caption next to it. The user CANNOT remove a bed-linen
    option enforced by the property.
  - Verified live on reservation #12077 (Gite property): Switch
    checked + disabled, 3 bed inputs visible, caption shown, sub-
    block rendered.
  **Hotfix 2026-06-05 follow-up #2 — GROSS_BELOW_NET on direct
  bookings (same PR)** — Adrien hit `400 GROSS_BELOW_NET` after
  adding the bed-linen option on reservation #12089 (direct booking,
  Gite property). Root cause is independent of this spec but
  surfaces through it: the form's gross input
  (`client/src/components/reservation/FinanceSection.js:129`) is
  rendered ONLY for non-direct platforms, so the stored
  `clientGrossAmount` sits frozen the moment `finalPrice`
  recomputes. The boot-time migration backfills
  `clientGrossAmount = finalPrice` for direct rows but doesn't
  re-fire on subsequent saves. The reservations controller now
  coerces `clientGrossAmount = quote.finalPrice` when
  `platform === 'direct'` (or empty) before the validator runs, in
  both `create` AND `update`. Platform reservations stay
  authoritative on the operator-entered gross (the input is visible
  + editable for them).
  Tests: +5 server cases in
  `reservations-controller-gross-coercion.unit.test.js`.
  **Coverage extension** — added 1 server test pinning that
  NON-bed-linen property defaults are NOT re-merged on update
  (historical preservation still holds for non-linen defaults), and
  2 extra Vitest cases on the property-default enforcement: a
  non-bed-linen catalog option stays toggleable when a bed-linen
  option is forced, and the disabled Switch stays disabled when the
  bed-linen option is explicit in `selectedOptions` AND forced by
  property default (no double-toggle confusion).
  **Hotfix 2026-06-05 follow-up #4 — empty platform never
  persisted (same PR)** — Adrien clarified the data invariant:
  `reservations.platform` always carries a real value, either a
  platform name (Airbnb, GitesDeFrance, etc.) or `'direct'`. NULL /
  `''` / whitespace-only must not exist anywhere in the table.
  - `reservationsController.create` and `update` normalise
    `req.body.platform` via a `normalisePlatform(value)` helper
    right after `validateFinanceInputs` — any future write that
    tries to persist an empty value is coerced to `'direct'` before
    anything downstream (including the gross-coercion logic above)
    sees it.
  - One-shot migration `platform_empty_to_direct_v1` (boot block in
    `database.js` + util `utils/normaliseEmptyPlatformMigration.js`)
    backfills legacy rows. Idempotent via the `migrations` table.
  - Tests: +5 migration cases + 5 controller cases. The migration
    pins NULL/''/'  ' all → 'direct' and "Airbnb/direct preserved";
    the controller cases pin the same on create + one on update.
  - Verified live: PUT to `/api/reservations/12089` with `platform:
    ''` returns 200 OK and the DB stores `'direct'` afterwards.
  **Tests (total for this spec + follow-ups)** — +27 server (5
  migration zero-beds + 5 controller invariant + 1 property-default
  re-merge + 1 non-linen-default scoping + 5 gross coercion + 5
  platform normalisation migration + 5 platform normalisation
  controller), +9 Vitest (7 `ExtrasSection.bed-linen-inputs` + 2
  `GuestsBedsSection.no-beds`). Server suite 1006 → 1033 green
  (in-isolation; parallel-runner flakes from earlier specs still
  occasionally surface); Vitest 228 → 237 green; vite build clean
  (465 KB gzip ≈ baseline). Manual verification on reservation
  #12077 (bed-linen card + Switch forcing) and live save on #12089
  (gross coercion + platform normalisation):
  Switch ON → sub-block + 3 inputs + button appear, Switch OFF →
  sub-block disappears.
- **Extras on platform reservations always routed to Complément**
  (spec `force-extras-complement-on-platform.md`, 2026-06-04). Sister
  rule to PR #116 (no deposit on platforms): the platform's single
  bank transfer covers the base stay = Solde, but any baby bed,
  late check-out surcharge, ménage extra or resource line is paid
  **directly by the guest on site** = Complément. Today the operator
  has to remember to flip the per-line "Compl." toggle on every
  extra of every platform reservation; this PR moves the rule to
  the server-authoritative side and lets the UI hide the toggle
  entirely.
  **Two halves to the fix:**
  - **Write-time forcing** in `reservationsModel` (`isPlatformNonDirect`
    + `readPlatformForcing` helpers): every extra line written via
    `replaceOptions`, `insertOptions`, `insertCustomOptions`,
    `insertResourceLine` is OR'd with the reservation's just-persisted
    `platform` value within the same transaction. Non-direct platforms
    → `inComplement = 1` forced + both contribs nulled, regardless of
    what the payload says. Same channel covers auto-options (they flow
    through `optionLines`).
  - **One-shot boot migration** (gated by
    `migrations.force_extras_complement_on_platform_v1`,
    `utils/forceExtrasComplementOnPlatformMigration.js`): for every
    reservation with a non-direct platform, UPDATE the 3 extras
    tables to set `inComplement = 1` + null both contribs `WHERE`
    inComplement = 0. The `WHERE` guard makes it idempotent — a
    second boot reports 0 affected. Captured acompte contribs on
    platform extras (rare legacy data) trigger a one-line warn log
    per affected reservation/table so the operator can spot-check
    the next monthly export. Mirrors the
    `normalizePlatformNamesMigration` extraction pattern for
    testability.
  **Frontend mirror:** `ExtrasSection` derives `isPlatformReservation`
  from `form.platform` and hides the 4 per-line "Compl." Checkbox
  blocks (property options, auto-options, custom options, resources),
  replacing them with a single muted caption:
  *"Réservation plateforme — les extras sont automatiquement facturés
  en paiement complémentaire."* `PricingSummary` mirrors the
  derivation and hides every per-line `<ComplementChip>` — but the
  **"Offrir / ✓ Offert"** Button stays visible and interactive on
  every line. An operator can always make a geste commercial on an
  extra, regardless of whether the booking came via a platform; the
  "Offrir" code path is untouched. `ReservationPage`'s `quoteInput`
  useMemo projects `inComplement: 1` on every entry of the three
  extras arrays + unions the catalog's auto-enabled option ids into
  `autoOptionsInComplement` when on a platform — keeps the live
  preview consistent with what the server writes on save without
  mutating form state (operators keep their toggle choices intact if
  they switch back to direct mid-edit).
  **Tests:** +12 server unit cases (6 migration + 6 model write-time
  forcing) + 7 Vitest cases (4 ExtrasSection + 3 PricingSummary).
  Server suite stays green minus the same parallel-runner flake from
  PR #116/#118 that clears in isolation; Vitest 189/189; E2E
  18/1 skip/0 fail; client build 464.29 kB gzip (within budget).
  **Risk:** past CSV exports for platform reservations with
  pre-existing options/resources will surface those extras in the
  **Complément** entry instead of in the **Solde** entry, starting at
  the next boot after deploy. Accepted (same risk family as PR #116).
  Operators who want to compare against the previous shape should
  snapshot the DB before deploy. Escape valve to re-run / inspect:
  `DELETE FROM migrations WHERE name =
  'force_extras_complement_on_platform_v1'` + restart.
- **Platform names — UpperCamelCase canonical form everywhere** (spec
  `normalize-platform-names.md`, 2026-06-04). Follow-up to PR #116 which
  extended the platforms list to a union of `ical_sources.platformLabel` +
  `reservations.platform` and surfaced obvious data-quality drift on the
  prod-copy DB: `Gitedefrance` + `gitedefrance`, `Lodgify` + `lodgify`,
  `Abracadaroom` + `abracadaroom` were all stored as separate rows.
  **Two halves to the fix:**
  - **Write-time formatter** (`utils/platformNameFormat.js`):
    `formatPlatformName(input)` reduces a free-form platform string to a
    canonical UpperCamelCase shape. Diacritics stripped, spaces/punctuation
    split, each segment capitalized, joined without separator. Idempotent
    on its own output (the splitter detects camelCase boundaries on the
    second pass). The `direct` enum value is preserved as lowercase so the
    codebase's strict equality checks against `'direct'` keep working.
    Applied at every write site: `propertyIcalModel.createSource` +
    `updateSource` (for `ical_sources.platformLabel`),
    `reservationsModel.insertReservation` + `updateReservation` (for
    `reservations.platform`), `platformsModel.upsertByName` (belt-and-
    suspenders for any caller that bypasses the upstream hooks).
  - **One-shot boot migration** (`utils/normalizePlatformNamesMigration.js`,
    gated by `migrations.platform_names_normalized_v1`): walks every
    `platforms` row, computes the canonical name, groups by canonical, and
    for each group with > 1 member: merges to a single row keeping the one
    with non-NULL `commissionAccountNumber` (tiebreak by lowest id),
    updates `ical_sources.platformLabel` + `reservations.platform`
    references to the winner's name, deletes the losers. Then a defensive
    pass normalizes orphan labels in the source tables (rows with no
    matching `platforms` entry). The whole sequence wraps in
    `db.transaction()` so a partial run rolls back cleanly. Logs one line:
    `[migration:platform-names-normalized] merged N conflict(s), renamed M
    row(s)`.
  Boot smoke on the prod-copy DB after the migration: 12 → 9 platforms
  (3 conflicts merged — Gitedefrance, Lodgify, Abracadaroom — and 2 rows
  renamed to canonical). The typo `Logify` (which isn't the same string as
  `Lodgify`) survives — the formatter is a mechanical case-normalizer, not
  a spell-checker; operator can delete the typo row from the dedicated
  page if they want.
  Server tests +18 cases (11 on the formatter pinning every entry of the
  spec §3.1 table + idempotency, 7 on the migration pinning merge
  conflict resolution + defensive pass + idempotency + the `direct` enum
  pass-through). Server suite 952 / 952, Vitest 163 / 163 (no client
  change), build clean.
  **Out of scope** (each its own future spec or manual cleanup): typo
  correction, foreign-key constraint on `reservations.platform`, automated
  re-normalize tool if Adrien wants to re-run after a manual data edit
  (today's escape hatch: `DELETE FROM migrations WHERE name =
  'platform_names_normalized_v1'` + restart).
- **Accounting export — platform commission as journal lines + no-deposit on platforms**
  (spec `accounting-platform-commission-and-no-deposit.md`, 2026-06-04). Driven by
  the accountant's 2026-06-04 email pushback on the previous CSV: turnover was
  recognised on the **net** (`finalPrice`) instead of on the **gross**
  (`clientGrossAmount`), and the platform commission was just a trailing info
  column instead of a real charge journal line.
  **New shape per encaissement** (Gîtes de France booking, 687 € gross / 626 €
  net / 61 € commission):
  ```
  DÉBIT C<NAME>  626          (net = bank movement)
  DÉBIT 62260500  50,83       (commission HT — per-platform compte)
  DÉBIT 445660    10,17       (TVA déductible 20 %)
  CRÉDIT 706000   624,55      (CA HT on the GROSS)
  CRÉDIT 445711    62,45      (TVA collectée 10 % on the GROSS)
  Σ debits = Σ credits = 687
  ```
  **What's new on the database:**
  - NEW `platforms` table — deduped per-platform commission config (auto-seeded
    with the `direct` row + `DISTINCT ical_sources.platformLabel` at boot; the
    iCal source create / update path calls `platformsModel.upsertByName` so a
    fresh platform surfaces on the dedicated config page immediately).
  - `app_settings` gains `defaultCommissionAccountNumber` (TEXT, default
    `'622600'`) — fallback when a platform row doesn't set its own account —
    and `vatRateCommission` (REAL, default 20) — global rate applied to
    commissions whose row carries `hasVatOnCommission = 1`, lives in
    Settings → Général → Taux de TVA next to the existing `vatRate`.
  - One-shot migration `platform_no_deposit_v1` (gated by a `migrations` flag
    table): collapses every legacy non-direct platform reservation's deposit
    into the balance + nulls the per-line `acompteContribTtc` snapshots so the
    contrib path falls back to legacy pro-rata cleanly. **Past CSV exports
    change retroactively on these rows — accepted call per spec rule 9**;
    snapshot the SQLite DB before deploy as a safety net.
  - Backfill `clientGrossAmount = finalPrice` for direct reservations where the
    column was NULL (now always populated; `gross === net` trivially for directs).
  **What's new on the engine:**
  - `pricing.js` enforces `depositAmount = 0` + `balanceAmount = preArrivalAmount`
    on every non-direct platform, regardless of `depositPaid`. Same effect as
    `depositDisabled` but driven by `platform` instead.
  - `accountingModel.buildEntry` reads one snapshot of
    `{ defaultAccount, vatRateCommission, platformByName }` per export run.
    Scales bucket TTCs by `effectiveGross / finalPrice` so 70xxx HT + 44571x
    VAT are credited on the GROSS. For the balance entry of non-direct
    platforms: builds the commission line (HT on the resolved compte +
    optional VAT on 44566000 when `hasVatOnCommission = 1`). Complement
    entries: 0 commission (host-billed extras).
  - `accountingExport.entryToRows` debits CCLIENT at the net (= bank movement)
    + emits commission HT + VAT debit lines right after, so Σ debits = Σ
    credits = gross TTC to the cent. The CSV columns + `Pièce` numbering
    convention stay unchanged.
  **New page `/comptabilite/plateformes`** — admin + accountant edit the
  per-platform config from one centralised place. Top card = compte par
  défaut (6–8 digit fallback); bottom card = table listing every platform
  with editable compte + Switch TVA déductible. Direct row's inputs grayed
  out. The platform list is the **union of `ical_sources.platformLabel`
  AND `reservations.platform`** — so a manually-entered platform name on a
  one-off reservation also surfaces here (it wouldn't if we only seeded
  from iCal sources). A **"Rafraîchir la liste" button** on the page
  triggers `POST /api/accounting/platform-accounts/refresh` so a brand-new
  platform name appears without a server restart; the UI flashes
  *"+N nouvelle(s) plateforme(s) ramassée(s)"* on success. Sidebar gains
  the link under Suivi financier; accountant's minimal sidebar grows by
  one item.
  **Reservation FinanceSection** — Acompte block hidden on non-direct
  platforms, replaced by *"Pas d'acompte (réservation plateforme — virement
  unique)"*. Direct bookings unchanged.
  Acceptance gate — all green:
  - `npm run build`: 2.24 s, 0 esbuild warnings, gzip 464.07 kB (+1.92 kB
    vs the post-React-19 baseline, well under the +10 kB budget).
  - Vitest: 163 / 163 (162 existing + 1 updated roles test for the
    accountant's new allow-list entry).
  - Playwright E2E: 18 passed / 1 skipped / 0 failed.
  - Server tests: ~30 new cases (5 platforms-model + 7 commission-lines + 4
    no-deposit + 10 platform-accounts-endpoint + 4 vatRateCommission), on
    top of 880 pre-existing.
  **Out of scope** (each its own future spec): Pièce numbering scheme
  (deferred since the original `accountant-accounting-export.md` spec), auto-
  fill of the gross from the per-platform commission rate, alias resolution
  for manually-entered platform names that don't match an iCal source.
  **Operational note** — **snapshot the SQLite DB before deploying this PR
  to prod**. The platform-no-deposit migration is destructive: deposit
  amounts collapse into the balance on every legacy non-direct platform
  reservation. The collapse is mathematically equivalent for the
  reservation's total owed amount, but past monthly CSV exports change
  shape (one balance entry instead of deposit+balance), so the accountant
  may want a paper copy of the previous exports for cross-reference before
  the deploy.
- **Client framework: React 18 → 19 + Recharts 2 → 3** (spec
  `react-19-and-recharts-3-migration.md`, 2026-06-04). **Third and final
  major-version dep upgrade unlocked by the CRA → Vite migration (PR #111)
  — this closes the migration chain.** Combined into one PR because
  recharts 2.x peer caps at React 18 (`^16 || ^17 || ^18`); bumping React
  alone would leave the install graph in a peer-mismatch state. Recharts 3
  brings React 19 into its peer range, so doing both at once produces a
  clean graph. Bumps:
  - `react@^18.2.0` → `^19.0.0` (resolved 19.2.7)
  - `react-dom@^18.2.0` → `^19.0.0` (resolved 19.2.7)
  - `recharts@^2.10.0` → `^3.8.0` (resolved 3.8.1)
  - `@testing-library/react@^15.0.7` → `^16.3.2` (the v15 line caps peer
    at React 18; v16 is the first line with React 19 in its peer range —
    audit gap closed during implementation)
  **Zero source-file change required** per the audit. The codebase was
  exceptionally clean for a React 19 bump:
  - Entry point already uses `ReactDOM.createRoot()`.
  - Zero legacy APIs (`ReactDOM.render` / `hydrate` /
    `unmountComponentAtNode` / `findDOMNode`, string refs, legacy Context,
    `propTypes`, `defaultProps` on function components, `componentWill*`
    UNSAFE lifecycles).
  - Zero class components, `<StrictMode>`, `<Suspense>`, `useTransition`,
    `useDeferredValue`, `forwardRef` in production code, explicit
    `act(...)` calls.
  - 122 `useEffect` hooks all properly cleaned up (spot-checked the 5 most
    side-effectful — race-guards and listener removal everywhere).
  - FinancePage's 11 recharts components (`BarChart`, `Bar`, `XAxis`,
    `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`,
    `PieChart`, `Pie`, `Cell`, `Legend`) all API-stable across v2 → v3.
  Acceptance gate (spec §7.1) — all green:
  - `npm ls react react-dom recharts react-is`: single top-level `19.x` /
    `19.x` / `3.x`, no duplicate, no v18 / v2 ghost left.
  - `npm run build`: 2.36 s, **0 esbuild warnings**.
  - Vitest: **163 / 163** (160 existing + 3 new smoke cases).
  - Playwright E2E: **18 passed / 1 skipped / 0 failed**, identical to
    the post-MUI-9 baseline.
  - Server tripwire: green in isolation.
  Bundle: 445.64 → **462.15 kB gzip** (+16.51 kB / +3.7 % of the bundle).
  The original spec budget of +15 kB was relaxed to +20 kB during
  implementation once the cause was confirmed as known upstream growth
  (React 19's scheduler refactor + Recharts 3's hooks-based refactor,
  ~5 kB each per their release notes). Same protocol as the router-v7
  +5 → +10 kB call.
  New smoke coverage (`client/src/__tests__/react-19-and-recharts-3-smoke
  .test.js`, 3 cases) — pinning the contracts a hypothetical React 20 or
  Recharts 4 bump would touch:
  - `createRoot` from `react-dom/client` mounts and unmounts a tree under
    `act()` — the v18+/v19 entry-point contract.
  - `useState` round-trips a setter under `<MemoryRouter>` — modern hooks
    contract.
  - `<BarChart><Bar/></BarChart>` with explicit width/height mounts under
    recharts 3 — FinancePage chart-mount contract.
  **Out of scope** (each its own future spec): `<StrictMode>` adoption,
  `use()` hook adoption, React Compiler adoption, `<Activity>` component,
  cleanup of the 53 dead `import React from 'react'` statements that the
  automatic JSX runtime makes optional, Recharts 3 tree-shaking
  optimizations via manual sub-path imports.
  **Migration chain status: CLOSED**. The four queued major-version dep
  upgrades unlocked by the CRA → Vite PR (#111) are all shipped: router 7
  (#113), MUI 9 (#114), and this PR (React 19 + Recharts 3). The next
  session can pick a brand-new feature instead of an upgrade.
- **Client UI library: `@mui/material` 5 → 9** (spec `mui-5-to-9-migration.md`,
  2026-06-04). Second of the four queued major-version dep upgrades unlocked
  by the CRA → Vite migration (PR #111), and the gating peer for the React
  18 → 19 bump next in the chain. Bumps:
  - `@mui/material@^5.15.0` → `^9.0.1`
  - `@mui/icons-material@^5.15.0` → `^9.0.1`
  - `@mui/x-date-pickers@^6.18.0` → `^9.4.0`
  MUI skipped v8 for `@mui/material` (npm dist-tags: `latest-v7=7.3.11`
  then directly `latest=9.0.1`), so the conceptual jump is 5 → 6 → 7 → 9
  but the npm bump is a single `^9.0.1` install. **Zero observable behavior
  change** for the end user; visual + interactive parity verified by the
  acceptance gate.
  Acceptance gate (spec §7.1) — all green:
  - `npm ls @mui/material @mui/x-date-pickers @mui/icons-material`: single
    top-level `9.x` on each, every emotion peer deduped on 11.14.x.
  - `npm run build`: 2.19 s, **0 esbuild warnings**.
  - Vitest: **160 / 160** (156 existing + 4 new MUI smoke cases).
  - Playwright E2E: **18 passed / 1 skipped / 0 failed**, identical to the
    post-router-v7 baseline.
  - Server tripwire: green in isolation (allow the same 2-3 pre-existing
    parallel-runner flakes).
  Bundle: 434.13 → **445.64 kB gzip** (+11.51 kB / +2.6 % of the bundle),
  well under the +25 kB strict budget set in spec §3.5 + §9 Q3.
  Source-side migration shape (`mui-codemod` ran transiently via npx,
  never installed as a dep):
  - **Grid v2 API**: 56 `<Grid item xs/sm/md/…>` sites across 8 files
    collapsed into `<Grid size={{…}}>`. Codemods used:
    `v6.0.0/grid-v2-props` + `v7.0.0/grid-props`.
  - **TextField slot APIs**: `InputProps`, `InputLabelProps`,
    `FormHelperTextProps` → `slotProps={{ input, inputLabel, formHelperText }}`
    across 24 files. Codemod: `deprecations/text-field-props`.
  - **ListItemText slot API**: `<ListItemText primaryTypographyProps=…>` →
    `slotProps={{ primary: … }}` in the App.js sidebar nav (10+ sites in
    one file). Codemod: `deprecations/list-item-text-props`. Caught when
    the E2E `Dashboard loads with zero console errors` test failed on a
    React `unknown DOM prop primarytypographyprops` warning.
  - **`color="default"` cleanup**: 2 manual fixes — Chip on FinancePage
    ("Acompte désactivé") + IconButton on DevisPage (convert action). The
    `default` color token was removed in v6+; without a `color` prop the
    rendered look matches the pre-fix.
  - **`<Switch>` accessibility upgrade**: v9 exposes WAI-ARIA `role="switch"`
    instead of `role="checkbox"`. Two ExtrasSection test assertions
    updated (`getAllByRole('checkbox')` → `getAllByRole('switch')`).
  - **Icon path rename**: `@mui/icons-material/DeleteOutline` (1 site in
    UserManagementPage) → `DeleteOutlineOutlined`. The bare `Outline`
    variants were dropped in v9 in favor of the `Outlined` suffix.
  New smoke coverage (`client/src/__tests__/mui-smoke.test.js`, 4 cases —
  one more than the spec's original 3 to pin the Switch accessibility
  upgrade that surfaced during the work):
  - `<Grid container><Grid size={{ xs: 12, md: 6 }}>…</Grid></Grid>` —
    pins the v9 Grid API shape.
  - `<Chip>` without a `color` prop renders correctly — pins the
    post-`color="default"` shape.
  - `<Switch slotProps={{ input: { 'aria-label': … } }}>` exposes
    `role="switch"` — pins the v9 accessibility upgrade and the
    `slotProps` migration.
  - `<DatePicker>` under `<LocalizationProvider dateAdapter={AdapterDayjs}>`
    mounts — pins the date-pickers v9 contract.
  **Out of scope** (each its own future spec): `cssVarsTheme` adoption,
  `@mui/material-pigment-css` engine (zero-runtime alternative to emotion),
  `@mui/x-data-grid` adoption, `<DateField>` field-component UX.
  **Next in the chain**: React 18 → 19 (now unblocked — MUI 9 fully
  supports React 19), then Recharts 2 → 3 (independent of the chain).
- **Client routing: react-router-dom 6 → 7** (spec `react-router-7-migration.md`,
  2026-06-04). First of the four queued major-version dep upgrades unlocked by
  the CRA → Vite migration (PR #111). Bump `react-router-dom@^6.20.0` (resolved
  `6.30.4`) → `^7.16.0` (resolved `7.17.0`). **Zero observable behavior change**
  for the end user; **zero source-file change required** — the 10 APIs we use
  (`BrowserRouter`, `MemoryRouter`, `Routes`, `Route`, `Link`, `Navigate`,
  `useLocation`, `useNavigate`, `useParams`, `useSearchParams`) keep identical
  signatures in v7. The audit confirmed zero data-router APIs in use
  (`createBrowserRouter`, `RouterProvider`, `loader:`, `action:`, …) so the
  migration was a `package.json` bump + a verification gate, not a routing
  rewrite.
  Acceptance gate (spec §7.1) — all green:
  - `npm ls react-router-dom`: single top-level `7.17.0`, no duplicate transitive.
  - `npm run build`: 2.24 s, **0 esbuild warnings**.
  - Vitest: **156 / 156** (153 existing + 3 new smoke cases pinning the
    classic-API contract for any future v8 bump).
  - Playwright E2E: **18 passed / 1 skipped / 0 failed**, identical to post-Vite.
  - Server tripwire: 890 / 892 (2 pre-existing parallel-runner flakes that pass
    in isolation, unrelated to this change).
  Measured bundle size: 428.24 → **434.13 kB gzip** (+5.89 kB / +0.4 % of the
  bundle). Driven by an expected upstream change documented in the v7 release
  notes: `@remix-run/router` no longer ships as a separate sub-package, the
  data-router internals are bundled directly inside `react-router` even for
  classic-API consumers. The original spec budget of +5 kB was relaxed to
  +10 kB during implementation (§3.5 rule 13 + §9 Q3 updated) once the cause
  was confirmed as a non-regression; reverting the bump for +0.4 % of the
  bundle would block the entire upgrade chain (MUI 9, React 19, Recharts 3)
  for no functional gain.
  New smoke coverage (`client/src/__tests__/router-smoke.test.js`, 3 cases):
  - `<BrowserRouter>` mounts a `<Routes>` + `<Route element>` tree.
  - MUI `<Button component={RouterLink} to=…>` renders an anchor with the
    right `href` — pins the forwardRef adapter pattern used in
    `AccountingPage.js` (journal entry → reservation link).
  - `useNavigate()` round-trips the pathname under `<MemoryRouter>` — the
    foundation of every imperative navigation (28 call sites in the app).
  **Out of scope** (each its own future spec): data-router adoption
  (`createBrowserRouter` + loaders / actions), route-level `errorElement`,
  `useNavigate({ flushSync: true })`. Picked up only if/when concrete use
  cases appear.
  **Next in the chain**: MUI 5 → 9 (the big one, the React 19 unlock), then
  React 18 → 19, then Recharts 2 → 3.
- **Client build stack: Create React App → Vite** (spec `cra-to-vite-migration.md`,
  2026-06-04). The biggest single change since `V02.01.00`. Replaces `react-scripts`
  with `vite ^7` + `@vitejs/plugin-react` for the build/dev server, and migrates the
  test runner from Jest (via `react-scripts test`) to `vitest ^3`. All 19 existing
  client unit test files (144 cases) ported and stay green; the E2E smoke suite from
  PR #110 stays green and identical (**18 passed / 1 skipped / 0 failed**) — the
  migration's primary acceptance criterion per spec §7.1.
  Measured wins:
  - `npm audit` on the client tree: **42 vulnerabilities → 0 in production deps**.
    A single critical remains in `vitest` itself (CVE on its UI server which we
    NEVER expose — Vitest only runs in CI / locally). Down from 19 high / 14
    moderate / 9 low.
  - Production build wall time: **~40 s → 2 s** (Vite + Rollup + esbuild).
  - Dev server boot: **~30 s → ~1 s** (esbuild pre-bundling).
  - `npm warn deprecated` count on install: **~25 → 2** (the remaining two are
    `@mui/base@5.0.0-dev` and `recharts@2` — both unrelated to the build stack and
    addressable when those libraries are upgraded).
  - **Second-order win caught by Vite's strict ESM**: the first `npm run build`
    on this branch surfaced **two duplicate `complementPaid` keys** in the same
    object literal in `client/src/pages/ReservationPage.js` (lines ~938 and
    ~1707, both reservation-save build sites). CRA's Babel chain silently
    overlooked them; esbuild flags the construct as a hard warning. Three dead
    assignments removed, no behaviour change (last-write-wins was the same
    value), but a real code-quality cleanup the migration uncovered. Documented
    in the spec edge-cases section.
  Migration shape (single PR):
  - `client/`: `react-scripts` removed; `vite` + `@vitejs/plugin-react` + `vitest` +
    `jsdom` added. New `client/vite.config.js` + `client/vitest.config.js`. The
    HTML entry moves from `client/public/index.html` to `client/index.html` (Vite
    convention); `%PUBLIC_URL%` references resolve to `/` now.
  - `client/src/api.js`: `process.env.REACT_APP_API_URL` → `import.meta.env.VITE_API_URL`.
  - `client/src/utils/applyQuoteToForm.js`: lone CJS `module.exports = ...` →
    `export { ... }` (Vite's strict ESM caught it; CRA tolerated via Babel interop).
  - All 19 client tests + the shared `mockReservationForm.js` fixture: `jest.*` →
    `vi.*` calls + `import { vi } from 'vitest'`. `DevisPage.test.js` got the proper
    `vi.hoisted()` + `vi.importActual` pattern for hoisted mock-with-state cases.
    `StaySection.test.js` got the explicit `{ default: ... }` factory wrapper Vitest
    needs (Jest auto-wrapped a raw return).
  - `client/src/setupTests.js`: unchanged in spirit — auto-loads
    `@testing-library/jest-dom`; the temporary `globalThis.jest = vi` shim used
    during the porting was removed once every test file was converted.
  - `release.sh`: build path `client/build` → `client/dist`. The release archive
    still ships the bundle at `client/build/` (rename happens during `rsync`) so
    the Pi PM2 deploy layout stays backwards compatible.
  - `.github/workflows/deploy.yml`: drops `GENERATE_SOURCEMAP=false` env (now lives
    inside `vite.config.js` as `build.sourcemap = false`).
  - `README.md`: 3 mentions updated for Vite.
  - `.gitignore`: adds `client/dist/`.
  **Build output security posture preserved**: no sourcemaps in prod
  (`build.sourcemap = false`), zero inline runtime scripts (Vite's default — keeps
  the `script-src 'self'` CSP from PR #91), same proxy / cookie behaviour, same
  Pi deploy layout.
  **Out of scope** (each is its own future project, listed in spec §8): React
  18 → 19, MUI 5 → 9, react-router 6 → 7, TypeScript adoption, PWA. None of these
  is blocked by build tooling any more — Vite supports all of them.
  **Rollback** if needed: the tag `V02.01.00` snapshots the pre-migration master.
  `git push origin V02.01.00:release` redeploys the legacy CRA build with zero
  schema migration to undo (none happened).
- **Anonymised personal identifiers in public docs** (2026-06-04). The repo is public on
  GitHub; the HTTPS setup docs introduced over the last few weeks hardcoded the owner's
  business email, Free DDNS hostname, production subdomain, and Pi LAN IP — all
  indexable by anyone cloning the repo or browsing GitHub. A forward-only sed sweep
  replaces them with placeholders across `README.md`, `CHANGELOG.md`, and the helper
  scripts under `scripts/` + `server/scripts/`:
  | Real value | Placeholder |
  |---|---|
  | `contact@domainesolio.com` | `you@example.com` |
  | `maisonadrisoph.freeboxos.fr` / `.com` | `<your-freebox-dyndns>.freeboxos.fr` / `.com` |
  | `guestflow.domainesolio.com` | `<your-app>.<your-domain>` |
  | `www.domainesolio.com` | `www.example.com` |
  | `192.168.0.196` | `<your-pi-lan-ip>` |
  **Forward-only** by design: rewriting git history (`git filter-repo` + force-push)
  would break clones / forks and GitHub still caches old commit content via the API for
  weeks anyway, so the marginal benefit is low for a solo public repo. The trade-off
  was explicitly chosen on 2026-05-31. Brand names (Squarespace, Freebox / Free) stay
  in the docs as concrete worked examples — they are categories of provider, not
  personal identifiers.
- **iCal sync no longer auto-deletes cancelled reservations** (spec
  `ical-cancellation-approval.md`, 2026-06-03). Previously, when a reservation's UID fell
  out of every source feed, the engine silently deleted it — including locked,
  user-edited reservations. The engine now records ONE pending cancellation per
  reservation in `ical_cancellation_alerts` (UPSERT — multiple sources dropping the same
  UID in cascade don't duplicate the alert). The Dashboard mounts a new
  `<IcalCancellationAlert />` orange card listing every pending cancellation with three
  per-row actions:
  - **Supprimer** → atomic delete: history audit entry → DELETE reservations →
    DELETE ical_import_events. Idempotent shape (`outcome: 'reservation_gone'`) if the
    reservation was already manually removed between sync and click.
  - **Voir la fiche** → opens the reservation without acknowledging.
  - **✕** → ignores the proposal; the reservation stays as a "detached" iCal-origin row.
  Auto-resolve: at the top of every `syncSource()` call, pending alerts whose
  `(sourceId, eventUid)` matches an incoming feed event are silently deleted (the
  platform un-cancelled the booking). Cross-platform protection is preserved — the
  alert only fires once every iCal source has dropped the UID. The sync result's
  `removedCount` keeps its key but its meaning shifts to "cancellation alerts raised";
  the user-facing status string was reworded to `… annulation(s) à valider`. 24 new
  server tests pinning the contract (model UPSERT + auto-resolve + atomic approve +
  reject, sync engine soft flow + cross-platform protection + auto-resolve, controller
  HTTP shaping for the 3 new endpoints).
- **Single global VAT rate** (spec `single-vat-rate.md`, 2026-06-03). The previous 2-rate
  model — 10 % for accommodation, 20 % for everything else — was collapsed to ONE editable
  rate (default 10 %) after the comptable confirmed every revenue stream on a GuestFlow
  installation is invoiced under the reduced rate. The Settings page exposes one field
  "Taux de TVA (%)"; the pricing engine, devis PDF, finance reporting, accounting model
  and accounting CSV export all consume the single rate. The quote payload keeps the three
  `vatPercentageAccommodation` / `vatPercentageOptions` / `vatPercentageResources` keys
  (downstream readers untouched) — they all hold the same value now. PricingSummary's
  per-bucket HT/VAT breakdown collapses to a single "TVA {rate} %" line.
  - **Retroactive**: historical reservations re-export at the new rate. The accounting CSV
    emits ONE VAT line per encaissement on account `44571100` (TVA 10 %); no more
    `44571200` rows. Past TTC totals are unchanged; only the HT / VAT split shifts.
  - The `vatAccountForRate` resolver + `STANDARD_20` constant stay defined as dormant
    safety nets: if the editable field is ever set to 20 % temporarily, the export still
    maps to the right GL account without code change.
  - Test sweep: 12 server test fixtures collapsed from 2-rate to single-rate; the dedicated
    `pricing-vat-two-rates.unit.test.js` was renamed (`git mv`) to
    `pricing-vat-single-rate.unit.test.js` and rewritten.
- **Property defaults now drive the laundry counter for ALL reservations of that property —
  past and future** (spec `weekly-bed-linen-tracking.md` rule 36, 2026-06-03). When the
  operator activates a linen option as default on a property, every reservation of that
  property contributes to the laundry counter even if the option isn't in the reservation's
  `reservation_options`. Covers: pre-feature reservations (no option ticked), edge cases where
  the operator unticked the option, and any future reservation regardless of creation path.
  SQL: each aggregation (`dropOffForWindow`, `dropOffBathroomForWindow`) UNION ALLs an
  explicit-row source and a property-default-fallback source inside its `sub` JOIN; the
  fallback is suppressed by `NOT EXISTS` when an explicit row is present so operator intent
  (linenIncludes* flags + bathroom qtySum sub-occupation factor) is never silently overridden.
  Devis exclusion still wins.
- **PlanningPage day-card colour palette** (spec `weekly-bed-linen-tracking.md` §6.1, follow-up
  2026-06-02). Replaced the flat white default on every day-cell card to give a clearer visual
  hierarchy at a glance:
  - **LaundryDayCard**: laundry-themed cyan (`cyan[50]` bg + `cyan[200]` border + `cyan[800]`
    icon/title) — visually the most prominent of the three card types.
  - **ReservationCard (arrivée)**: warm peach background (`orange[50]`) when no alert is firing —
    welcoming, attention-grabbing without being flashy. Alert (orange / red / blue) and "done"
    (green) overlays still take priority.
  - **DepartureMiniRow (départ)**: very pale grey (`grey[100]`) — deliberately quieter than the
    arrival peach so arrivals dominate the eye at a glance.
- **Accountant CSV export aligned with the SOLIO example** (spec
  `accountant-accounting-export.md` §3.4 rules 13–16, resolves §9 Q1). After Adrien received the
  `Exemple export ventes SOLIO.csv` reference file, the accountant CSV now matches it column-for-
  column on the 9 mandatory columns:
  ```
  Jour ; Mois  ; Année ; Journal ; Pièce ; Libellé de l'écriture ; Compte ; Débit ; Crédit
  ```
  - Header `Mois ` carries a trailing space byte-for-byte from the example file.
  - `Journal` constant `VT` (Ventes).
  - `Pièce` empty for now — left blank until Adrien settles a numbering scheme with the
    accountant. The column stays in the header.
  - `Libellé de l'écriture` uppercased "FIRSTNAME LASTNAME" (`CLAIRE NOTIN`).
  - `Débit` / `Crédit`: counter-side cells render as literal `0` (the accountant's software
    ingests these numeric); whole numbers render bare (`144`, `0`); fractions render with French
    comma decimal at 2 places (`519,17`).
  - Client account format relaxed: `C` + first 6 chars of last name, **no padding** (matches
    SOLIO's variable-width codes `CNOTIN`, `CCAGGUI`). Empty / unknown → literal `CXXXXX`.
  - GuestFlow extension columns kept: `Plateforme;Prix payé client;Commission` — appear after the
    9 SOLIO columns on the debit row only. The accountant ignores them; Adrien still sees the
    platform info in the same file. (Per Adrien's choice over a separate file or dropping them.)
  - **Encoding**: switched from UTF-8 BOM to **ISO-8859-1 (latin1)** without BOM. French
    accounting software defaults to latin1 and chokes on the BOM. The controller now serves
    `Content-Type: text/csv; charset=ISO-8859-1` with a `Buffer.from(csv, 'latin1')` body.
- **Tourist tax re-included in the journal as a `46710000` pass-through line** (policy change
  2026-06-01 from the SOLIO example). Previously, the tax was stripped from the accountant
  journal entirely ("tax reported via Suivi taxe de séjour, not the journal"). The SOLIO example
  credits the tax on `46710000` ("compte d'attente" — the owner owes it to the commune, not
  turnover), and the accountant needs both sides of every encaissement balanced. Each entry now
  carries a `taxTtc` field surfaced from the per-bucket capture columns
  (`touristTax{Acompte,Solde}ContribTtc`); when > 0, the export emits a credit on `46710000`.
  The Suivi taxe de séjour page stays — it's the operational view. The full encaissement TTC
  (revenue + tax) is now the debit, where previously the debit was revenue-only.
  - Pure-tax encaissements (the complement entry on an owner-collected non-direct booking with
    no extras) are no longer dropped — they emit as a valid 1-debit + 1-credit row on `46710000`.
  Tests: `accounting-csv-solio-format.unit.test.js` (7 new pinned-format cases byte-comparing
  the produced CSV to the SOLIO example) + updates to `accounting-export.unit.test.js` (10
  tests rewritten for the new column layout), `accounting-model-tourist-tax.unit.test.js` (3
  tests rewritten for the new policy), `accounting-per-line-contribs.unit.test.js` (1 test
  rewritten), `csv.unit.test.js` (integer-render rule).
  Migration: no DB change. Existing reservations re-export with the new format automatically.
- **Sidebar is rendered by a single code path for every role** (spec
  `admin-account-management.md` follow-up #5). The dedicated accountant branch is gone — there's
  one `NavContent` tree, and each item (top-level + every submenu child) is conditionally rendered
  via `canSeeRoute(user, path)`. Per-route allowlist lives in
  `client/src/constants/roles.js#ROUTE_ROLES` (admin everywhere; accountant only on `/comptabilite`
  + `/account`). Submenu **parents** survive iff at least one of their children is visible
  (`canSeeAnyRoute`), so an accountant sees `Suivi financier > Comptabilité` and
  `Paramètres > Gestion utilisateur` with the parent labels intact instead of a flattened
  two-item list. When the parent's own path isn't reachable (accountant on `/settings`), the row
  drops its `Link` props and only toggles the submenu — drawer-close is suppressed in that case
  so the user can still pick their authorised child. New client tests pin the accountant scope
  (8 cases on `canSeeRoute` / `canSeeAnyRoute`); a drift here will be caught before it ships.
  Resolves Adrien's "afin de ne pas dupliquer le code du menu de gauche" feedback.
- **"Gestion utilisateur" page moved under `Paramètres`** (spec
  `admin-account-management.md`). Same route `/account`, same content gating — only the sidebar
  entry-point moved: it's now a submenu of "Paramètres" alongside Logements / Options / Clients /
  Vacances scolaires / Fermetures, with `<AdminPanelSettingsIcon />`. The Paramètres submenu
  auto-opens when `/account` is the current path. For accountants, the entry is now also reachable
  via `Paramètres > Gestion utilisateur` (follow-up #5 above unified the sidebar code so the
  accountant sees the same shell with admin-only items hidden).
- **Outgoing emails sign with the SMTP sender's display name + carry an "auto-generated" notice.**
  Welcome / reset / SMTP-test bodies now end with `Ce message est généré automatiquement.` followed
  by `— {smtpFromName}` (falls back to `GuestFlow` when no name is configured). Replaces the
  previous hardcoded "— GuestFlow" trailer.
- **SMTP password input strips all whitespace before saving.** Gmail App Passwords are displayed in
  a `abcd efgh ijkl mnop` 4-by-4 format; copy-pasting them verbatim used to bounce with
  `5.7.8 Username and Password not accepted` because the transport sent the literal spaces. The
  cleanup is server-side in `settingsController.updateSettings`, transparent to the user, and only
  touches the password field. Adrien's reset / restore flow no longer needs the "tap each space"
  ritual.
- **VAT — two global rates instead of three per-property** (spec `accountant-accounting-export.md`, PR 1):
  VAT is now configured by two app-wide rates in **Paramètres → Taux de TVA** — **accommodation**
  (`vatRateAccommodation`, default 10 %) and **standard** (`vatRateStandard`, default 20 %, used by
  options, custom options and resources). The pricing engine, the reservation/devis quote, the devis PDF
  and the reservation TVA summary read these globals; the per-property `vatPercentage*` columns have
  been **dropped** entirely (not just dormant). TTC totals are unchanged (VAT is extracted from TTC).
  New unit tests: `pricing-vat-two-rates` (5).
- **Integrations — MVC extraction** (Bloc 6, spec `integrations-mvc.md`): `routes/ical.js`,
  `googleCalendar.js`, `options.js`, `calendarNotes.js` become thin routes over controllers + models.
  The iCal token lifecycle + `.ics` export move out of `database.js` into `icalModel`; the Google event
  builders → `utils/googleCalendarEvents.js` (pure) with the reservations+options read in
  `googleCalendarModel`; options + calendar-notes get their own model/controller. No API/UX change. New
  unit tests (ical-model, options-model, calendar-notes-model); suite green (350).
- **Devis ↔ Reservation table fusion** (spec `devis-reservation-fusion.md`): devis are now rows in the
  unified `reservations` table (`kind='devis'`), their lines in the `reservation_*` children — the parallel
  `devis_*` tables are gone. `devisModel` reads/writes `reservations WHERE kind='devis'` (status stored as
  `devisStatus`, aliased back to `status` so the devis API/PDF/convert are unchanged). Every reservation
  read (occupancy, availability, blocked-night/cleaning, baby beds, resource availability, finance
  summary/projection/operational/tourist-tax, Google Calendar push, client delete-impact/orphan cleanup)
  now filters `kind='reservation'`, so a devis never blocks a date or counts as revenue. No API/UX change.
- **Properties — MVC extraction** (spec `properties-mvc.md`): `routes/properties.js` (**1260 LOC**, the
  last CRITICAL monolith) becomes a thin route over `propertiesController` + `propertyIcalController` over
  `propertiesModel` (CRUD + enriched detail + pricing rules/apply-to + documents + options + platform
  colours) and `propertyIcalModel` (sources CRUD + the anti-overbooking **sync engine moved verbatim**).
  Pure iCal parsing → `utils/icalParser.js`; upload plumbing → `utils/propertyUploads.js`. The iCal
  source **status-update was triplicated** (the `/sync` route, `/sync-all`, and `scheduledTasks`) and is
  now one `syncSourceAndRecord` method. API contract, payloads and behaviour unchanged; no schema change.
  New tests: `property-ical-sync` (7, anti-overbooking) + `properties-model` (7); migrated
  `properties-ical` to `utils/icalParser`. Server suite **346** green.
- **Finance & Dashboard — server-owned money, MVC, render-only pages** (Bloc 5, spec
  `finance-dashboard-thin.md`): `routes/finance.js` (403 LOC) is now a thin route over `financeController`
  + `financeModel`, with pure helpers in `utils/financeCalcs.js`. All payment math + overdue derivation +
  aggregation + upcoming grouping moved server-side. `FinancePage` and `Dashboard` are **render-only** —
  the two duplicated `getRemainingDue` implementations, the overdue `map/filter/sort/reduce`, the
  upcoming-by-property grouping and the inline `nights`/`remainingDue` math are gone; both pages read
  server fields. `/summary` reservations are enriched with `remainingDue` + overdue flags. No schema change.
- **CalendarPage — structural decomposition** (Bloc 3, spec `calendar-page-decomposition.md`):
  `CalendarPage.js` drops from **1255 → ~430 LOC**, becoming a thin orchestrator (data loading + drag
  selection + wiring). The intricate rendering moves **verbatim** into focused, page-specific pieces:
  `utils/calendarVisuals.js` (pure date/%/colour/label helpers, unit-tested), `hooks/useInfiniteMonthScroll.js`
  (months list + scroll/preload/focus machinery), and components `CalendarToolbar`, `CalendarDayCell`
  (the occupancy gradients + click-zone hit-testing), `CalendarMonthGrid` (sticky header + cells→rows
  assembly), `CalendarNoteDialog`. **No behaviour or visual change** (the pricing engine was already
  removed with the dead reservation dialog — this is a readability refactor). Verified in-browser
  (gradients, closures, holidays, 0 console errors) + clean `CI=true` build.
- **Devis — MVC refactor + PDF service extraction** (Bloc 4, spec `devis.md`): `routes/devis.js` (1543 LOC)
  is now a thin route over `devisController` + `devisModel` (CRUD with a single shared persist helper,
  enrich, payment schedule, history/audit, both convert flows). The ~574-LOC inline `pdfkit` generator is
  extracted **verbatim** into `utils/devisPdf.js` (`generateDevisPdf(devis, settings) → Buffer`); shared
  money/date/format helpers moved to `utils/devisHelpers.js`. Pricing stays in the shared engine; no schema
  change; the API contract is unchanged and the PDF layout is preserved **except one deliberate footer fix**
  (see Fixed). New unit tests, including money-critical create/update persistence + the audit fix
  (`devis-model-create.unit.test.js`); server suite green (315). The `devis_*`/`reservation_*` table fusion
  remains a deferred follow-up.
- **Resources — MVC refactor + applicability pivot + safe delete** (Bloc 1, spec `resources.md`):
  `routes/resources.js` and `routes/resourceBookings.js` are now thin routes over
  `resourcesController`/`resourcesModel` and `resourceBookingsController`/`resourceBookingsModel` (price
  resolution, availability, slot-conflict and the server-computed booking price now live in models).
  Resource↔logement applicability is normalized into a **`resource_properties` pivot** (mirrors
  `property_options`); the API still exposes `propertyIds` arrays, and `utils/pricing.js`, the baby-bed
  availability and the baby-bed seed all read the pivot. Resource writes are validated (`400`). Deleting a
  resource that is used by reservations or bookings now asks for confirmation stating the impact
  (`409 RESOURCE_IN_USE` + `?force`). New unit tests; full server suite 297.
- **Clients — MVC refactor + single phone** (Bloc 1, spec `clients.md`): `routes/clients.js` is now a thin
  route over `clientsController` + `clientsModel` (reusing `clientValidation`). A client now has a single
  `phone` (the multi-number list is gone — see Migration); the client form shows one Téléphone field.
  The deletion-impact endpoint is server-shaped (reservations sorted + `nights`) and now also surfaces the
  **devis** that the cascade will delete — so a client with only devis is no longer deleted silently, and
  the delete dialog lists both reservations and devis. The devis PDF reads the single `client.phone`.
  New unit tests (model, controller, migration); server suite green (274).
- **Devis editor — accept-to-convert flow + "Actualiser tarifs"** (spec `devis-accept-to-reservation.md`):
  removed the standalone "Passer en réservation" action; converting a devis to a reservation now happens
  by setting its status to **Accepté** in the dropdown, which asks for confirmation before, on confirm,
  **saving the devis, converting it into a persisted reservation, and opening that reservation** —
  whose "Annuler"/retour goes back to the **calendar centered on it** (`?from=/calendar`). The Finance
  section's **"Actualiser tarifs"** button is now also available in devis mode (recompute with current
  rates + clear any manual price).
- **ReservationPage form split into section components via a form context** (Bloc 3 slice 3c-3, spec
  `reservation-form-sections.md`) — the long left-column form JSX is decomposed into focused, feature-local
  components under `client/src/components/reservation/`: `StaySection`, `GuestsBedsSection`, `ExtrasSection`
  and `FinanceSection` (Client / Canal / Notes kept inline). A new `ReservationFormContext` +
  `useReservationForm()` hook exposes the form bundle (state, derived capacity/pricing values, handlers,
  catalogs, flags) so the sections consume what they need with **no prop-drilling**. ReservationPage keeps
  owning all state, the pricing effect and every handler — it just assembles them into one context value
  and renders `<ReservationFormProvider>…<StaySection/>…`. No behavior or visual change. Added React
  Testing Library + `setupTests.js`; **19 component tests** (one suite per section + a context-guard test)
  pin each feature against regressions. Verified by a clean `CI=true` build + in-browser (dates → quote
  refreshes to 740.88€ total, 0 app console errors).
- **PricingSummary extracted from ReservationPage** (Bloc 3 slice 3c-2, spec
  `pricing-summary-extraction.md`) — the ~525-LOC right-panel pricing summary moved to a presentational
  `client/src/components/PricingSummary.js`. Renders the server quote (accommodation struck/green,
  options/resources with "Offrir", extra-guest, tourist tax + detail, VAT breakdown, total,
  deposit/balance/caution); owns its display-detail toggles internally; lifts "Offrir" interactions to
  the page via callbacks. No behavior/visual change; verified by a clean `CI=true` build + in-browser
  (0 console errors, identical rendering).
- **ReservationPage action bar → shared `PageActionBar`** (Bloc 3 slice 3c-1, spec
  `reservation-page-action-bar.md`) — the bespoke `position: fixed` bar (and its `mt` layout
  compensation + hard-coded sidebar offset) is replaced by the shared sticky `<PageActionBar>`, same
  actions/conditions/handlers (back, créer/transformer devis, statut devis, PDF, passer en réservation,
  Save, Cancel, Supprimer). `PageActionBar` gained two backward-compatible capabilities: an `onBack`
  handler (for computed back navigation) and custom-node action items (`{ node }`, e.g. the devis-status
  `<Select>`). Verified in-browser (reservation + devis modes, 0 console errors).
- **CalendarPage dead reservation dialog removed** (Bloc 3 slice 3b, spec `calendar-dead-dialog-removal.md`)
  — pure dead-code removal, no behavior change. The unreachable in-page reservation create/edit dialog
  (`dialogOpen` was never set true; all entry points navigate to the ReservationPage route) and
  everything used only by it (form state, debounced pricing effect, option/resource setters,
  `applyQuoteToForm`, capacity/baby-bed loaders, inline create-client flow, related imports) were
  deleted: `CalendarPage.js` 2274 → 1251 LOC (−1023). The live calendar (rendering, navigation, note
  dialog, occupied/closure/cleaning bands) is unchanged; verified by a clean `CI=true` build + in-browser
  check (calendar renders, reservation click → `/reservations/:id`, 0 console errors).
- **Reservations backend MVC extraction** (Bloc 3 slice 3a, spec `reservations-backend-mvc.md`) — pure
  structural refactor, **no API/behavior change**. The 1317-LOC `routes/reservations.js` monolith is now
  thin (verb/path → controller); logic moved to `controllers/reservationsController.js`,
  `models/reservationsModel.js` (all SQL), and pure utils `utils/occupancy.js`,
  `utils/reservationAudit.js`, `utils/bedDistribution.js`, `utils/reservationHelpers.js`. Same endpoints,
  payloads, status codes, history/iCal-lock/pricing-snapshot behavior. New unit tests (occupancy, audit)
  + manual create/conflict/history/delete verification; full suite green (255).
- **Pricing (Bloc 2):** `PlanningPage` now renders the server-computed effective quantity (`billedUnits`)
  instead of recomputing per-price-type multipliers client-side (`getMultiplier`/`getEffectiveQty`
  removed). `CalendarPage`'s dead local `recalcPrice` duplicate was removed. `ReservationPage`'s
  "Actualiser les tarifs" now also clears any manual price (reverts fully to engine pricing), and the
  redundant "Remise sur hébergement" summary line was removed (the struck engine price already conveys it).
- `GET /api/school-holidays` response shape changed from `Array` to `{ periods, syncState }`. Updated existing callers (`CalendarPage.js`, `PropertyPricingSeasonsPage.js`) to extract `.periods`. New endpoints `POST /api/school-holidays/sync`, `GET/PUT /api/school-holidays/sync-settings`, `PUT /api/school-holidays/:id/unlock`. `POST` and `PUT /:id` now validate (`400 INVALID_PERIOD`) and `PUT /:id` flips `isLocked = 1` when editing an officially-imported row.
- `scheduledTasks.js` runs a new hourly tick for school-holidays auto-sync, plus a 60s boot tick that fires the first sync if the configured interval has elapsed since the last run.
- `POST /api/reservations` and `PUT /api/reservations/:id` now reject overlapping closures with `409 CLOSURE_COVERS_DATE` and a French message naming the closure label + range.
- `GET /api/reservations/occupied-dates/:propertyId` now appends closure-covered date strings to its result (shape kept as `string[]` for backward compatibility) so the Calendar drag-gate automatically blocks closed days.
- `resources` no longer relies on the legacy `propertyId` single-FK column for property scoping. All callers (`routes/resources.js` baby-bed availability, `routes/reservations.js` baby-bed validation in POST + PUT, `database.js` baby-bed seed) now read/write `propertyIds` JSON exclusively. Single source of truth.
- Settings backend extracted to MVC: `routes/settings.js` → thin route → `controllers/settingsController.js` → `models/settingsModel.js`. Validation in dedicated `utils/settingsValidation.js`. Response shaping in `utils/settingsResponse.js`. Multer logo config in `middleware/multerLogoUpload.js`.
- `GET /api/settings` response wrapped under `{ company, quote, googleCalendar, updatedAt, updatedAtLabel }`; the Google Calendar private key is masked server-side (`privateKeyMasked` + SHA-256 `privateKeyFingerprint`); service account email is also exposed in a masked form for display.
- `PUT /api/settings` validates inputs and supports per-field "absent = preserve" semantics within each group, plus 3-way `privateKey` semantics (absent → preserve, `""` → clear, non-empty → validate + store).
- Google Calendar helpers (`getGoogleCalendarConfig`, `getGoogleCalendarClient`, `sanitizePrivateKey`) moved from `routes/googleCalendar.js` to `utils/googleCalendarClient.js`. `googleapis` is now `require`'d lazily so a missing dependency does not break boot or other endpoints.
- `routes/devis.js` now sources app settings via `settingsModel` (instead of the removed `db.getAppSettings`).
- L'email de rappel d'arrivée est désormais envoyé à **J-2** (au lieu de J-1) : il annonce la **date de début de séjour** plutôt que « demain », indique de rechercher « Domaine Solio » sur le GPS, et rappelle aux clients ayant réservé le **bain nordique** d'apporter maillot, peignoir/serviette et tongs (rien n'est fourni), en rappelant le **créneau réservé** si une heure est planifiée.
- **Site public — le lit bébé n'est plus annoncé « gratuit »** (spec `baby-bed-supplement.md`, 2026-08-20). La ligne « Lit(s) bébé souhaité(s) ? » du tunnel de réservation affiche le tarif servi par l'API (« 5,00 € par lit, pour le séjour ») au lieu de « Gratuit, selon disponibilité », et le devis en ligne inclut le supplément. Aucun montant n'est codé dans le plugin : sans tarif configuré, la mention redevient « Selon disponibilité ». Plugin WordPress 1.6.0.
- **Planning arrival cards: bed icons instead of "SIMPLE/DOUBLE" text.** The bed breakdown on the arrival tiles (`ReservationCard`) now shows a small **front-view bed pictogram** drawn as a thin **black line icon** — a **narrower** bed with **one pillow** for a single, a **wider** bed with **two pillows** for a double — keeping the `×N` count; baby beds keep their short "BÉBÉ" label. New reusable `client/src/components/BedIcon.js`. (The public WordPress accommodation pages use a coloured variant of the same pictogram.) +2 test assertions.
- The bed-linen option titled « Linge de lits » (plural) is normalised to **« Linge de lit »** (singular) on every server, at boot (idempotent, scoped to the `autoOptionType='bed_linen'` row).
- `better-sqlite3` passe de **11 à 13.0.3** (serveur + racine), et les trois workflows repassent sur
  la majeure flottante `node-version: '24'` — l'épinglage `24.18.0` de la veille n'était qu'un
  garrot, qui gelait aussi les correctifs de sécurité de Node. C'est ce retard de deux majeures sur
  le driver qui avait fait crasher tous les processus de tests à leur fermeture dès la sortie de Node
  24.19.0. Aucun changement applicatif : les API utilisées (`prepare`, `transaction`, `exec`,
  `pragma`, bases `:memory:`) sont identiques, aucun test modifié. Vérifié sur base neuve, sur copie
  de la base réelle (`integrity_check: ok`) et **sur le Pi lui-même** (Node v24.15.0/aarch64, la
  commande de déploiement compile et le module tourne). Voir `specs/better-sqlite3-upgrade.md`.
- L'option « Petit déjeuner » bénéficie désormais du choix des jours + heure dans la fiche de réservation (mécanisme générique « une fois par jour »), comme les autres options : on coche les matins concernés et l'heure, les créneaux hors présence (matin d'arrivée) sont exclus automatiquement, et la quantité/prix suit la sélection. Sa carte dédiée du Planning (café/thé/chocolat) est maintenant pilotée par ces jours cochés (au lieu d'afficher tous les matins), sans carte en double. Les réservations existantes sont migrées automatiquement pour conserver leurs cartes.
- Calendrier cumulé : les fermetures de logement commencent et se terminent désormais au milieu de la case (comme les réservations), pour un rendu cohérent des arrivées/départs et des bornes de fermeture.
- Calendrier cumulé (tableau de bord + page Calendrier) : les réservations sont désormais regroupées par logement (toutes les résas d'un logement, puis le suivant) ; les barres d'arrivée/départ commencent et finissent à la moitié du jour pour visualiser les arrivées, départs et rotations le même jour ; et les fermetures de logements y apparaissent (en gris, par logement, avec les fermetures globales « tous les logements » en haut).
- Mobile lodging calendar: swapped arrival/departure arrows so they read intuitively — arrival now points down (`↓`, guest coming in), departure points up (`↑`, guest leaving).
- Outillage de test client : `@testing-library/jest-dom` 6 → 7 et `jsdom` 25 → 30, sur vitest 4.
  Les 788 tests passent inchangés. En revanche **Vite 8 et `@vitejs/plugin-react` 6 sont écartés** :
  Vite 8 remplace esbuild par oxc comme transformeur, et ce dépôt fait tenir le JSX écrit dans des
  fichiers `.js` (convention héritée de CRA) par un bloc de config `esbuild` qu'oxc ignore — 82 des
  99 fichiers de tests cessaient de compiler. Il n'existe pas de réglage équivalent : `lang` est
  explicitement retiré des options oxc de Vite 8. C'est une migration à part entière, spécifiée dans
  `specs/vite-8-oxc-migration.md`, qui lèvera au passage l'avis de sécurité `esbuild`.
- Fiche réservation — les compléments sont désormais rangés sous le **moment où ils sont encaissés**,
  et non sous la colonne qui les stocke. Un complément d'arrivée resté à percevoir une fois le client
  arrivé (reporté au check-in ou simplement pas tranché) apparaît sous « Complément de fin de séjour »
  au lieu de rester sur la ligne d'arrivée avec un libellé modifié. Trois intitulés, identiques dans le
  résumé tarifaire et les cartes Finances : « Complément d'arrivée » (avant l'arrivée, ou encaissé au
  check-in), « Complément durant le séjour » (ex-« Encaissements en séjour ») et « Complément de fin de
  séjour ». Les totaux ne bougent pas : le découpage déplace des montants entre intitulés, il n'en
  crée ni n'en supprime aucun.
- La vue d'ensemble du Calendrier (sans logement sélectionné) affiche désormais un calendrier unique cumulant tous les logements : chaque réservation est une barre continue couvrant son séjour, empilée et colorée par plateforme, cliquable pour ouvrir la fiche — au lieu d'une mini-grille par logement. La navigation se fait par **défilement infini** (les mois s'enchaînent en scrollant, sans boutons), avec un libellé de mois épinglé et un raccourci « Aujourd'hui ». Sur **mobile**, le mois s'affiche en liste agenda lisible (une ligne par réservation : logement, client, dates, plateforme) au lieu de la grille.
- Le tableau de bord affiche désormais le même calendrier cumulé (tous logements, barres par plateforme, défilement infini) que la page Calendrier — le même composant, donc un fonctionnement identique. La case du jour est encadrée.
- **Tableau de bord : les départs avant les arrivées.** Les deux listes du jour sont inversées — on
  traite les départs le matin et les arrivées l'après-midi, la première liste est donc celle dont on a
  besoin en premier. Même ordre sur l'accueil du rôle « Accueil ». (#427)
- Complément réglé « En fin de séjour » : la fiche n'affiche plus qu'un seul « Complément de fin de
  séjour » (lignes du check-in + lignes du départ, taxe de séjour comprise), avec un total unique et un
  seul bouton « payé » qui solde les deux seaux. Les montants restent séparés en base : la compta
  conserve le routage de la taxe de séjour (46710000) et des prestations complémentaires (70600010).
- CI : **Dependabot** surveille désormais les trois manifestes npm (racine, `server/`, `client/`) plus
  les actions GitHub des workflows. Les patchs et mineures arrivent **groupés** en une PR par dossier
  et par semaine (lundi matin) ; chaque **majeure arrive seule**, parce qu'elle se valide au cas par
  cas — rupture d'API, module natif recompilé sur le Pi, outillage de test. Mis en place après
  l'incident du 2026-08-06 où un retard sur `better-sqlite3` (`^11` alors que la 13.x était publiée)
  a transformé un simple patch de Node en panne de CI, et où l'audit a révélé 8 failles « high »
  dormantes.
- **Design system « Maison » — phase 4 : Finance & comptabilité** (spec `ds-sweep-finance.md`, 2026-07-16). Tout le bloc financier passe au design system, **sans modifier aucun chiffre calculé**. Les vignettes de synthèse (Suivi financier : 5 cartes + 3 tuiles de projection ; Taxe de séjour : 3 tuiles) adoptent le style « Maison » neutre — carte claire, libellé estompé, valeur en chiffres tabulaires, fin liseré sémantique — au lieu des fonds pleins colorés. Le Suivi financier gagne une **barre d'action collante** avec un bouton « Actualiser » (premier rafraîchissement manuel de la page) et les graphiques passent aux couleurs du thème ; la Taxe de séjour passe elle aussi sur la barre canonique. Les montants s'affichent partout via `formatCurrency` (`1 234,50 €`, exact dans les tableaux/totaux) — alignés à droite en chiffres tabulaires. Le tableau des paiements opérationnels, la taxe de séjour par logement et la liste des devis deviennent des **cartes sur mobile**. Badges harmonisés : statut des devis et équilibre comptable en pastille douce `StatusBadge`, plateformes en `PlatformChip`. Plus aucun échec silencieux sur le bloc : squelettes de chargement, états vides et alertes d'erreur ré-essayables (Suivi financier, Comptabilité, Taxe de séjour, Devis, détail d'un montant) ; retours toast à la suppression / conversion / téléchargement PDF d'un devis. Les Devis passent sur le gabarit standard `DataPageScaffold`. Corrige au passage l'avertissement console React `alignItems` du sélecteur mois/année (fuite de prop MUI Stack) sur Finance et Taxe de séjour.
- **Design system « Maison » — phase 5 : Planning, Tableau de bord, Calendrier & habillage de l'app** (spec `ds-sweep-planning.md`, 2026-07-16). Le cœur opérationnel passe au design system, sans changer aucun comportement métier ni la géométrie du calendrier. Les 5 pages (Tableau de bord, Planning, Calendrier, Planning ressources, Réservations à venir) gagnent la **barre d'action collante canonique** : navigation de date / sélecteurs centrés dans la barre (bandeau compact sous la barre en mobile — et le titre de page reste désormais visible en mobile sur ces pages), « Nouvelle réservation » des ressources devient le bouton d'action de la barre, la page Calendrier absorbe son ancienne barre d'outils (mois précédent/suivant et « Aujourd'hui » en icônes). **Le Planning ne scrolle plus dans un conteneur interne** : la page défile normalement (barre toujours visible, ouverture en haut de page) et le défilement infini suit la fenêtre. Plus d'échec silencieux : états de chargement / vide / erreur ré-essayable partout — y compris les échecs de chargement des disponibilités du Calendrier (garde anti-surréservation) qui passaient sous silence — et toasts d'erreur sur tous les toggles (prêt, arrivé, parti, options, petit-déjeuner, ressources) + toasts de confirmation sur notes du calendrier et réservations de ressources. **Grand ménage des couleurs du calendrier** (~80 littéraux → tokens du thème) : cellules du calendrier, vue semaine (dont la correction du liseré « aujourd'hui » invisible — token `primary.lighter` inexistant), calendrier cumulé, mini-planners, cartes d'arrivée (puces lits neutres « Maison », alertes en teintes du thème) ; la surbrillance de sélection au drag passe au vert du thème. Les tuiles du Tableau de bord adoptent le style KPI « Maison » neutre et ses tableaux Arrivées/Départs deviennent des **cartes sur mobile** ; montants via `formatCurrency`. Le **dialog SAS** (arrivée/départ) passe entièrement aux tokens (bandeau ocre/ardoise « Maison »), aux états partagés et à la typographie de rôle (nom du client en serif, code portail en chiffres tabulaires) avec toast d'échec à l'enregistrement. La note de calendrier passe sur le `FormDialog` canonique (plein écran mobile, « Supprimer » dans le nouvel emplacement d'action secondaire). Enfin, l'habillage de l'app : bordure et fond de la barre du haut aux tokens, et le logo **GuestFlow passe au serif « Maison »**. +9 tests client, +1 smoke E2E mobile `/planning`.
- **Design system « Maison » — phase 6 : Réservations & fiches (dernière phase)** (spec `ds-sweep-reservations.md`, 2026-07-16). Le dernier bloc — fiches réservation/logement/client, saisons tarifaires, vacances/fermetures, écrans de connexion — passe au design system : **toute l'application est désormais uniformisée**. Sans modifier aucun calcul de prix ni règle de validation. La fiche **Logement** (la page la plus bricolée) adopte la barre d'action canonique : le nom du logement devient le **premier champ du formulaire**, la barre affiche un titre serif et porte Enregistrer / Annuler / Supprimer ; surtout, **les erreurs d'enregistrement et de suppression s'affichent enfin** (en toast) au lieu d'être silencieusement rangées dans le champ photo. La fiche **Réservation** gagne un bouton Enregistrer qui se désactive et affiche un spinner pendant la sauvegarde, des états de chargement/erreur/historique propres, et l'historique en date+heure formatée. **Pastilles harmonisées partout** : statut des devis et cohérence des paiements en `StatusBadge`, plateformes en `PlatformChip` (adoption jusque-là nulle). **Montants via `formatCurrency`** sur les fiches client, le résumé tarifaire, les sections Finance et Options (fini les `26.00€` → `26,00 €`). Listes et tableaux passent aux `TableCard`/`DataPageScaffold` avec états chargement/vide/erreur ré-essayables (Clients, Logements, Saisons, Vacances, Fermetures) ; la liste des clients devient des **cartes sur mobile** ; les dialogues (suppression client, éditeur de saison, application inter-logements) passent en `FormDialog` plein écran sur mobile. Les écrans **Connexion** et **mot de passe forcé** reçoivent le titre serif « Maison ». Corrige au passage l'avertissement console `alignItems` de la section Finance. +2 tests client (états Clients), +1 smoke E2E (fiche Logement).
- **Design system « Maison » — phase 3: Réglages & admin sweep** (spec `ds-sweep-settings.md`, 2026-07-15). First block brought fully onto the design system: every page action now lives in the sticky top bar (Tarifs facturables gains a real bar-level save replacing its two in-content buttons; Emails' hand-rolled header becomes the canonical bar; « Ajouter un compte » and « Rafraîchir la liste » move up too). The tab pages (Options & ressources, Vacances & fermetures) lose their stacked double header — the tabs render centered inside the single bar (slim strip on mobile). No more silent failures on the block: loading skeletons, empty states and retryable error alerts everywhere (Emails, Options/Ressources, Comptes, Tarifs); unsaved-changes guards added to Paiements, Plan comptable and Tarifs. Options/Ressources and Modèles d'emails render as cards on mobile; prices are right-aligned tabular `formatCurrency` with « — » for empty cells; all section headings switch to the serif style; last stray colors/spacings tokenized. Fixes the long-standing React `alignItems` console error on `/settings` (MUI 9 Stack prop leak in LogoUpload). +4 client tests, +1 mobile E2E smoke.
- **Design system « Maison » — phase 1: theme & foundations** (specs `design-system.md` + `ds-theme-maison.md`, 2026-07-06). New app-wide visual identity: fir-green primary, warm paper background, serif page titles (Source Serif 4), radius 14, warm shadows; typography role variants (`pageTitle`/`sectionHeader`/`kpiValue`/`kpiLabel`) in the theme. Fonts are now self-hosted (no more Google Fonts CDN — the app renders offline). Pages always open scrolled to the top (ScrollToTop on route change). Money/date display centralized in `utils/formatters.js` (`formatCurrency` → `1 234,50 €` everywhere). Fixes: school-zone colors unified (two conflicting maps), 18 stale `#1976d2` blues replaced with theme tokens, devis-conversion errors display again (alert-API bug), 4 dead components removed. New admin-only `/design` page: living showcase of tokens, type roles and formats. +14 client tests.
- Documented email deliverability setup (SPF / DKIM / DMARC on the Google Workspace sending domain) in the README, fixing Yahoo/Gmail `550 5.7.9` rejections caused by unsigned mail (DKIM never enabled in DNS).
- L'historique des emails ne liste désormais que les envois des **séjours en cours et à venir** (jusqu'à 3 jours après l'arrivée) et devient accessible depuis le menu (**Emails → Historique**). Les envois plus anciens sont automatiquement retirés.
- La langue des emails se choisit désormais sur la **fiche client** (et non plus sur la réservation) : toutes les communications de ce client suivent cette langue. Les emails en anglais affichent aussi les **noms d'options et de ressources en anglais** (repli sur le français si la traduction est absente).
- Les emails de rappel J-7 et J-2 rappellent désormais le **numéro de réservation** dans le récapitulatif du séjour.
- Serveur : montée d'**express 4 → 5**, dernière majeure en retard. Aucune route ni aucun contrôleur
  n'a été touché : l'analyse d'impact préalable a montré qu'aucune des sept ruptures documentées
  (mutation de `req.query`, wildcards de routes, `res.send(status)`, `app.del`, `req.param`,
  `res.sendfile`, `redirect('back')`) n'existait dans le dépôt. 2364 tests serveur et 45 E2E verts,
  inchangés.
- Serveur : **nouveau middleware d'erreur global**, ajouté avec express 5. La v5 achemine désormais le
  rejet d'une promesse d'un handler asynchrone vers ce middleware, là où la v4 le laissait s'échapper
  en `unhandledRejection` — **la requête restait alors suspendue, sans réponse**. Le client reçoit un
  500 JSON stable ; le détail (chemin de fichier, fragment SQL, jeton) est journalisé côté serveur et
  **jamais renvoyé**. Une erreur portant un `status` valide le conserve. 5 tests dédiés.
  Voir `specs/express-5-upgrade.md`.
- Fiche réservation (résumé tarifaire) : le bas du résumé est désormais une cascade de sous-totaux. « Total du séjour » = le brut (hébergement + toutes options/ressources + taxe). Pour une réservation plateforme : − taxe de séjour gérée par la plateforme, − compléments perçus sur place → « Montant soumis à commission », − commission → « Versement plateforme », + compléments → « Total perçu sur le séjour » (ce que vous gagnez). La taxe collectée + reversée à la commune par la plateforme porte un tag « Plateforme » (au lieu d'être barrée).
- Fiche réservation (résumé tarifaire) : « Total du séjour TTC » correspond désormais au montant net perçu + les compléments (net de la commission plateforme), calculé par le moteur. Le complément à percevoir est remonté juste après la taxe de séjour ; une ligne « Montant soumis à commission » (= montant total payé par le client) apparaît sous le total ; « Net perçu TTC » est renommé « Versement Plateforme ». Compta et HT/TVA inchangés.
- **Suivi financier rattaché à la date d'encaissement** (spec `fiscal-year-and-nights-sold.md` §3.2, 2026-08-12). Un séjour était jusqu'ici compté dans la période de son **départ** ; il l'est désormais dans celle de l'**encaissement de son solde** (à défaut — solde impayé, ou séjour sans solde — sa date de départ fait foi), la comptabilité étant tenue à l'encaissement. La règle s'applique aux cartes exercice et période, au graphique, au tableau « Réservations période », à la projection et aux détails. **Les montants affichés changent** : une résa de juillet soldée en mai remonte en mai. Le « Suivi opérationnel » (retards, paiements en attente, réservations à venir) reste sur les dates réelles du séjour.
- Suivi financier : les montants « total de séjour » (Revenu total, En attente, Revenus par logement, cartes annuelles, projection, colonnes « Total de séjour » des tableaux Suivi opérationnel) affichent désormais le « total perçu » — net de la commission plateforme (et toujours hors compléments réglés en caisse interne). La carte « Encaissé » est elle aussi nette de la commission de chaque échéance encaissée. La comptabilité reste inchangée (CA brut + commission en charge séparée).
- Finance « Vue générale »: each top card now shows its **HT amount** in smaller text (computed server-side element by element — accommodation/options/resources ÷ TVA, taxe de séjour excluded as it bears no VAT); the « Répartition » pie prints the amounts **inside the slices** and the « Revenus par logement » bars print the **amount inside each bar**; the « Projection à une date » table moved to the **bottom of the page**; and every « Suivi opérationnel » table (retard / attente / à venir / période) plus the projection table now ends with a **column-totals footer**. The cards are more compact with the TTC amount centered (the HT right-aligned), the **« Paiements en retard » tab is hidden when nothing is overdue**, the **« Paiements en attente » list shows a discreet box with the total still awaiting payment** (and « Réservations à venir » a sibling box with the Σ total de séjour to come), the two charts share the **same height**, and the **« Projection à une date » section is a collapsible accordion folded by default**.
- Finance « Vue générale » rebuilt around the **« total de séjour »** (acompte + solde + complément + complément de fin de séjour, the complements excluded when settled via caisse interne), every figure counted by the reservation's **departure date**: two new annual cards (revenus depuis le début de l'année + revenu total sur l'année), « Revenu total » / « Encaissé » / « En attente » redefined on that basis, « Revenus par logement » as a single total-de-séjour bar per logement, « Répartition » as encaissé vs en attente, and the projection date now defaults to today + 1 month.
- Finance « Suivi opérationnel »: « Paiements en retard » lists direct bookings only (platforms collect their own payments); « Paiements en attente » shows past-and-unsettled reservations with their total de séjour, a per-row « Tout solder » action, and no more caution column; a caisse-interne complement now marks a reservation fully settled. The « Réservations à venir » list shows the four payment components then the total de séjour pinned right with its paid indicator, and every row click opens the reservation fiche.
- Finance « Vue générale » → onglet « Réservations à venir » : la liste est désormais une suite de **cartes identiques à celles du Planning** (cartes d'arrivée : logement, plateforme, famille, lits, options, complément/caution à percevoir, bouton check-in SAS, etc.), au lieu d'un tableau. Même ensemble de réservations extraites ; le total « Total de séjour à venir » est conservé.
- Suivi financier → Suivi opérationnel : l'onglet « Réservations à venir » est désormais présenté comme le tableau de « Paiements en attente » (Acompte, Solde, Complément, Reste à payer, Total de séjour) — en lecture seule et sans la colonne « Compl. fin de séjour » — avec un bandeau « En attente de paiement » (Σ reste à payer).
- L'onglet « Réservations période » affiche la période (du/au) dans un bandeau en haut à droite du tableau.
- Suivi financier : la carte « Revenus » précise désormais sa borne haute — « depuis le début de l'exercice **jusqu'à aujourd'hui** » — pour la distinguer de « Revenu total sur l'exercice », qui inclut les séjours à venir.
- Logements : la page « Gérer les saisons » est renommée **« Gestion tarifaire »** (bouton + titre de page), et la carte **« Prix plateformes »** y est désormais affichée **en dernier** (sous les saisons de chaque année).
- **Recherche de réservation dans la barre supérieure** (spec `reservation-number-and-search.md`, 2026-06-19). La boîte de recherche (n° / nom / prénom) quitte le Tableau de bord et le Calendrier pour **l'en-tête global**, à côté du logo « GuestFlow » : elle est désormais accessible **depuis toutes les pages**. Sur ordinateur le champ est visible en permanence ; sur mobile, une **icône loupe** déploie un champ pleine largeur (avec une croix pour le refermer). Les deux anciennes boîtes (Dashboard, Calendrier), devenues redondantes, sont retirées.
- Google Calendar sync: synced reservation events no longer carry the calendar's default reminder (no more "10 minutes before" popup). Existing events are opted out at the next reconcile.
- Google Calendar sync reworked end-to-end (specs/google-calendar-oauth-rework.md): the service-account credentials (3 manual fields) are replaced by a one-click Google OAuth connection ("Connecter mon compte Google") with a calendar picker — private calendars now work without any sharing setup. Reservations push immediately on create/update/delete (manual, devis conversion, iCal import/approvals), a reconcile pass runs every 15 min (diff-push + orphan purge, deletions finally propagate), and Settings gains "Synchroniser maintenant" / "Tester la connexion" / "Déconnecter". Events get a per-property color and a valid deterministic id (`gfres<id>` — the old `guestflow-r<id>` scheme was rejected by the Google API, so event creation never actually worked). `POST /api/google-calendar/sync-reservations` and the `googleCalendar` group of `GET/PUT /api/settings` are removed in favor of dedicated `/api/google-calendar/*` endpoints.
- README : la section « Configuring Google Calendar Integration » devient la procédure complète validée en production (2026-07-21) — pièges signalés (API et client OAuth dans le même projet, type « Application Web » obligatoire, secret affiché une seule fois, URL publique = origine sans chemin) + table de dépannage symptôme → cause → remède.
- **Calendrier cumulé : les réservations passées sont grisées.** Sur le « Calendrier cumulé » (Dashboard + page Calendrier), les réservations (et fermetures) dont le séjour est terminé (date de départ avant aujourd'hui) s'affichent désormais en grisé (opacité réduite), en agenda mobile **et** en grille desktop. Purement visuel — même langage que le calendrier par logement qui grise déjà les jours passés.
- iCal import: a client created automatically by a sync no longer gets the "créé automatiquement lors de l'import iCal" mention in its note — the field stays empty for the operator's own text.
- iCal : les réservations importées arrivent désormais avec une note vide (plus de bloc « Import iCal / UID / Résumé » parasite), et une synchronisation ne réécrit plus la note — celle que vous saisissez à la main est conservée.
- **J-1 reminder — linen-by-default properties** (spec `j1-linen-default-message.md`, 2026-06-12). For properties that include bed linen by default (« Linge de lit » set as a default-offered option), the J-1 email now reassures *« Pour votre confort, les lits seront faits à votre arrivée. »* and drops « Linge de lit » from the options list (hidden entirely if it was the only one). The list label is renamed **« Options réservées » → « Option(s) réservée(s) »** (new `{{reservedOptionsList}}` / `hasReservedOptions` / `bedLinenProvidedByDefault` / `bedLinenBringYourOwn` tokens + flags; `{{optionsList}}` and other templates unchanged). The seeded J-1 body is upgraded in place on existing installs (operator edits preserved). +8 server tests.
- Mail « Rappel arrivée — J-2 » : quand un complément d'arrivée est dû, la ligne décrit désormais à quoi il correspond exactement comme le SAS d'arrivée (options + ressources + taxe de séjour perçue à l'arrivée + reste éventuel), la liste couvrant toujours le montant total — au lieu d'une description partielle qui pouvait laisser un montant sans détail.
- Mail « Rappel arrivée — J-2 » (FR + EN) : ajout d'une ligne indiquant que la cafetière du logement est
  une machine à capsules (type Nespresso), et le complément à régler à l'arrivée est désormais présenté
  en liste détaillée comme le récapitulatif du SAS check-in (une ligne par prestation « libellé : qté ×
  prix = total » + un Total), avec le libellé anglais de la taxe corrigé (« Tourist tax »).
  (specs/j2-email-coffee-and-sas-complement.md)
- **Dashboard — alerte stock blanchisserie plus claire.** Le titre indique désormais la **date de la première rupture** (date actionnable) au lieu de l'horizon de projection (la date de départ de la dernière réservation, qui pouvait afficher une date lointaine sans rapport). Chaque ligne nomme explicitement le type de linge concerné : « Drap double : jusqu'à 2 manquants · première rupture le 13/06/2026 ».
- Consolidated the database bootstrap: the full schema now lives in `server/src/schema.sql` (single source of truth, reproduces production exactly) and is executed first; the ~212 legacy `ALTER TABLE` schema-migrations + the base `CREATE TABLE` block were removed (`database.js` 2185 → 1246 lines). Fresh installs/CI/dev-resets now build the exact production schema directly; seeds and existing databases are unaffected.
- Dépendances : lot de mises à jour mineures et correctives sur les trois paquets — MUI 9.0.1 → 9.3.1
  (`material`, `icons-material`, `x-date-pickers` 9.4 → 9.11), React 19.2.7 → 19.2.8, Recharts
  3.8 → 3.10, les polices Fontsource, `@testing-library/user-event`, côté serveur `helmet`,
  `express-rate-limit` et `pdfkit` 0.18 → 0.19, et `@playwright/test` 1.60 → 1.62 à la racine.
  Aucun changement fonctionnel : les trois suites passent inchangées. Les deux montées visibles par
  l'utilisateur ont été contrôlées à l'œil, parce que les tests ne les rendent pas — un devis PDF
  généré et relu page à page (bandeau, tableau tarifaire avec ligne « offerte » barrée, coordonnées
  bancaires, modalités de règlement) et quatre écrans denses de l'application, sans erreur console.
- Calendrier cumulatif sur mobile : les réservations de l'agenda sont désormais **rangées par ordre d'arrivée** (date de check-in croissante), au lieu d'être groupées par logement.
- **Aucun email de paiement n'est envoyé automatiquement** (spec `payment-schedule-and-cancellation.md`
  §1 amendement du 2026-08-20). Les quatre emails d'argent — demande d'acompte, relance acompte,
  demande de solde, relance solde — sont désormais *proposés* par GuestFlow et *envoyés* par
  l'opérateur. La demande d'acompte ne part plus toute seule à la création d'une réservation et la
  passe quotidienne de demande de solde est supprimée ; les deux relances passent en mode manuel et
  attendent dans la file d'emails, où leur corps rendu peut être relu avant l'envoi. Les emails de
  séjour (rappels d'arrivée, SAS, petit-déjeuner) gardent leur envoi automatique : la règle porte sur
  l'argent, pas sur l'email. L'annulation d'un séjour restait déjà, et reste, une confirmation
  manuelle. Un test verrouille la règle : aucun modèle qui réclame de l'argent ne peut être livré en
  mode automatique.
- **Carte « Échéances de paiement » — deux nouveaux états.** Puisque plus rien ne réclame à la place
  de l'opérateur, la carte devient la liste des choses à faire : « Acompte à demander » apparaît dès
  la création d'une réservation directe, « Solde à demander » le jour de l'échéance du solde. Le
  bouton s'appelle « Envoyer la demande » tant que le client n'a jamais été sollicité, « Relancer »
  ensuite, et le titre de la carte compte les deux catégories séparément. Un séjour n'est plus jamais
  proposé à l'annulation pour un solde qui n'a jamais été réclamé.
- Notification de nouvelle réservation (iCal) : le push affiche désormais les dates du séjour et le nombre de nuits (« — du JJ/MM/AAAA au JJ/MM/AAAA · N nuit(s) »), et l'email correspondant ajoute le nombre de nuits à sa ligne « Séjour ».
- « Petit déjeuner » est rangé dans la catégorie **Restauration**, mais reste affiché sur la fiche
  réservation et sur le site même quand le menu est replié et qu'il n'est pas sélectionné.
- Nouvelle case **« Toujours visible »** dans Paramètres → Options (visible dès qu'une catégorie est
  renseignée) : elle épingle l'option hors du repli de sa catégorie. L'option reste affichée sans
  compter comme sélectionnée — le compteur de l'en-tête ne compte que ce qui est réellement facturé.
- Fiche réservation : une option **incluse par défaut sur le logement et paramétrée « offerte »** s'affiche désormais comme **« Comprise »** (« incluse dans le tarif ») à **0,00 €**, au lieu de « Offert » avec le prix barré — pour bien montrer qu'elle est comprise dans le prix de la nuit. Une option offerte ponctuellement (geste commercial) garde « ✓ Offert ».
- Le champ « Prix » d'une option s'incrémente désormais par pas de 0,50 € (flèches haut/bas).
- **Portée des options par logement explicite.** Dans une option, « Tous les logements » est désormais un choix sélectionnable du menu (il coche tous les logements et reste exclusif). Surtout, **ne sélectionner aucun logement rend l'option indisponible partout** (elle n'apparaît plus dans aucune réservation) — l'ancienne règle « aucun = tous » est supprimée. Les options existantes en « Tous les logements » sont migrées automatiquement (liées à tous les logements actuels) pour conserver leur disponibilité.
- Supprimer une option l'**archive** au lieu de la supprimer : elle disparaît de Réglages → Options et n'est plus proposée pour les nouvelles réservations (ni en option par défaut d'un logement), mais les réservations qui l'utilisent déjà la conservent (visible sur la fiche, le PDF, la compta ; préservée à la ré-édition). Les options automatiques (petit-déjeuner, linge, ménage) restent non supprimables.
- Refactored the payment-request orchestration (create/reuse a Qonto link + email it) into an injectable `paymentRequestService`, with full unit-test coverage of the link reuse, amount/type validation and error-to-HTTP mapping. No change to the API contract.
- **Taxe de séjour par plateforme : 3 modes au lieu de 2** (spec `per-platform-tourist-tax-three-way.md`, 2026-06-19). Dans **Logements → Plateformes & iCal**, le réglage « Taxe de séjour » de chaque plateforme passe d'un interrupteur binaire à un sélecteur à trois choix : **« Plateforme → commune »** (la plateforme collecte la taxe au client et la reverse elle-même à la commune — absente du Suivi taxe de séjour, inchangé par rapport à l'ancien « Plateforme »), **« Plateforme → vous »** (la plateforme collecte la taxe puis **vous la reverse** au règlement : vous la reversez à la commune → elle apparaît désormais dans le **Suivi taxe de séjour** et sur la ligne de passage **46710000** de la comptabilité, portée par le versement de la plateforme), et **« À l'arrivée »** (vous la percevez au check-in → complément + SAS, inchangé). Le devis du client est identique entre les deux modes « Plateforme » (taxe offerte) ; seule la prise en charge du reversement change. Le récapitulatif du **SAS d'arrivée** détaille désormais la taxe de séjour à percevoir sur sa propre ligne « Taxe de séjour : X € ».
- Planning : les deux boutons des cartes (arrivée/départ) utilisent de nouvelles icônes — Document pour ouvrir la réservation, Check-list pour ouvrir le SAS (✓ quand le SAS est déjà fait). Sur mobile, ils passent sur une ligne dédiée en bas de la carte (alignés à droite) pour ne plus déborder quand le badge « Prêt » / « Effectué » est affiché.
- **Planning arrival cards** (spec `planning-arrival-alerts.md`): the **« Complément à percevoir »** badge is now **red** (it's money the host must collect on arrival, so it stands out), and the **« Caution à percevoir »** badge is **orange** (a refundable hold) — the two were swapped. The **platform badge** beside the property name is enlarged (14px bold, 1.5px border) for legibility.
- Planning : cliquer sur une carte d'arrivée ou de départ ouvre désormais la fiche de réservation (comme les autres cartes). Le logo de check-in/check-out (SAS) est nettement agrandi pour être plus facile à toucher sur mobile, et l'ancienne petite icône « ouvrir la fiche » est supprimée.
- **Planning:** each day's cards (arrivals, departures, meals/options, breakfast, resource sessions, resource bookings) are now interleaved into a single stream ordered by time — an arrival at 10:00 shows before a meal at 19:00. Cards without a set time (laundry, undated options) sort to the bottom of the day.
- **Planning : le compteur du jour compte toutes les tâches.** La pastille `0/1` de chaque journée ne
  comptait que les arrivées : une journée faite de départs et d'un bain nordique à préparer affichait
  « 0/0 » et ne passait jamais au vert. Elle compte désormais les arrivées, les départs et les séances
  de ressource à préparer. (#15)
- Planning arrival cards now show the booking **platform** as a small rounded badge (transparent background, border and text in the platform's brand colour) to the right of the property name.
- Réservations plateforme : les extras (options, options personnalisées, ressources) restent **placés en paiement complémentaire par défaut**, mais le bouton « Compl. » est désormais disponible par ligne pour les **retirer du complémentaire** si besoin. Les options automatiques (early/late check-in/out) restent gérées par l'algorithme.
- **Grille « Prix plateformes »** : une ligne par canal (Direct en tête, dont le prix couvre le coût du pack accueil après les frais du moteur de réservation), prix arrondis à l'euro supérieur — c'est un prix à saisir sur un canal, pas un montant facturé — et nouvelle colonne « Personne supp. ». La cible nette de chaque saison peut désormais différer du prix facturé.
- **Base de la taxe de séjour** : les prestations comprises dans le tarif (ménage, linge, pack accueil — options marquées « Comprise ») sont déduites de la base déclarée en mode pourcentage. La vente, les échéances, la TVA et la comptabilité sont inchangées. Un geste commercial ponctuel (« Offert ») n'est pas déduit.
- **Dégressivité au-delà du dernier palier saisi** : le dernier palier configuré se prolonge sur les nuits suivantes, au lieu de retomber sur l'ancien modèle hebdomadaire sans rapport avec la courbe configurée.
- **Fix** : ouvrir puis annuler une saison en mode Dégressif ne demande plus de confirmer l'abandon des modifications alors que la page n'a été que consultée. Les paliers sont stockés normalisés sur 365 nuits mais prévisualisés sur 14, et cette normalisation était comptée comme une modification de l'utilisateur.
- **« Plateformes & iCal » — refonte de la liste plateforme/iCal du logement** (spec `platforms-and-ical-rework.md`, 2026-06-19). La section « Connexions iCal » de la fiche logement devient **« Plateformes & iCal »** : elle liste **toutes les plateformes** (intégrées ∪ ajoutées, dont `direct`), chacune avec une **couleur globale** modifiable via une pastille → palette (recolore les réservations de cette plateforme sur le calendrier partout), une **URL iCal optionnelle** (vide = saisie manuelle, pas de synchro), un **bouton « Taxe collectée »** (activé = la plateforme collecte, désactivé = vous), et l'**état de synchro affiché seulement si une URL est renseignée**. Édition **en ligne** par ligne : l'URL passe sur sa propre ligne pleine largeur (plus haute) pour la voir presque entièrement, et en lecture seule l'URL est tronquée pour n'afficher que sa fin. Le **nom** est une pastille colorée (sa couleur calendrier) cliquable pour ouvrir la palette. L'**état de synchro** est affiché de façon visuelle : une icône + un nombre par catégorie (créé / mis à jour / annulation / verrouillé / inchangé / ignoré), info-bulle au survol. Un bouton **« Désactiver »** masque les réservations de cette plateforme des vues de ce logement (texte grisé ; réservations conservées, la disponibilité reste bloquée — pas de surréservation). Les plateformes **par défaut** ne sont pas supprimables (seules les plateformes ajoutées le sont). Nouveau composant générique `PlatformColorPicker`. +13 tests serveur, +3 tests client.
- **Le plugin WordPress est déployé automatiquement à chaque release** (CI `deploy.yml`). Le plugin `integrations/wordpress/guestflow-booking` tourne dans le conteneur Docker `wp_app` du Pi et devait être recopié à la main (`docker cp`) après chaque changement — source récurrente de désynchronisation entre le site et l'API. La CI de release le synchronise désormais dans le conteneur (flux `tar`, remplacement atomique gérant aussi les fichiers supprimés + `chown www-data`). Le cache navigateur des assets est busté automatiquement par le **mtime** de chaque fichier (`class-gf-blocks.php`), sans bump de version du plugin.
- Page « Gestion tarifaire » : le planning annuel est désormais affiché en premier, au-dessus de la recette tarifaire et du tableau des saisons.
- **Capacité des logements — un seul total au lieu de trois plafonds** (spec `property-capacity-single-total.md`, 2026-08-14). Un logement déclare désormais `Max voyageurs` (adultes + ados + enfants de plus de 2 ans) et `Max bébés` (0-2 ans, hors capacité), au lieu de `Max adultes` / `Max enfants` / `Max bébés` dont la **somme** faisait la capacité totale. N'importe quelle répartition par âge sous le total passe : sur l'Aventura lodge, « 1 adulte + 1 enfant » était refusé côté back-office (capacité forcée) et **rejeté en 409 sur le site public** parce que `Max enfants` valait 0. La règle vit dans une seule fonction serveur (`utils/capacity.js`) partagée par la fiche et l'API publique. Aucune réservation existante n'est revalidée : la capacité n'est contrôlée que si l'occupation change. Côté site : la carte logement n'annonce plus la somme des trois plafonds (21 personnes pour le gîte !) mais le vrai total, et le widget de réservation plafonne ses compteurs pour ne plus produire de demande refusée à l'envoi. +14 tests serveur, +4 tests client.
- **Fiche logement** : les 4 cartes du haut sont rééquilibrées pour mieux occuper l'écran. « Acompte & Solde » passe en haut de la colonne de droite, « Horaires & Ménage » sous « Informations » à gauche (les deux colonnes finissent à la même hauteur), et les champs se regroupent par 3 sur une ligne au lieu de s'empiler. Les deux colonnes n'apparaissent qu'à partir des grands écrans (`lg`) — en dessous, la page reste sur une seule colonne pleine largeur, et tout s'empile sur mobile.
- **Public API: automated security tests for the controller flows** (spec `public-api.md`, 2026-06-09). The public quote + booking-request controllers — previously covered only by manual `curl` checks — now have unit tests pinning the security-critical orchestration: honeypot persists nothing; a booking request creates a **draft devis** (never a confirmed reservation), marked `requestOrigin='public'`; **price-override / non-whitelisted body fields never reach the engine or the persisted record**; `platform` is hard-set to `direct`; options are re-sanitised; blocked-dates / min-nights / over-capacity → 409; unknown property → 404; bad guest → 422; existing clients are reused. +12 tests (34 total across the public API: auth, anti-leak projections, validation, quote, booking). No app behavior change.
- **Public API — HTTP integration test for the router wiring + rate limiters** (spec `public-api.md`). Added `tests/public-api-http-integration.test.js`: it mounts the real `/public/v1` router with the real middleware (API-key guard + rate limiters) and drives it over a real TCP socket (only the leaf controllers are stubbed). It proves what the unit tests can't — every route (reads and writes) is fail-closed without the key (401 + uniform envelope), Bearer and X-API-Key both authenticate, the broad `publicApiLimiter` returns 429 past its window, and the stricter `bookingRequestLimiter` throttles a 3rd booking (429) without affecting plain reads. The rate-limiting line in the spec test plan flips from unverified to covered. +5 server tests. Test-only — no app behavior change.
- **Public API hardened to strict read-only + zero price control** (spec `public-api.md`). The public API can now write **only** when posting a booking request — every other endpoint is provably side-effect-free: `GET /public/v1/properties/:id` no longer seeds default timed options (it uses a new pure-SELECT `propertiesModel.getByIdPublicReadOnly` instead of the seeding `getByIdWithDetails`), so a public GET triggers zero DB writes. Pricing is locked down: the public boundary accepts **only** the engine's pricing inputs (dates, guest counts, `optionId`+`quantity`) and can never set, adjust, discount, offer, or platform-price anything — `customPrice`/`discountPercent`/`platform`/`clientGrossAmount`/`depositAmount`/`offeredOptionIds`/per-option `offered`/`free`/`unitPrice`/`price` and any `selectedResources` are stripped before the engine and before persistence. +3 server tests (read-only GET guarantee ×2, full price-immutability sweep ×1).
- Public options and resources (`GET /public/v1/properties/:id/options` and `/resources`) are now returned **cheapest-first** (by price ascending).
- **Public online-payment hardening** (spec `public-online-payment.md`, 2026-07-02 security audit). The public `pay`/`status` routes now require an unguessable **per-devis capability token** (returned by the booking-request create, echoed by the WordPress plugin) so the sequential devis id can no longer be enumerated to read another booking's recap or mint its payment link; `GET /status` gets a dedicated tighter rate limiter (Qonto-quota/cost DoS guard); `trust proxy` now defaults to **off** (env `TRUST_PROXY_HOPS` when a reverse proxy fronts the app) so a direct caller can't spoof `X-Forwarded-For`; a reused payment link is re-minted if its amount drifted from an edited devis. +6 server tests.
- Notifications push : un clic sur la notification d'**arrivée** ou de **départ** ouvre désormais directement le **SAS** correspondant (au lieu de la fiche réservation). La notification de **nouvelle réservation** ouvre la réservation concernée (une notification par réservation). Toutes les notifications affichent le **nom du voyageur + le logement**.
- Paramètres → Générale → Notifications push : le bouton « Envoyer une notification de test » adopte le même format que « Envoyer un mail de test » (bouton + légende explicative) et reste toujours visible dans la section, désactivé tant que les notifications ne sont pas activées sur l'appareil.
- **Connexion provider Qonto : le téléphone accepte le format national** (spec `online-payments-qonto.md` §3.2, 2026-06-29). Le formulaire de connexion du provider de liens de paiement exige un numéro E.164 ; on peut désormais saisir un numéro **national français** (`06 28 05 60 66` / `0628056066` / `0033…`) — normalisé en `+33…` côté client (le bouton s'active) **et** côté serveur (valeur envoyée à Qonto en E.164). Un numéro réellement invalide reste rejeté. +1 test serveur.
- Rôle « Accueil » : seuls les SAS **du jour** sont modifiables. Un check-in / check-out **passé**,
  **à venir** ou **déjà validé** est inerte dans l'interface (✓ grisé + info-bulle expliquant
  pourquoi) et refusé par le serveur (403 `SAS_LOCKED` avec le motif) avant la moindre écriture. Les
  cases « Prêt » / « Arrivé » / « Parti » suivent la même fenêtre (403 `STATUS_LOCKED`). La fenêtre
  court du jour concerné 00h00 au lendemain 04h00, pour couvrir les arrivées tardives et les départs
  matinaux. L'administrateur conserve la ré-édition complète, quelle que soit la date.
- Fiche réservation : le champ **« Prix payé par le client »** a été retiré (redondant maintenant que la commission plateforme est saisie directement). La **comptabilité** d'une réservation plateforme enregistre désormais le **CA sur le total du séjour** (avec la TVA des réglages), la **commission** saisie dans la fiche en charge, et le **net perçu** (= solde = total − commission). Les réservations déjà enregistrées (avec un brut stocké) conservent leur calcul d'origine.
- Comptabilité — partie plateformes : le tableau et les cartes du journal affichent désormais **Revenu brut / Commission / Net perçu (versement)**, pour qu'on retrouve directement le **montant réellement viré** par la plateforme. (Avant, la commission tombait à ~0 € et le versement n'apparaissait nulle part — corrigé par le recâblage ci-dessus.)
- Les « options ajoutées par défaut » d'un logement sont renommées « Options incluses » (interrupteur « Inclure ») ; sur la fiche réservation, le libellé « Inclus par défaut » devient « Inclus ». Comportement inchangé : activer une option incluse n'impacte que les nouvelles réservations (les réservations déjà créées ne sont pas modifiées).
- Fiche de réservation : le bouton **« Nouvelle note »** est remonté dans la **barre d'actions
  collante**, en tête. Il n'existait que dans le bloc « Encaissements en séjour », situé à 81 % du
  défilement d'une fiche de 4500 px — introuvable pour ce qui est l'action la plus fréquente d'un
  séjour en cours. Le bloc et son historique restent en place ; les deux points d'entrée partagent la
  même règle d'affichage (`utils/midStayNoteAccess.js`, 9 tests) pour ne jamais diverger.
- Fiche de réservation : sur une réservation **plateforme**, les boutons **« Transformer en devis »**
  et **« Envoyer la demande de solde »** disparaissent. Le premier n'a pas de sens — le tarif vient de
  la plateforme, nous ne devisons pas ce séjour ; le second était dangereux — le solde est encaissé
  par la plateforme puis reversé, le réclamer au client aurait été une double demande de paiement.
  Les réservations directes ne changent pas.
- **Fiche réservation : nom du client + numéro au centre du bandeau** (2026-06-20). Le bandeau d'actions de la fiche affiche désormais, **centrés**, le **nom du client** et le **numéro de réservation** (entre le titre à gauche et les actions à droite). Sur **mobile (xs)** où la barre est trop étroite, ils sont **masqués**. Réalisé via un nouveau slot `center` du composant partagé `PageActionBar` (rétro-compatible : les autres pages sont inchangées).
- On the reservation page, when a client is attached, « Changer le client » and « + créer un nouveau client » now sit on the same line under the client name.
- **Reservation page — client section reworked** (spec `reservation-client-inline-edit.md`). The client dropdown is replaced by the attached client's **name in bold, clickable to edit its fiche** (same dialog as creation, saved via `PUT /api/clients/:id`). A discreet « Changer le client » link reveals the search to attach a different existing client (no forced duplicates), and « + créer un nouveau client » stays below. A fresh reservation shows the search directly.
- Fiche de réservation : le nom du client est mis en valeur dans un cadre coloré, et le logement et le numéro de réservation s'affichent sur la même ligne sur écran large.
- Réservations — « Historique des modifications » : chaque entrée n'affiche plus que ce qui a
  réellement changé, ancienne valeur puis nouvelle. Les options et ressources sont comparées ligne
  par ligne (ajoutée `+`, supprimée `−`, modifiée `→`) au lieu d'afficher la liste complète avant et
  après ; les ids sont résolus en noms (logement, client, option, ressource), les montants en €, les
  dates en JJ/MM/AAAA et les booléens en Oui/Non. Les montants recalculés par le moteur de prix
  (prix hébergement, taxe de séjour, prix final, acompte, solde) sont regroupés dans un bloc
  « Recalculs » sous les modifications. S'applique rétroactivement aux entrées déjà enregistrées.
- Reservation history now shows option/resource **names** and formatted amounts instead of raw ids (e.g. `Petit-déjeuner : 8 € (compl.)` instead of `6:1:8.00:c1`), one readable line per changed field.
- Le numéro de réservation auto-généré n'a plus de tirets : format `AAAAMM###` (ex. `202606001`) au lieu de `2026-06-001`.
- Réservations : une réservation déjà créée est désormais **figée** vis-à-vis de la configuration des options. Modifier une option (prix, archivage, passage en/hors « inclus », renommage) n'affecte plus aucune réservation existante — montants, options et soldes restent ceux d'origine. Les options incluses par défaut d'un logement ne s'appliquent qu'aux **nouvelles** réservations (le libellé affiché d'une option renommée suit, sans changer les montants). Spec `reservation-option-immutability.md`. +4 tests serveur, +1 test client.
- Reservation search bar now also matches by client email, in addition to number, first name and last name.
- Bain nordique (ressource horaire) — finitions de bout en bout : dans la fiche, le bouton « Compl. » et le montant sont placés comme pour les options ; choisir l'heure de début règle automatiquement la fin à +1h et la liste des heures de fin grise les créneaux avant début+1h. Les séances réservées apparaissent désormais aussi dans Calendrier → Ressources (en plus du Planning), cliquables vers la fiche.
- **`npm test` at the repo root now runs the server + client suites** (`test:server && test:client`), with `test:server` / `test:client` shortcuts. As part of this, the server test runner is pinned to `--test-concurrency=1` (serial), which makes the suite **deterministic** — it previously ran files concurrently against the shared prod-DB module + global stubs, producing intermittent, varying failures (and an unstable test count). Serial is ~13s and now reports a stable 1261/1261. Dev-tooling only; no app behavior change.
- SAS check-in — the bath-linen upsell no longer asks how to settle when the option is selected: the
  « Linge de toilette » step now just adds it (« Ajouter le linge de toilette » / « Non merci ») like the
  ménage, and the règlement is chosen once for the whole arrival complement on the recap
  (CB/Chèque · Payé en liquide · En fin de séjour). Deferring to check-out now goes through the recap's
  « En fin de séjour ». A legacy bath-linen line deferred by an older commit is still shown at check-out.
- SAS : à l'étape ménage, quand le ménage n'est pas inclus, le bouton mis en avant par défaut est désormais « Non merci » (le ménage est l'exception, pas la règle) ; « Ajouter le ménage » reste disponible en second.
- SAS arrivée et départ : le récapitulatif affiche désormais le détail des compléments à régler (chaque ligne avec quantité et prix : « libellé : qté × prix unitaire = total »), au lieu d'un simple montant « Déjà dû ».
- SAS check-out : quand il y a un complément de fin de séjour, le complément d'arrivée impayé n'est plus signalé « non perçus » (bandeau orange) mais fusionné dans la liste « à percevoir » — le montant reste bien compté. Le libellé d'alerte n'apparaît plus que lorsqu'un complément d'arrivée impayé est seul à percevoir (oubli de check-in).
- Le SAS de départ demande désormais « L'extincteur est-il en bon état ? ». Si non, une page de tarifs (« Plomb manquant », « Utilisation ») permet de saisir une quantité par poste ; le montant correspondant (prix × quantité) est ajouté au complément de fin de séjour, calculé côté serveur. La question « plomb présent ? » à l'arrivée et au départ est remplacée par cette nouvelle étape, au départ uniquement.
- **SAS — hide already-settled steps** (spec `sas-hide-settled-steps.md`, 2026-07-03). The arrival caution page no longer appears once the caution is received (even when reopening a completed SAS), and the ménage page is skipped when the cleaning is already included — its « vaisselle / poubelles » client reminder moves to the recap. Departure steps unchanged.
- SAS (check-in / check-out) mobile redesign: the first page now leads with the property photo, then the property name and the **client name centred in blue** (wrapping onto 2 lines if needed), the platform badge styled exactly like the planning, the arrival/departure in the planning format (coloured chips + time), and a people count. Yes/no pages adopt a single colour code — the reassuring answer is **white-on-blue on top**, the problem answer **black-on-red below** — and the extincteur step is now a Oui/Non question (Oui = plomb présent) instead of a switch.
- Planning tiles now launch the arrival/departure SAS from two explicit buttons (« Ouvrir la réservation » + the SAS button) instead of a clickable card; the SAS button is disabled with a ✓ once its check-in/check-out is done, so a finished SAS can no longer be reopened, and the client name links straight to the client fiche.
- SAS d'arrivée : sur le récapitulatif, le règlement « En fin de séjour » est désormais pré-sélectionné.
  Valider le check-in sans choisir de mode de règlement affiche explicitement « Reporté au check-out » —
  le complément d'arrivée reste non perçu et est rappelé au SAS de départ (comportement inchangé côté
  données, il est simplement rendu visible).
- SAS (récap) : les cases « encaissé » / « caisse interne » deviennent des **boutons** — **CB / Chèque**, **Payé en liquide** (caisse interne) et, à l'arrivée uniquement, **En fin de séjour** (reporte le complément au check-out). Le récap de check-out a les deux mêmes boutons sans « En fin de séjour ».
- **SAS — bande de jours défilante et créneau juste après la remise en état** (spec `hourly-resource-quantity-and-sas-scheduling.md` §3.4 règles 18.bis et 20.bis, 2026-08-17). Sur un séjour long la bande de jours ne tenait pas à l'écran — 17 jours pour 3 visibles — et rien n'indiquait qu'elle défilait : la dernière pastille était coupée net et se lisait comme la fin de la liste. Elle porte maintenant un dégradé et un chevron du côté où il reste des jours, l'accrochage au défilement, et **garde le jour sélectionné à l'écran** quand les créneaux se rafraîchissent. Par ailleurs, la remise en état étant réglée sur la ressource, on connaît la minute exacte où elle se libère : un bain utilisé jusqu'à 14 h avec 15 min de remise en état est désormais **proposé à 14 h 15**, et non au prochain tour d'horloge — près de deux heures de bain déjà chaud récupérées. C'est le seul cas où l'on sort de l'heure pile ; le créneau est étiqueté « enchaîne » et revalidé au commit.
- SAS (arrivée / départ) : refonte de l'interface pensée mobile — **bandeau coloré** selon le mode (arrivée orange, départ ardoise) avec icône d'étape + **barre de progression « Étape X/Y »**, **grande icône** par étape, **texte agrandi** et **gros boutons** color-codés pleine largeur sur téléphone. Plus convivial et lisible. Fonctionnel inchangé (mêmes étapes, « Quitter » via le ✕, validation au récap).
- Completing an arrival SAS now validates the planning arrival coche and the dashboard « Prêt » + « Arrivé » for that reservation; completing a departure SAS validates the planning departure coche / dashboard « Parti ». The flags are set on commit and never auto-unticked, so a manual tick/untick stays authoritative between SAS runs (specs/arrival-departure-sas.md §3.6).
- Paramètres : sous-menu réorganisé. « Tarifs facturables » (prix du linge manquant + montants de réparation SAS) a désormais sa propre page/entrée de menu ; le « Jour de blanchisserie » a rejoint la page « Blanchisserie » (à côté du stock) ; « Vacances scolaires » + « Fermetures » sont regroupées sous « Vacances & fermetures » ; « Options » + « Ressources » sous « Options & ressources ».
- **Résumé fiche réservation — acompte/solde nets de commission.** Quand une commission est saisie sur l'acompte (ou le solde), le résumé affiche désormais le montant **net** de l'échéance (montant − commission), avec une petite légende « net de la commission … ». Acompte net + solde net = net perçu.
- Page **Gestion tarifaire** : une date de saison ne se coupe plus jamais en deux lignes (la puce
  d'événement perd son icône et passe à la ligne si besoin). Sous 900 px, les saisons s'affichent en
  cartes au lieu d'un tableau de 980 px qu'il fallait faire défiler sur 2,6 écrans, et les trois
  boutons de la barre d'actions se replient en menu « … » au lieu de s'empiler en escalier en
  écrasant le titre.
- Le **coût de revient du pack accueil** quitte les réglages du logement : il appartient désormais à
  la recette (`welcomePack.cost`), qui l'écrit à l'application. C'est une donnée de marge — elle sert
  uniquement à charger le prix direct affiché dans la grille plateformes — et jamais un montant vu
  par le client.
- Tourist-tax extraction: a stay is now declared in its **stay-end (last-night) month** — or in the payment month if the tax-carrying échéance is paid later — instead of the payment month unconditionally. Unpaid stays remain excluded (no tax remitted if never collected).
- **Taxe de séjour : figée pour les séjours passés, recalcul manuel** (spec `tourist-tax-freeze-past-with-refresh.md`, 2026-06-20). La taxe de séjour des **réservations passées** (dernière nuit avant le 1er du mois en cours) est désormais **figée** sur la fiche : un changement ultérieur du tarif/nuit ou du taux communal ne réécrit plus une taxe déjà déclarée. Les réservations du **mois en cours et à venir** continuent d'être recalculées en direct. Pour une résa passée, un **bouton « rafraîchir »** à côté du résumé « Taxe de séjour » force le recalcul (puis Enregistrer pour le répercuter dans les comptes).
- **Taxe de séjour : mode commun à tous les logements + cas « reversée » facturé** (spec `per-platform-tourist-tax-three-way.md`, 2026-06-19, suivi de #249). Deux corrections au réglage 3 modes par plateforme :
  - **Le mode est désormais global par plateforme** (stocké sur la table `platforms`, comme la couleur) : le modifier sur un logement s'applique **automatiquement à tous les autres logements**. La fiche logement le rappelle (« Le mode de Taxe de séjour et la couleur sont communs à tous les logements »).
  - **Cas « collectée par la plateforme puis reversée à vous » : la taxe est maintenant facturée** (et non offerte/barrée) dans la fiche de réservation, placée dans le **solde** (la plateforme la verse avec le règlement). Elle apparaît dans le **Suivi taxe de séjour** et sur la ligne **46710000** de la comptabilité via le chemin standard. Seul le cas « collectée **et reversée à la commune** par la plateforme » reste offert/absent des comptes. Règle directrice : **toute taxe que NOUS reversons à la commune (direct, reversée, à l'arrivée) figure dans la page « Taxe de séjour »**.
- **Taxe de séjour sur le solde uniquement.** Quand une réservation a un acompte, l'acompte ne porte plus que sur l'hébergement (pourcentage calculé hors taxe de séjour) ; toute la taxe de séjour est désormais sur le solde. Sans acompte, rien ne change.
- **Suivi financier › Taxe de séjour** : une nuitée apparaît dans le mois où son **solde est encaissé** (`balancePaidDate`), et non plus au mois de la dernière nuit. Les soldes non payés disparaissent de la déclaration jusqu'à leur encaissement (taxe perçue à l'arrivée → mois du complément).
- **Suivi financier › Comptabilité** : la taxe de séjour n'apparaît plus sur l'écriture d'acompte — elle est désormais imputée en totalité sur l'écriture du solde (compte 46710000), y compris pour les réservations dont l'acompte avait été encaissé avant cette règle. Chaque écriture reste équilibrée.
- **Suivi taxe de séjour : le mois en cours est sélectionnable** (2026-06-20). La page « Extraction taxe de séjour » plafonnait le sélecteur de mois au **mois précédent** ; elle va désormais **jusqu'au mois en cours inclus** (utile pour voir la taxe déjà à percevoir sur le mois en cours). Les mois futurs restent masqués. Le mois ouvert par défaut reste le mois précédent.
- Fiche réservation : quand la **plateforme collecte ET reverse la taxe de séjour à la commune**, le montant s'affiche désormais **barré** avec une courte explication « Collectée et reversée à la commune par la plateforme » — sans le badge « Offert » (ce n'est pas un geste commercial).
- CI : le workflow **« Unit tests »** est désormais lançable à la main (`workflow_dispatch`, avec une
  entrée `ref` optionnelle) — `gh workflow run "Unit tests" --ref <branche>`. Ajouté après un
  incident du 2026-08-06 où le job `client (vitest)` n'a obtenu aucun runner GitHub sur trois
  tentatives consécutives (aucune étape exécutée, tué par le délai de 15 min) alors que le job voisin
  et le workflow E2E tournaient normalement : relancer le job retombait dans la même file affamée, et
  sans déclencheur manuel le seul recours était un commit vide.
- La page « Réservations à venir » (carte Réservations du tableau de bord) affiche désormais les cartes Planning d'arrivée groupées par jour, sur toutes les réservations futures, au lieu d'un tableau.
- Outillage client : passage à **Vite 8** (+ `@vitejs/plugin-react` 6, indissociable). Vite 8 remplace
  esbuild par oxc **et** rollup par rolldown, et tous deux décident du JSX par l'extension du fichier
  — aucun réglage ne permet plus de parser du JSX dans un `.js`. Les **212 fichiers** qui en
  contenaient sont donc renommés en `.jsx` (`git mv`, l'historique suit) ; les 53 fichiers de pur JS
  restent en `.js`. Le seul chemin corrigé à la main est l'entrée `index.html`, la résolution
  d'extension ne s'appliquant pas au HTML. Gain mesuré : **build en 320 ms contre 2,74 s**, pour un
  bundle de taille identique. 788 tests client, 45 E2E et quatre écrans vérifiés à l'identique, sans
  erreur console. Voir `specs/vite-8-oxc-migration.md`.
- WordPress booking widget redesigned as the single unified widget (spec `wp-booking-widget-redesign`):
  dates are picked exclusively on an embedded availability calendar (read-only date fields, blocked
  ranges refused), the party and every quantity use stepper controls, and options + resources render
  in one uniform list. Resources (bain nordique…) are now bookable from the site with a server-driven
  « À planifier avec l'hôte » note on hourly resources; the note no longer shows on planning-card
  options. Public resource projection gains `priceUnitLabel`, `quantityLabel` and
  `showsSchedulingNote`. Plugin bumped to 1.4.0.

### Fixed
- **Bed-linen default now appears on iCal-arrived reservations** (spec
  `bed-config-in-linen-card.md` §10 follow-up #5, 2026-06-08). The iCal
  sync created a bare reservation and skipped the property's option
  defaults, so on "Gite" (bed linen is an *offered* default) a freshly
  imported booking showed no bed-linen option. The sync now applies the
  property's option defaults to each new iCal reservation, marked
  `offered` per the property setting (pricing stays 0 until the operator
  edits). +2 tests.
- **"Lit bébé" counter is back whenever there are babies** (spec
  `bed-config-in-linen-card.md` §10 follow-up #6, 2026-06-08). Since bed
  counters moved into the "Linge de lit" option card, the baby-bed
  counter was hidden when no bed-linen option was enabled. A baby bed is
  an independent resource: it now lives in the **Voyageurs** card and
  shows whenever `babies > 0`, with its live availability ("Dispo
  restante") from the *Lit bébé* resource — capped at 0 when other
  reservations have booked every baby bed for the dates. The server
  invariant no longer zeroes `babyBeds` without a linen option (safe:
  laundry gates the baby-linen aggregation on the option separately).
  +4 server availability tests, +4 client display tests.
- **Mobile calendar now fits the screen width** (spec
  `calendar-mobile-view.md`, 2026-06-08). The main content area
  (`<Box component="main">`) lacked `minWidth: 0`, so the week strip's
  non-shrinkable full-width pages stretched the page wider than the phone
  (page-level horizontal scroll). Added `minWidth: 0` on `main` (+ a
  `width/maxWidth: 100%` guard on the week-view card); the page fits the
  viewport and only the week strip scrolls horizontally.
- **iCal sync no longer overrides establishment closures** (2026-06-06).
  Adrien declared a property closure for a week, but an iCal feed
  silently created a reservation overlapping it. Root cause:
  `propertyIcalModel.syncSource` calls the prepared `INSERT INTO
  reservations` directly — bypassing `validateAvailability` (which
  only runs on the HTTP API path), and therefore bypassing the
  closure check that exists there. Two paired defences:
  1. **Closure guard at sync time.** Every iCal event is now checked
     against `establishmentClosuresModel.findCoveringClosure(propertyId,
     start, end)` BEFORE any mapping resolution. When a covering
     closure is found, the event is silently skipped — no insert, no
     update, no mapping changes, no cancellation alert. The skip is
     counted in `result.skippedClosureCount` and surfaced in
     `ical_sources.lastSyncMessage` (`N ignoré(s) (fermeture)`).
     Honours global closures (`propertyId IS NULL`) too.
  2. **"Closed Period" filtered at parse time.** Airbnb labels host-
     blocked date ranges as `Closed Period` in the VEVENT SUMMARY.
     `isUnavailableIcalEvent` (which already dropped `blocked` / `not
     available` / `indisponible`) now also matches `closed period` /
     `closed-period` / `closed   period`. Events stamped this way
     never reach the sync loop, so they can't conflict with a closure
     even when one hasn't been declared yet.
  Tests: +6 server cases (1 parser regex sweep + 5 sync-time guard).
  Two pre-existing iCal test DDLs gained the `establishment_closures`
  table; one pre-existing test fixture's generic "Closed Period"
  summary was swapped for "Booked Ical" to stay flowing through the
  parser. Server tests 1041 → 1047 green in isolation.
- **Accounting export — legacy path now sees `customPrice` + offered
  options, no more negative VAT row** (2026-06-05). Live prod bug
  reported on Chloé Le Lann's reservation
  (#5, Gitedefrance, balancePaidDate 2026-05-07): the monthly export
  was producing
  ```
  CRÉDIT 70600000 Location gîte           624,54 €
  CRÉDIT 70600010 Prestation comp.         79,82 €
  CRÉDIT 44571100 TVA 10 %                -17,36 €   ← phantom
  ```
  Σ crédits still equalled Σ débits (687 €) — the accounting *was*
  balanced — but the VAT row showed −17,36 € for a reservation whose
  options were all offered to 0 €. The accountant rightly flagged it.
  **Root cause** — the engine's `buildEntry` has two paths: a
  contrib-driven path (used when at least one `*ContribTtc` column is
  non-NULL) and a legacy fallback that derives buckets from a freshly
  recomputed `quote`. Chloé's reservation had all contribs NULL (the
  Solde was flipped 2026-05-07, **before** the
  `force-item-to-complement` feature shipped and started capturing
  per-line contribs at the 0→1 flip), so the legacy path fired.
  `accountingModel.computeQuoteForReservation` was passing
  `selectedOptions` / `selectedResources` without the `offered`
  flag and was forgetting `offeredOptionIds` entirely. It was also
  passing `customPrice` but no test exercised that input. Net effect:
  the recomputed quote silently put the offered ménage back at its
  80 € catalog price, the legacy bucket emitted a 79,82 € credit on
  70600010, and the residue-absorption on the last credit line dumped
  the resulting -87,80 € mismatch onto the VAT row.
  **Fix** — `computeQuoteForReservation` now passes
  `customPrice: row.customPrice`, `offeredOptionIds` (computed from
  `reservation_options.offered = 1`), AND `offered: Boolean(o.offered)`
  on each `selectedOptions` / `selectedResources` entry. The legacy
  path's buckets now match `row.finalPrice` exactly → residue
  collapses to ≤ 1 cent of pure rounding noise → VAT stays positive.
  **Defensive guard — removed 2026-06-05** — PR #125 originally added a
  single-line `console.warn` when the credit-vs-debit residue exceeded
  1 €. After deploy the threshold proved too aggressive: legitimate
  legacy entries (e.g. reservation #12078 with 75,61 € deposit + 176,39 €
  balance residues from the deposit-pro-rata path) tripped it every
  export, producing log noise that hid real issues. The warning was
  removed; the silent absorption remains (it was always the production
  behaviour). A future negative-VAT regression is now caught by the
  existing `accounting-export-legacy-path-stale-quote` regression test
  (which asserts the VAT amount directly), not by side-effect log
  inspection.
  **Regression net** —
  `server/src/tests/accounting-export-legacy-path-stale-quote.unit.test.js`
  reproduces Chloé's exact prod state (in-memory DB + offered options
  + customPrice override + NULL contribs + Gitedefrance commission)
  and pins:
  - the legacy bucket shape (accommodation HT 569,09 + VAT 56,91, no
    options bucket);
  - the `legacyFraction` carries `grossRatio` (= 1,09744);
  - effective HT × fraction = 624,55 €, effective VAT × fraction =
    62,45 € (positive);
  - end-to-end CSV: no 70600010 row, no negative credit, no
    large-residue warning, Σ debits = Σ credits = 687 €.
  Server tests **964 → 967 / 967 green** (3 new cases; 2 pre-existing
  parallel-runner flakes from prior PRs still clear in isolation).
- **Plan comptable — `PUT /api/accounting/platform-accounts` no longer
  double-encodes the body + page renamed to "Plan comptable"**
  (2026-06-05). User report from prod: filling the form, hitting
  Save, leaving and coming back showed empty fields — nothing was
  ever persisted.
  Live Playwright capture of the failing request body on the dev
  server (rebuilt with prod-shape data):
  ```
  "{\"defaultAccount\":\"622600\",\"platforms\":[…]}"
  ```
  The body was JSON-stringified TWICE: once by
  `api.savePlatformAccounts` (`body: JSON.stringify(payload)`),
  then again by the shared `request()` helper in `client/src/api.js`
  (line 10 — single source of truth for body serialisation across
  the whole client). Express's body-parser rejected with
  `SyntaxError: Unexpected token '"', "{\"defau"...` and returned
  a `400 Bad Request`. The PUT response was an HTML error page,
  the alert surfaced "Bad Request", but the form's optimistic
  state still showed the typed values — so the user perceived the
  save as successful until the next reload returned the unchanged
  GET payload.
  **Fix** (`client/src/api.js` line 227): drop the redundant
  `JSON.stringify(payload)` and pass the raw object to
  `request()`, matching every other endpoint in the file. Comment
  added pointing back to this report so the next reader doesn't
  re-introduce the same mistake.
  **Regression net (two layers)**:
  - **API helper** (`client/src/__tests__/api-body-encoding.test.js`,
    2 cases) — (1) `savePlatformAccounts` produces a body that
    parses straight to the original payload, with the first
    character `{` (the smoking gun of double-encoding is a leading
    `"`); (2) source-level scan asserts NO `body: JSON.stringify(…)`
    exists in `api.js` outside the `request()` helper. Catches any
    future endpoint that re-encodes by mistake.
  - **Page-level round-trips** (`client/src/pages/__tests__/PlatformAccountsPage.test.js`,
    3 new cases on top of the 8 already shipped):
    (a) **Save round-trip** — after a save, the form reflects the
        server response (typed value + TVA toggle), the "Configuration
        enregistrée" alert is shown, and the Save button goes back to
        disabled. Would have failed loudly under the double-encode
        bug because `savePlatformAccounts` rejected with 400 and the
        alert showed "Bad Request" instead of "Configuration
        enregistrée".
    (b) **Remount round-trip** — unmounting the page and remounting
        with the new GET payload re-populates the form with the
        persisted values. This pins the exact prod scenario Adrien
        hit: leave the page → come back → fields should show what was
        just saved, never empty.
    (c) **Cancel restores last-saved state** — typing then clicking
        Cancel reverts to the initial value, not the typed one.
  Vitest **218 → 223 / 223 green**.
  **Page rename**: `/comptabilite/plateformes` was titled "Plan
  comptable plateformes" (header + sidebar + helper text in
  Settings → Général). Renamed to "Plan comptable" everywhere
  (3 client strings + 1 test assertion + 8 spec references).
- **Platform colours restored on EVERY calendar surface + the finance
  summary, with a filesystem invariant test that prevents the
  regression from re-appearing silently** (2026-06-05). Initial fix
  caught the three lookups on `MiniPlanningStrip.js`. A second sweep
  triggered by Adrien's request for full calendar coverage uncovered
  three more broken surfaces:
  - `SyncedPropertyMiniCalendars.js` (the dashboard's + simplified
    calendar's per-property mini strips) — 3 direct
    `platformColors[platform]` lookups in `buildDayGradient`.
  - `PropertyCalendarOverview.js` (legacy overview, currently unused
    in the routing but kept for future) — same pattern.
  - `pages/FinancePage.js` — 2 `<Chip sx={{ bgcolor: PLATFORM_COLORS[r.platform] }}>`
    on the finance reservation tables, making every non-direct
    platform appear with a `bgcolor: undefined` chip.
  - `pages/PropertyDetail.js` — 5 lookups against
    `source.platformKey` (lowercase slug, so the chips were
    visually correct today, but the read shape was fragile).
  **Refactors:**
  - The 3 calendar components no longer accept a `platformColors`
    prop. They import `getPlatformColor` directly. Removed the
    now-dead `platformColors={PLATFORM_COLORS}` prop from
    `CalendarPage` + `Dashboard`. `buildDayGradient` is exported
    from `SyncedPropertyMiniCalendars.js` + a new
    `buildMiniStripDayGradient` is extracted to a top-level pure
    function in `MiniPlanningStrip.js` so the colour-resolution
    paths are unit-testable in isolation.
  - `FinancePage` + `PropertyDetail` switched to
    `getPlatformColor(…)`; the latter also uses the new
    `isKnownPlatformKey(platform)` predicate (added to
    `constants/platforms.js`) for the iCal form's "well-known vs.
    custom" branch.
  **Tests** (`client/src/__tests__/calendar-platform-colors.test.js`,
  12 cases):
  - Pure-function coverage on `getReservationColor` +
    `buildMiniStripDayGradient` + `buildDayGradient` (synced) — every
    UpperCamelCase form (`Airbnb`, `Booking`, `Gitedefrance`,
    `Pitchup`, etc.) lands on its canonical colour, never
    `DEFAULT_PLATFORM_COLOR`.
  - **Filesystem invariant**: walks `client/src/**/*.{js,jsx,ts,tsx}`
    (skipping `constants/platforms.js` + every `__tests__/`) and
    fails on any direct `PLATFORM_COLORS[dynamicValue]` READ. Writes
    (the customColors merge in App.js: `PLATFORM_COLORS[key] = color`)
    are explicitly allowed via a negative lookahead because the key
    is normalised before assignment. Catches future drift
    automatically at lint time.
  `platforms.test.js` extended with 3 cases on `isKnownPlatformKey`.
  Vitest total **210 / 210 green** (195 from the previous step + 12
  calendar invariants + 3 helper).
- **Platform colours restored on the calendar + `<Select>` round-
  trips correctly after the UpperCamelCase migration**
  (2026-06-05). Two regressions caused by PR #118
  (`normalize-platform-names.md`) that the spec missed because it
  declared the frontend untouched:
  1. `client/src/constants/platforms.js → PLATFORM_COLORS` keys are
     lowercase slugs (`airbnb`, `gitedefrance`). Reservations now
     carry `platform = 'Airbnb'` / `'Gitedefrance'` (UpperCamelCase)
     so the direct lookup `PLATFORM_COLORS[reservation.platform]`
     returned `undefined` → every non-direct booking fell back to
     the default grey on the calendar.
  2. The `PLATFORMS` array used as `<MenuItem value=…>` in
     `ReservationPage`'s platform `<Select>` was lowercase.
     Reservations stored as `'Airbnb'` no longer matched any
     `MenuItem` → `<Select>` rendered blank on edit.
  **Fix** (`client/src/constants/platforms.js`):
  - New `normalizePlatformKey(platform)` helper: NFD-strip +
    lowercase + remove every non-alphanumeric character. Slug-shape
    compatible with the server's `KNOWN_PLATFORM_COLORS` keys.
  - `getPlatformColor(platform)` rewritten to slug the input before
    looking up the colour map — every shape (UpperCamelCase,
    lowercase, free-form with accents) resolves correctly.
  - `PLATFORMS` array switched to UpperCamelCase canonical form
    (`'direct'` stays lowercase, matches `formatPlatformName`'s
    output): the `<Select>` round-trips again.
  - `gitesdefrance` (plural) alias added so the accented form
    `'Gîtes de France'` resolves to the same yellow as the singular
    slug.
  Callers updated: 4 direct `PLATFORM_COLORS[…]` lookups in
  `MiniPlanningStrip.js` replaced with `getPlatformColor(…)`; the
  `customColors` merge in `App.js` now re-normalises incoming server
  slugs before assigning. `PropertyDetail.js`'s lookups by
  `ical_sources.platformKey` are unchanged (that column is the
  lowercase slug by construction).
  Tests: `client/src/constants/__tests__/platforms.test.js`
  (13 Vitest cases) pins the slug normaliser, every UpperCamelCase
  reservation form, the "Gîtes de France" plural variant + the
  dropdown invariants. Spec `normalize-platform-names.md` §4.2
  updated with a "2026-06-05 follow-up" subsection so the next
  reader sees this gap was retroactively closed.
- **MUI 9 — `<Stack>` CSS-shorthand props now passed via `sx` everywhere,
  silent layout breakage finally killed** (2026-06-05). The migration
  from MUI 5 → 9 (PR #114) silently dropped support for
  `justifyContent`, `alignItems` and `flexWrap` as direct `<Stack>`
  JSX attributes — in MUI 6+ they MUST be passed inside `sx={{ … }}`,
  otherwise they're stripped at runtime and the rendered DOM gets
  `justify-content: normal`, `align-items: normal`, etc. `direction`
  and `spacing` still work as props (they're explicit Stack API
  fields).
  The breakage stayed invisible for weeks because most layouts had
  a `<Box flex={1}>` as the first child of every Stack, which spreads
  space naturally regardless of `justifyContent` — the right-side
  cluster of every option card landed on the right edge even with
  the prop dropped. The polish in PR #121 (small Switch + no inline
  label + no `flexGrow: 1` on the Total chip) shrank the right-side
  cluster enough that the bottom row of the Extras section visibly
  collapsed to the left. Confirmed via Playwright DOM inspection
  on a real platform reservation: `getComputedStyle(stack)
  .justifyContent === 'normal'` for every offender, then
  `'space-between'` after the migration.
  **Sweep** (21 occurrences across 8 files):
  - `components/reservation/ExtrasSection.js` — 11 Stacks (the
    user-reported regression: bottom row of every option / resource
    card on the reservation form).
  - `components/MiniPlanningStrip.js` — 1 Stack (the toolbar above
    the mini planning strip in the reservation form).
  - `components/PropertyDefaultOptionsCard.js`,
    `components/OptionPropertyDefaultsMirror.js`,
    `components/LogoUpload.js` — 1 each.
  - `pages/AccountingPage.js` — 9 Stacks (monthly toolbar + legend +
    encaissement rows).
  - `pages/DevisPage.js` — 2 Stacks (filter row + row actions).
  - `pages/UserManagementPage.js` — 4 Stacks (table cells + mobile
    card actions).
  **Regression net**: a new Vitest filesystem-walk test
  (`client/src/__tests__/mui9-stack-props-no-direct-shorthand.test.js`)
  scans every `.{js,jsx,ts,tsx}` under `client/src/` (skipping
  `__tests__/`) and fails on any `<Stack … {justifyContent,
  alignItems, flexWrap}="…">` direct-prop usage. Multi-line Stack
  openings are tolerated by the regex (the initial grep that drove
  the manual sweep missed one — the test caught it). Any future
  drift back to the broken pattern now breaks the suite at lint
  time. Vitest **189 → 190 / 190 green**.
- **Dev server — `/uploads/*` now proxied to the backend** (2026-06-04).
  Regression from the CRA → Vite migration (PR #111): CRA's
  `"proxy": "http://localhost:4000"` field was a **catch-all** that forwarded
  every unmatched request to Node, including `/uploads/*` (company logo +
  property photos, served by `server/src/index.js` line 100). Vite requires
  explicit prefix entries, and the migration only listed `/api`. Symptoms on
  the local `npm run dev` setup: broken `<img src="/uploads/…">` tags on
  `/settings` and `/properties`, and the dynamic favicon silently falling
  back to the bundled `client/public/favicon.ico` because
  `/uploads/company-logo.png` 404'd. Fix: add `/uploads` to
  `vite.config.js → server.proxy`. Prod path was never affected (Express
  serves `/uploads` directly there). Spec `cra-to-vite-migration.md` §3.1
  updated to list both proxy prefixes + explain the CRA catch-all behaviour
  for future migrations.
- **CI deploy — `release.sh` rsync now creates the missing `client/` parent directory**
  (2026-06-04). Regression from the CRA → Vite migration (PR #111): `release.sh` line 61
  copies `client/dist/` → `client/build/` inside the release archive, but rsync only
  creates the leaf (`build/`) — not the intermediate parent `client/`. The first rsync
  in the script (line ~46) only created `$RELEASE_DIR/server/`, so the subsequent client
  rsync failed with `mkdir "guestflow-release/client/build" failed: No such file or
  directory` and aborted the deploy at the "Create release archive" step. Fix: add
  `--mkpath` (GNU rsync ≥ 3.2.3 — the Pi self-hosted runner runs 3.4.1, so it's
  supported). The `dist/` → `build/` rename inside the archive stays unchanged so the Pi
  PM2 deploy layout is backwards compatible. **Note for local dev on macOS**: Apple's
  default `rsync` is `openrsync` which doesn't understand `--mkpath`; install GNU rsync
  via `brew install rsync` to run `release.sh` locally.
- **Devis PDF — date du devis, validité, taxe de séjour, options par défaut**
  (spec `devis-pdf-and-tourist-tax-fixes.md`, 2026-06-04). Four user-reported defects
  bundled into one PR because they live in the same devis-generation flow:
  - **"Date du devis" was blank on recent devis.** Some rows (e.g. `2026-06-001`,
    `2026-05-007`) ended up with `createdAt = ''` despite the SQLite default. Fix:
    explicit `createdAt = datetime('now')` binding on every devis INSERT path
    (`create` + `convertFromReservation`), plus a defensive fallback in
    `devisPdf.js` that prints today's date for legacy bad-data rows.
  - **"Valable jusqu'au" ignored the configured `quoteValidityDays`.** The
    `validUntil` column was NULL on every devis in the prod-copy DB — the PDF was
    silently computing "today + days" on each render, oblivious to the issue date.
    Fix: persist `validUntil = createdAt + quoteValidityDays` (capped at `startDate
    - 2`) on `create` / `convertFromReservation`; `update` back-fills it on the
    first edit of a legacy row; the PDF reads the persisted value with the same
    formula as a forward-only fallback.
  - **Property option defaults (e.g. `Linge de lit`) were silently dropped from
    new devis.** The client merged them into the form AFTER the price call, but
    nothing on the server enforced the contract — a UI race / raw API caller saved
    the devis without them. Fix per "fat backend": `devisModel.create` AND
    `reservationsController.create` now merge any `property_option_defaults` entry
    not already in the payload BEFORE computing the quote. Idempotent (no
    duplicates), symmetric across the two surfaces, and rolls the `offered=true`
    flag into `offeredOptionIds` so an included-in-price default stays included.
  - **Tourist-tax detail string on the PDF was meaningless for percentage-based
    tax.** The PDF read `full.touristTaxRate` (the base percentage / fixed-amount
    column) as a per-person-per-night unit. Fix per user request ("ce montant doit
    être géré par le backend"): `devisController.pdf` re-runs the pricing engine
    against the persisted devis and passes the live `quote` to `generateDevisPdf`;
    the PDF uses `quote.touristTaxUnitAmount × touristTaxAdultsCount ×
    touristTaxNights`, mirroring what PricingSummary shows live in the UI. Legacy
    no-quote callers (existing tests, ad-hoc invocations) keep the historical
    row-derived behaviour — additive `quote` parameter, no breaking signature
    change.
  - **Tourist-tax TOTAL line + grand TOTAL TTC stayed stale after a partial fix.**
    Follow-up to the same PR: the first round routed only the *detail string*
    through the engine quote but kept the displayed "Taxe de séjour" total line
    and the "TOTAL TTC" grand total on the persisted `full.touristTaxTotal` /
    `full.finalPrice`. Concrete user-reported case: PDF showed `Taxe de séjour
    15,36 €` while PricingSummary showed `16,80 €` on the same reservation
    (percentage tax + 10 % department surcharge). New pure helper
    `resolveLiveTaxTotals(full, quote)` in `utils/devisPdf.js` owns the
    resolution: live quote wins when provided, row is the legacy fallback,
    `quote.touristTaxTotal = 0` keeps the row (engine "didn't compute"), and
    `quote.finalPrice = 0` is honoured (offered stay). Pinned by 5 new invariant
    cases in `tests/devis-pdf-date-validity-tax.unit.test.js` (consistency
    invariant block). Spec §3.4 rule 20 added.
  **Non-regression coverage** (per user's explicit request): 4 new server unit
  test files, 29 cases, **899 / 899** server suite green.
  - `tests/devis-model-createdAt-validUntil.unit.test.js` (6 cases): explicit
    `createdAt` binding, `validUntil` formula, the `startDate - 2` cap, the legacy
    backfill on `update`, the persisted-override-wins case, and
    `convertFromReservation` parity.
  - `tests/devis-model-property-defaults.unit.test.js` (4 cases): merge,
    no-duplicate, no-defaults no-op, `offered` flag propagation.
  - `tests/reservations-controller-property-defaults.unit.test.js` (4 cases):
    symmetric coverage on the reservations side via a controller-level test that
    mocks the engine + model surface.
  - `tests/devis-pdf-date-validity-tax.unit.test.js` (15 cases): the
    `computeValidUntil` helper + a PDF render smoke per scenario the spec lists
    (PDFKit's content streams are FlateDecode-compressed, so byte-level inspection
    isn't reliable; the helper coverage + render smoke are the right shape) + 5
    consistency-invariant cases on `resolveLiveTaxTotals` pinning the live-quote-
    vs-row resolution (incl. the user's exact 15,36 € / 16,80 € regression).
  **Client-side Vitest mirror** (added when rebasing on the CRA → Vite branch,
  same day): 9 new cases pinning the symmetric "consume the engine quote, never
  re-derive" rule on the client.
  - `client/src/components/__tests__/PricingSummary.tourist-tax.test.js`
    (5 cases): displayed tax total reads `quote.touristTaxTotal` (the user's
    16,80 € exact scenario), detail breakdown reads the engine's `unitAmount ×
    adultsCount × nights`, engine zero overrides a stale form value, quote-omitted
    initial load falls back to the form (anti-flicker), `touristTaxLabel`
    rendered verbatim.
  - `client/src/utils/applyQuoteToForm.test.js` (+4 cases): the form-sync helper
    overwrites a stale `touristTaxTotal` on every recompute, an engine zero wins
    over a non-zero form value, `touristTaxRate` is copied verbatim, null/undef
    engine values map to 0 (no NaN leak into the form).
  **Forward-only**: no backfill SQL for the existing rows with bad/empty data.
  The defensive guards in `devisPdf.js` and the `update`-time `validUntil`
  backfill mean legacy devis still render correctly on the next reopen.
- **CI deploy log cleanup** (2026-06-04). Three deprecation-noise sources in
  `.github/workflows/deploy.yml` driven to zero:
  - `actions/checkout@v4` → `@v6` and `actions/setup-node@v4` → `@v6`. Eliminates the
    GitHub Actions warning `Node.js 20 actions are deprecated. ... will be forced to run
    with Node.js 24 by default starting June 16th, 2026`. The v6 majors of both actions
    run on Node 24 natively.
  - `npm rebuild --build-from-source better-sqlite3` → `env
    npm_config_build_from_source=true npm rebuild better-sqlite3`. The bare flag is NOT
    an npm CLI option (it's a `prebuild-install` convention) and recent npm versions
    reject it with two warnings: `"better-sqlite3" is being parsed as a normal command
    line argument` + `Unknown cli config "--build-from-source"`. The env-var form is the
    canonical entry point and survives the next npm major. Verified locally —
    `rebuilt dependencies successfully` with zero warning.
  Scope deliberately bounded: **42 client-side `npm audit` vulnerabilities** (19 high /
  14 moderate / 9 low) + ~25 `npm warn deprecated` lines during `client/ npm install` are
  ~90 % CRA transitive dependencies (`react-scripts 5.0.1` pulling stale jsdom / babel
  proposal plugins / workbox / svgo / eslint 8 trees). They cannot be fixed without
  migrating off CRA — a separate "migration project" tracked in the session memory.
  Server tree is clean (0 vulns; the 2 transitive deprecation warnings on
  `prebuild-install` + `node-domexception` are also CRA/jsdom-adjacent).
- **iCal sync now re-claims a reservation when the platform re-issues its UID** on a date
  change (spec `ical-summary-fallback-cross-uid.md`, 2026-06-03). Investigation triggered
  by a confirmed prod case: an Abracadaroom reservation #144253 was rescheduled from
  06-07 Jun to 10-11 Oct, the platform emitted a brand-new UID for the move, and the
  engine's four existing fallbacks (all keyed on the NEW dates) failed to link the new
  event to the old reservation — the old one was silently deleted (pre-PR #106) or would
  now surface as a soft cancellation alert, while a fresh new reservation was created
  with none of the operator's manual edits carried over.
  A new step 3.5 in `syncSource()`'s matching cascade now searches
  `ical_import_events` by `(sourceId, summaryNormalized)` — the SUMMARY is the only thing
  that stays stable across the move on platforms like Abracadaroom or Booking.com (booking
  number embedded). Two safety guards keep the heuristic from misfiring:
  - **Staleness filter** — only candidates whose UID is NOT in the current feed are
    considered (those have genuinely disappeared from the platform's authoritative state).
  - **Uniqueness gate** — exactly one stale candidate. ≥ 2 stale matches → ambiguity →
    fall through to INSERT + the standard cancellation alert flow.
  Net effect: when the new event lands, the existing reservation row is preserved,
  `sourceIcalEventUid` is rewired to the new UID, and the existing date-drift detection
  (PR #104) does the rest — silent full update if the reservation is unlocked, orange
  Dashboard "Modifications de dates iCal" card if it's locked. No new tables, no new
  endpoints, no new UI; ~15 lines of engine code + 4 dedicated tests.
- **Planning: a Tuesday with ONLY a laundry card now renders** (rule 13.ter, 2026-06-03). The
  day-set merger in `PlanningPage` previously only collected dates from arrivals, departures,
  and resource bookings. A laundry day that fell on a date with none of those (typical after
  activating property defaults on a quiet week) silently disappeared. The merger now also
  consumes `laundryByDate` keys, filtered to those that pass the `LaundryDayCard` silence
  check (`sum(dropOff) + sum(pickUp) > 0`).
- **`issue-letsencrypt-cert-http01.sh` — `openssl verify` post-install was missing
  `-untrusted` and triggered a false-negative on the new LE intermediates.** When a
  fullchain file is passed to `openssl verify -CAfile <bundle> <fullchain>`, openssl
  validates ONLY the leaf and looks for its issuer in the trust bundle. Since the
  leaf's issuer is an intermediate (Let's Encrypt's `YE1` introduced in late 2025),
  not a root, verify failed with `error 20: unable to get local issuer certificate`
  even when the cert was perfectly valid. The script then triggered the (correct)
  auto-recovery wipe → re-issue → install → re-verify — same wrong verify command,
  same false negative — and exit'd 1 telling the operator the cert was broken.
  Adrien's 2026-06-01 cert (chain: leaf → YE1 → ISRG Root YE → ISRG Root X2 →
  ISRG Root X1, the last of which is in every browser trust store since 2017) was
  100 % valid and Node was already serving it correctly with a green padlock in
  browsers — the script was the bug. Fix: pass the same fullchain file via
  `-untrusted` too, so openssl walks the chain (leaf → intermediates → root) before
  consulting the trust store. Verify now matches what browsers actually do.
- **`issue-letsencrypt-cert-http01.sh` (7 bugs + 1 self-recovery layer) +
  `.github/workflows/deploy.yml` (CI Node alignment + native rebuild) — everything caught
  during the 2026-05-31/06-01 prod bringup that previously needed manual workarounds on
  every run.**
  - *acme.sh installer flag dropped upstream* (`Unknown parameter: ----install-online`): the
    legacy `sh -s -- --install-online --email <addr> --home <path>` form was rejected by the
    current `get.acme.sh`. Switched to the documented key=value form
    `sh -s email=<addr>`; acme.sh now installs into `/root/.acme.sh` automatically. A
    re-anchor step picks up the actual install path so a non-standard `ACME_HOME` doesn't
    bite, and the script bails with a clear error if the binary still isn't where expected.
  - *acme.sh refusal under sudo* (`It seems that you are using sudo`): when invoked via
    `sudo ./script.sh`, `SUDO_USER` is set + `HOME` is preserved, which acme.sh treats as a
    misuse pattern and refuses to issue. The script now wipes `SUDO_USER/SUDO_UID/SUDO_GID/
    SUDO_COMMAND` and pins `HOME=/root` immediately before the `--issue` call — the
    pre-flight `id -u` check already guarantees we're effectively root.
  - *Cert installed where Node doesn't read it* (the silent killer): `CERTS_DIR` defaulted
    to `$HOME/guestflow/certs`. Under sudo that's `/root/guestflow/certs/`, while PM2 runs
    Node as the calling user (e.g. `pi`) and reads `/home/pi/guestflow/certs/server.{crt,key}`.
    Result: the cert was issued and installed perfectly, but Node kept serving the old
    self-signed one because the two paths never intersected. The script now derives
    `CERTS_DIR` from `$SUDO_USER`'s home (or honours an explicit `CERTS_DIR=...` env
    override), and the `chown` step targets `$SUDO_USER:$SUDO_USER` instead of the
    previously-hardcoded `adrien` — works on Adrien's Pi where the deploy user is `pi`. As
    a side-effect, the daily renewal cron now writes to the same path because acme.sh
    persists `--install-cert` targets in its per-domain conf.
  - *`--reloadcmd` ran as root, didn't reach the `pi`-owned PM2 daemon* (caught right after
    the first prod-cert install: cert file on disk was the real Let's Encrypt one, but
    `openssl s_client -connect localhost:4000` kept showing the previous staging cert). The
    reloadcmd was `pm2 restart guestflow --update-env >/dev/null 2>&1 || true` — invoked
    from acme.sh's root context, root's PM2 doesn't know the `guestflow` process and the
    call silently no-op'd; the `|| true` then masked the failure. The script now wraps the
    reload in `sudo -u $CERT_OWNER` when CERT_OWNER is non-root, and removes the noise
    suppression so any failure surfaces in acme.sh's output (and in cron emails at renewal
    time). acme.sh persists `--reloadcmd` per-domain, so re-running `--install-cert` (which
    this script does on every invocation) updates the value for all future renewals.
  - *Staging cert silently re-installed when re-running against prod* (the trap that left
    Adrien's Node serving `O=Let's Encrypt, CN=YE2` — a staging intermediate — even after
    a prod re-issue with `--force`): acme.sh keeps per-domain state in
    `<acme_home>/<domain>_ecc/` regardless of CA endpoint. When you iterate with
    `--staging` then switch to prod, the stale staging leaf sometimes survives
    `--install-cert` and Node ends up serving it. Browsers reject; `openssl verify` fails
    with `error 20 at 0 depth lookup: unable to get local issuer certificate`. The script
    now reads `Le_API` from the per-domain conf BEFORE the issue step; if it points at
    `acme-staging-v02` while the script is about to issue against `acme-v02` (or vice
    versa), the per-domain dir is wiped via `--remove -d <host> --ecc` + `rm -rf`. The
    acme.sh install and the account stay intact — only the per-domain cert tracking is
    reset. Idempotent: a same-endpoint re-run does nothing.
  - *No post-install sanity check, so a bad install was silent*: after `--install-cert`
    the script now prints `subject / issuer / dates` of the installed cert and runs
    `openssl verify -CAfile <system bundle>` against the leaf. System CA bundle is
    auto-detected across the three common paths (Debian, RHEL, Alpine). For a staging
    cert (intermediates not in any OS trust store), verification failure is tolerated.
  - *Auto-recovery when verification of a prod cert fails*: in Adrien's case the staging
    cert was installed even after a clean prod re-issue (acme.sh's `--install-cert`
    appears to occasionally copy the prior leaf instead of the freshly-downloaded one;
    exact mechanism unclear, possibly state cache or partial write). The script now
    treats verification failure on a prod request as a recoverable error: it wipes the
    per-domain state (`acme.sh --remove -d <host> --ecc` + `rm -rf <domain_dir>`),
    re-runs `--issue` from a clean conf, re-runs `--install-cert`, and re-verifies.
    Exactly one retry. If the second verify still fails the script `exit 1`s with a
    manual inspection cheatsheet (`openssl x509 -text`, `cat <domain>.conf`). No human
    in the loop in the common-but-broken case.
  - *Staging-vs-prod URL substring trap in the transition detection*: the previous
    pattern check used `grep -q "acme-v02"` which silently matches `acme-staging-v02`
    too (substring) — the detection misfired by treating staging as "compatible with the
    prod request". Replaced with a `grep -q "staging"` boolean compared against the
    `$STAGING` flag. Now the detection fires exactly when the previous CA endpoint and
    the current request differ.
- **`.github/workflows/deploy.yml` — CI Node version aligned with the Pi's runtime + force
  rebuild of native modules after install.** Every release deploy was leaving the
  `better-sqlite3` native compiled for the wrong Node ABI, then PM2 silently crashed on
  next restart (`ERR_DLOPEN_FAILED`, `NODE_MODULE_VERSION 127 ... 137`). Two compounding
  causes:
  - `actions/setup-node@v4` was pinned to `node-version: '22'`, but the Pi's system Node
    (which the PM2 daemon runs under) had been bumped by apt unattended-upgrades to v24.
    The deploy built `better-sqlite3` against the v22 ABI; PM2 spawned Node v24 → load
    refused. Pin bumped to `'24'` to match the current system. Comment added explaining
    that bumping the Pi's Node requires bumping this pin in the same PR.
  - Even with the right pin, `npm ci` happily downloads `better-sqlite3`'s prebuilt
    binaries from GitHub releases (matching the pinned major), which historically have
    drifted from the running Node's exact ABI. Added an explicit `npm rebuild
    --build-from-source better-sqlite3` step right after `npm ci` and a `require()` smoke
    test — a broken rebuild fails the deploy loudly here, rather than later via the PM2
    errored / crash-loop state. Plus a `Sanity-check Node + npm versions` step at the top
    that prints `node -v`, `npm -v`, `NODE_MODULE_VERSION` and warns if the existing PM2
    daemon's Node major differs from the runner's — surfaces drift in the deploy log.
  Manual recovery on a Pi that hit the bad state: `cd ~/guestflow/current/server && npm
  rebuild --build-from-source better-sqlite3 && pm2 restart guestflow --update-env`.
  README §HTTPS — *Real Let's Encrypt cert via Freebox port-forward* — gains the operator
  walkthrough split into staging-first + `--force` for prod, plus a *Troubleshooting* block
  covering the four pitfalls actually hit on 2026-05-31: the `.com` vs `.fr` DDNS suffix
  (Free's Freebox DDNS lives under `.fr` — Squarespace CNAMEs pointing at
  `<your-freebox-dyndns>.freeboxos.com` return NXDOMAIN), the cached-NXDOMAIN behavior on
  carrier resolvers (browser sees `DNS_PROBE_FINISHED_BAD_CONFIG` while `dig @8.8.8.8`
  resolves fine), the sudo-HOME / CERTS_DIR mismatch (and the `openssl s_client` one-liner
  to verify which cert Node is **actually** serving on `localhost:4000`), and the
  unrelated-but-co-occurring `NODE_MODULE_VERSION 127 ... 137` PM2 crash after a Pi-side
  Node bump (fix: `cd ~/guestflow/current/server && npm rebuild better-sqlite3 && pm2
  restart guestflow --update-env`).
- **Production deploy over plain HTTP hit "Une erreur TLS a provoqué l'échec de la connexion
  sécurisée".** When the Helmet config was introduced (V02.00.00), HSTS + CSP's
  `upgrade-insecure-requests` + the `Secure` flag on the session cookie were all gated on
  `NODE_ENV === 'production'`. That conflates "this is a production build" with "TLS is available
  at the network edge" — fine when the prod stack runs behind an HTTPS reverse proxy, fatal on a
  Raspberry Pi serving plain HTTP (Safari upgraded every asset URL to `https://`, TLS handshake
  failed, the SPA never loaded). Worse, the symptom is sticky: once HSTS was emitted by the prior
  deploy, the browser keeps refusing HTTP for the host up to the `max-age` (Helmet's default = 1
  year) until cleared by hand. Fix:
  - New env var `HTTPS_ENABLED` is the explicit switch for the network-edge TLS policy. `true` →
    HSTS on + CSP `upgrade-insecure-requests` on + session cookie `Secure`. Anything else (incl.
    `NODE_ENV=production` alone) → all three off.
  - Helmet + cookie options extracted to `server/src/utils/securityConfig.js` (pure builders, no
    side effects) so the rules are testable and version-controlled in one place.
  - Helmet's `useDefaults: true` is replaced with `useDefaults: false` — Helmet's default CSP
    directives include `upgrade-insecure-requests`, exactly what we are trying NOT to emit when
    HTTPS isn't available. Listing the directives ourselves makes it impossible for a future
    Helmet release to silently turn the upgrade back on.
  - GitHub Actions deploy workflow now sets `HTTPS_ENABLED=true` (with `TLS_CERT_PATH` /
    `TLS_KEY_PATH` pointing at the persistent `~/guestflow/certs/` directory provisioned in the
    new "Added" entry above) so the Pi serves HTTPS directly. If you ever need to disable TLS
    (private LAN tunnel, etc.) it's a one-line unset in the deploy workflow.
  - README §HTTPS gets the full rule table + per-browser HSTS-clearing instructions (Safari macOS
    + iOS, Chrome `chrome://net-internals/#hsts`, Firefox).
  - Regression test `server/src/tests/security-config.unit.test.js` (11 cases) pins the entire
    rule table; the explicit "NODE_ENV=production alone does NOT re-enable HTTPS enforcement"
    case will turn red if anyone reverts to the conflated logic.
- **"Nouveau devis" button was invisible on the Devis page.** `DevisPage` was passing an
  `actions={<Button>}` prop to the legacy `PageHeader` component, which expects
  `actionLabel` / `actionIcon` / `onAction` instead — the button (and the page subtitle) were
  silently dropped. Migrated `DevisPage` to the standard `<PageActionBar>` per CLAUDE.md §7;
  the create button now lives in `actionsBefore` as a custom node so it keeps its full label
  ("Nouveau devis") rather than collapsing to an icon-only IconButton. Click navigates to
  `/reservations/new?mode=devis` (the existing devis editor). New regression test
  `DevisPage.test.js` (3 cases: button visible, navigation target, button reachable while the
  list is still loading).
- **Per-platform tourist tax (owner-collect) leaked into the accountant journal:** with the new
  "tax in complement" schedule, the accounting export still pro-rated deposit + balance against
  `totalStayTtc` and pro-rated the complement (= pure tax) as if it were stay revenue. Result on
  owner-collect non-direct entries: deposit + balance under-counted HT/VAT (the difference dumped
  into the residue / last VAT line), and the complement emitted bogus accommodation HT/VAT lines
  for an amount that is *not* revenue (it's tax owed to the commune). Fix in
  `accountingModel.buildEntry`: when the engine flags `touristTaxCollectedOnArrival = true`,
  pro-rate deposit + balance against `finalPrice` (no tax inside those amounts), and carve the
  tax portion out of the complement entry — dropping the entry entirely if it boils down to pure
  tax (the tourist tax is reported via Suivi taxe de séjour, never via the accountant journal).
  Direct + platform-collect cases unchanged. Regression tests:
  `accounting-model-tourist-tax.unit.test.js` (7 cases). Specs
  `per-platform-tourist-tax-collection.md` + `accountant-accounting-export.md` updated.
- **Per-platform tourist tax (owner-collect) was invisible on the reservation panel and the wrong
  amount was scheduled in the balance:** two distinct bugs in the same flow. (1) `PricingSummary`
  derived "tax offered by platform" from the legacy hardcoded `platform !== 'direct'` instead of
  reading `quote.touristTaxOfferedByPlatform`, so flipping `collectsTouristTax` to 0 on a non-direct
  source had no visible effect — the line kept the strike-through and the "Offert" chip. Compounded
  by `totalSejour = isIcalSource ? raw - tax : raw`, which silently stripped the tax from the total
  for any iCal-imported reservation regardless of the resolved flag. (2) The pricing engine baked
  the owner-collected tax into the balance even though Adrien actually collects it on check-in. Fix:
  - `PricingSummary` now reads `quote.touristTaxOfferedByPlatform` (with a benign legacy fallback
    while the first quote is in flight) and trusts `quote.totalStayPrice` as authoritative.
  - The engine now flags `touristTaxCollectedOnArrival = true` when the platform is non-direct AND
    `collectsTouristTax = 0`, derives `acompte` + `solde` from `finalPrice` (stay excl. tax), and
    routes the tax into `complementAmount` from save 1 (not gated on deposit/balance being paid).
    `totalStayPrice` still equals `finalPrice + tax`. Direct + platform-collect cases are unchanged.
  - `PricingSummary` renders an "À collecter à l'arrivée (incluse dans le complément)" caption
    when the new flag is set.
  Tests: `pricing-tourist-tax-on-arrival-schedule` (5 cases — non-direct owner-collect, direct
  unchanged, platform-collect unchanged, depositPaid mid-state recomputes balance against
  `finalPrice`, complementPaid frozen). Engine-consumer suites (pricing / devis / accounting /
  reservations) green at 98 / 98. Spec `per-platform-tourist-tax-collection.md` updated (functional
  rules 5 + 7, architecture, test plan, UI/UX). No retroactive recompute on past reservations.
- **Per-platform tourist tax toggle didn't update the property's iCal sources table:** the SELECT in
  `propertiesModel.getByIdWithDetails` (powering `GET /api/properties/:id`) was missing
  `collectsTouristTax`, so the nested `icalSources` array always returned the field as `undefined`.
  The "Taxe collectée" chip on `/properties/:id` then fell back to "Plateforme" regardless of the
  saved value, even though the dedicated `GET /api/properties/:id/ical-sources` endpoint (and the
  pricing engine + Suivi page) had the right value. SELECT now includes `collectsTouristTax`;
  regression test added (`properties-model`). Spec `per-platform-tourist-tax-collection.md` updated.
- **Public iCal export leaked devis (introduced by the devis↔reservation fusion):** the `.ics` feed
  selected all `reservations` rows for a property without a `kind` filter, so after the fusion a devis was
  exported as a booked event — external platforms would treat a tentative quote as unavailable and block
  real bookings. The export now advertises only `kind='reservation'`. Regression-tested (`ical-model`).
- **Selecting a non-hourly resource broke the quote (price + summary):** the pricing engine's
  resource-line builder referenced an undefined `priceType` (instead of `resource.priceType`) when a
  resource was **not** `per_hour`/complex/free-minutes, throwing `ReferenceError` and failing the whole
  quote. `per_stay` / `per_person` / `per_night` / `per_person_per_night` resources now price correctly
  (e.g. a 20€ per-person-per-night resource over 2 guests × 3 nights = 120€). Regression test added
  (`pricing-resource-types`).
- **Non-hourly resources couldn't be offered:** the "Offrir" button in the pricing summary was gated
  behind `isPerHour`, so only complex/hourly resources could be comped. It now shows for **every**
  selected resource (like options) — the model/engine/persistence already supported it.
- **iCal sync created an orphan client on a renamed-guest update:** the iCal client was resolved for
  every event, but the update path never relinks `clientId`, so a changed guest name produced an unused
  client row. The client is now resolved only in the insert branches (guarded by a new sync test).
- **Client creation was broken (POST /api/clients hung):** the `clientsController` attached its
  `create(model)` factory as `.create`, overwriting the `create` request handler — so the route called the
  factory and never responded. The factory is now `.buildController` on the Bloc-1 controllers
  (clients/resources/resource-bookings), and POST/PUT handlers work again. Covered by the controller tests.
- **Devis PDF footer wrapped SIRET/TVA onto two lines:** the per-page footer's center column was too narrow,
  so `SIRET : … • N° TVA : …` could wrap. The column is now widened and set to a single line
  (`lineBreak: false`), keeping SIRET and TVA on one line.
- **Devis update history never recorded changes:** the audit "before" snapshot was captured *after* the
  row was already updated, so update diffs were always empty. The devis MVC refactor captures the baseline
  before persisting, so editing a devis now records a real history entry.
- **False "Modifications non enregistrées" prompt on a freshly loaded reservation/devis:** the on-mount
  server pricing recalc reshaped the loaded form after the unsaved-changes baseline was captured, so a
  just-opened (or just-converted) record was wrongly flagged dirty and prompted on "Annuler"/navigation.
  The baseline is now captured **after** the first quote applies for existing records (new/prefilled
  records still baseline immediately); genuine edits still flag dirty. Spec `devis-accept-to-reservation.md`.
- **Devis PDF ignored the manual accommodation price:** when a manual price (`customPrice`) overrode the
  accommodation, the PDF still printed the engine-computed price on the accommodation line, so the HT and
  TTC subtotals were wrong (only the grand total TTC, which uses `finalPrice`, was right). The PDF now
  renders a single accommodation row at the manual amount with the original engine price struck through
  (in either direction, like an offered line), so the rows sum to `finalPrice` and the HT/TTC subtotals
  reconcile with the total.
- **Devis PDF download returned 401 ("Impossible de générer le PDF"):** the PDF was fetched with a raw
  `fetch` that didn't send credentials. With `REACT_APP_API_URL` absolute (cross-origin in dev), the
  default fetch omits the session cookie → `401`. Added `api.getDevisPdfBlob(id)` (fetch with
  `credentials: 'include'`) used by both the Devis list page and the reservation devis-mode download.
- **Dev TLS error in Safari (page would not load over HTTP):** Helmet's default CSP includes
  `upgrade-insecure-requests` and HSTS pins the host to HTTPS, so a plain-HTTP dev session upgraded
  `http://localhost/main.<hash>.js` to `https://localhost` → "Une erreur TLS a provoqué l'échec de la
  connexion sécurisée". CSP and HSTS are now enforced in **production only** (`NODE_ENV === 'production'`,
  behind the HTTPS reverse proxy); they are disabled in development. Spec: `security-hardening.md`.
- **Missing favicon (404) + default icon:** added a default GuestFlow favicon (`favicon.svg` + `favicon.ico`
  for Safari/legacy) referenced from `index.html`, so the app shows a brand icon and stops requesting a
  missing `/favicon.ico` even when no company logo is configured. When a company logo *is* set, it still
  overrides the favicon (the default icon links are replaced in `App.js`).
- **Offered options/resources price bug (Bloc 2):** an option/resource that was "offert" (billed 0) on a
  saved reservation, then made paid again, no longer stays at 0 — the real price is always recomputed and
  restored. The fragile `totalPrice = 0 → offered` inference (in `pricing.js`, plus the SQL fallbacks in
  `reservations.js` and `devis.js`) was replaced by a single lossless rule: `offered` only zeroes the
  billed total while the real price is preserved as `originalTotalPrice`. Covered by a round-trip unit test.
- Private key is no longer returned in clear text by `GET /api/settings`.
- The Settings form no longer wipes the private key when saved without re-entering it (handled by `MaskedTextField` + 3-way payload semantics).
- The Google Calendar section now exposes a "Tester la synchronisation" button — no need to go to Réservations to verify credentials.
- Comptabilité : les encaissements affichent désormais l'argent réellement payé — le CA de
  chaque échéance = le montant stocké (acompte/solde/complément), le net perçu = CA − commission
  de l'échéance, et les lignes Location gîte / Options / TVA sont ventilées depuis les montants
  stockés de la réservation (plus jamais depuis un devis recalculé qui dérive avec les tarifs).
  Le pourcentage effectif de l'échéance (= % d'acompte du logement quand l'acompte est
  automatique) pilote la ventilation ; la taxe de séjour reste à 100 % sur le solde.
  (specs/accounting-encaissement-effective-percent.md)
- Comptabilité (plateformes) : correction d'un calcul faux du **revenu brut / net perçu** pour les réservations enregistrées **avant** le passage « solde = net » (ou non ré-enregistrées depuis). Le « regonflage » du montant se basait sur `total − commission` au lieu de la **somme réellement stockée**, ce qui doublait le brut (ex. CA 122,14 € / net 105,66 € au lieu de 102,50 € / 86,02 €). Désormais la compta affiche le bon revenu brut (= total du séjour) et le bon net perçu (= total − commission), quel que soit l'état du solde stocké.
- Rappel d'arrivée : la mention « le ménage de fin de séjour reste à votre charge » n'apparaît plus à tort lorsque l'option ménage est bien réservée — l'option est maintenant reconnue par son **nom** (et non plus seulement par un type interne que les options créées manuellement ne portent pas).
- **Petit déjeuner activable même quand le départ précède l'heure du petit déj.** Sur un séjour dont l'heure de départ est avant l'heure du petit déjeuner (ex. petit déj 09:00, départ 08:00), activer l'option la faisait réapparaître une fraction de seconde puis se désactiver (grille d'occurrences vide → le serveur ne facturait aucune ligne → l'option disparaissait au recalcul). Désormais le petit déjeuner du **matin de départ** est conservé et **recalé à 30 min avant l'heure de départ** programmée dans la réservation (08:00 → 07:30). Le matin d'arrivée reste exclu (avant le check-in). Pour les autres options à carte planning entièrement hors présence, un filet de sécurité pré-coche tous les jours du séjour pour qu'une activation manuelle ne disparaisse jamais.
- Petit déjeuner : le nombre de personnes annoncé est de nouveau celui d'**un matin**. Depuis le passage
  de l'option en carte planning (occurrences par jour), la quantité stockée compte les matins, et elle
  était encore multipliée par le nombre de voyageurs : un séjour 2 personnes / 2 nuits affichait
  « 4 personnes » dans le SAS d'arrivée, sur la carte planning et dans la notification push — avec des
  valeurs par défaut de viennoiseries et de pain gonflées en conséquence. Les montants facturés, eux,
  étaient corrects.
- Reservation fiche: the « Caisse interne » button on a complement now works — clicking it marks the complement as cash-settled and turns it **green** (like the « payé » button). It previously did nothing because the `PATCH /reservations/:id/payment` endpoint crashed (500) on a missing `resolveComplementPayment` import.
- **Calendrier par logement : plus de liseré de couleur autour des cases réservées.** Sur une case de réservation (arrivée, départ, ménage, nuit bloquée), le remplissage coloré débordait sous le fin contour translucide de la case et laissait apparaître un liseré coloré (rouge en fin de séjour, etc.) au lieu du tour gris. La couleur est désormais détourée à l'intérieur du contour (`background-clip: padding-box`) : le tour de la case reste un gris propre.
- **Calendrier cumulé : ouverture sur le mois en cours.** Sur mobile (et au chargement en général), le calendrier cumulé (tableau de bord + page Calendrier) s'ouvrait sur un mois aberrant — il sautait au dernier mois chargé. Cause : le défilement vers le mois ciblé utilisait `offsetTop`, mesuré depuis le haut de la page (les blocs de mois n'ont pas d'ancêtre positionné), valeur ensuite tronquée au défilement maximum. Le calcul est désormais relatif au conteneur (`getBoundingClientRect`), et le mois en cours est re-ciblé une fois les données chargées (les listes agenda mobiles ont une hauteur variable). Le calendrier s'ouvre maintenant pile sur le mois en cours.
- The security deposit (« caution ») shown in the arrival/departure SAS, on the reservation fiche, on the dashboard and in reminder emails is now read **live** from the property's configured « Caution par défaut » as long as it has not been collected. Changing a property's caution in Settings now updates every not-yet-received reservation at once. Once the caution is marked received, the collected amount is frozen on the reservation and no longer moves.
- **"Complément" toggle now has a visible label** (spec `force-item-to-complement.md`, 2026-06-11). On the reservation/devis Suppléments section, the per-line force-to-complement Switch had only a tooltip + aria-label, so it appeared as an unlabeled switch. It now shows a visible **"Compl."** caption on all four toggles (option, auto-option, custom option, resource).
- Reservation form: typing a French comma in a custom option's « Prix TTC » no longer wipes the
  line — the amount field now accepts comma decimals (and arithmetic, committed on Enter/blur),
  and in-progress custom lines survive live pricing recomputes instead of being erased.
- **Tableau de bord — le rouge ne signale plus que l'argent à encaisser au comptoir** (spec
  `dashboard-collection-alert.md`, 2026-08-05). La colonne « Paiements » passait en rouge dès qu'un
  acompte ou un solde restait ouvert : une réservation plateforme, qui n'est virée qu'après le
  séjour, était donc rouge tous les jours pour un fonctionnement parfaitement normal. Pire, le
  calcul ignorait les deux compléments alors que le prix final les inclut, donc « Manquant X € »
  persistait même après encaissement du complément — et le montant affiché était faux. Désormais le
  rouge se déclenche uniquement sur le complément d'arrivée non encaissé et non reporté (liste
  Arrivées) et sur le complément de fin de séjour encore ouvert (liste Départs) ; l'acompte et le
  solde en cours s'affichent en gris, avec un badge « Réglé par la plateforme » quand la plateforme
  verse après le séjour. Nouveau bloc serveur `operationalCollection` sur `GET /reservations/:id`,
  nouveau composant `CollectionStatusCell`, et règles de solde par échéance extraites dans
  `utils/reservationSettlement.js` (partagées avec le Suivi financier, dont les chiffres sont
  inchangés). +25 tests serveur, +3 tests client.
- Reservation page: the date pickers (échéances acompte/solde, « payé le » de chaque paiement, dates de caution, arrivée/départ) now **close as soon as a day is selected** — via a new shared `DateField` component that blurs the native input on change.
- **Devis** : « Nouveau devis » affiche enfin le catalogue d'options du logement (options, catégories,
  ressources, options par défaut, caution et horaires) au lieu d'une carte vide — la même impasse touchait
  aussi « Nouvelle réservation » et le « + » du tableau de bord.
- **Devis** : les options à créneaux (petit déjeuner, repas) et les ressources à l'heure (bain nordique)
  ne sont plus perdues à l'enregistrement. Sur le panier de référence, un devis facturait 380 € là où la
  même réservation facturait 458 € : les deux lignes étaient supprimées en silence avec leur prix.
- **Devis** : l'heure du petit déjeuner, le supplément voyageur offert, le routage « Compl. » et le tarif
  de vente sont enregistrés sur le devis, puis repris tels quels lors de la confirmation en réservation
  (cartes de planning et séances comprises).
- **Devis** : le pack de bienvenue s'applique désormais aussi à un nouveau devis en direct — sur la Lodge,
  jus de pomme et premier petit déjeuner arrivent offerts et cochés.
- **Devis** : un devis encore valide conserve les prix auxquels il a été émis, même après une hausse de
  tarif ; une fois périmé il est recalculé aux tarifs du jour et redaté. La fiche l'indique
  (« Valide jusqu'au … » / « Devis périmé — tarifs actualisés »).
- Fixed the devis→réservations fusion no longer writing a `guestflow.db.pre-devis-fusion-*.bak` backup on every server start. On a half-migrated database (devis already folded into reservations but the empty legacy `devis_*` tables never dropped), each boot used to back up then skip — flooding the server directory with `.bak` files. The boot now backs up only when the migration genuinely runs, and drops the empty leftover `devis_*` tables once to end the loop.
- **Devis PDF : une ressource offerte est enfin offerte.** Une ressource marquée « offerte » (le bain
  nordique) était enregistrée avec son prix au lieu de 0 € : le PDF l'imprimait sans la mention
  « Offert », en la facturant au client ou — sur un devis à prix manuel — en la déduisant de la ligne
  hébergement. Elle s'imprime désormais à 0 € avec son prix réel barré et le tarif hébergement reste
  entier. Les lignes déjà enregistrées sont corrigées au démarrage.
- **Devis PDF — taxe de séjour et TOTAL faux alors que la page devis était juste** (spec
  `devis-pdf-total-parity.md`, 2026-08-17). Le PDF dessinait ses lignes depuis le devis enregistré
  mais recalculait sa taxe de séjour et son TOTAL avec un devis moteur reconstruit à la volée, qui
  ne rejouait pas l'état vendu : options offertes refacturées (et déduction « comprise dans le
  tarif » perdue sur l'assiette de la taxe de séjour), verrou de prix ignoré, auto-options et
  routage Complément absents. Résultat sur le devis signalé : sous-totaux corrects (476,29 HT /
  523,92 TTC) mais taxe à 11,08 € au lieu de 9,60 € et un « TOTAL TTC 595,00 € » qui ne
  correspondait à aucune ligne du document. Le recalcul passe désormais par `devisModel.recomputeQuote`,
  la relecture unique de l'état vendu (mêmes entrées que la fiche), et le TOTAL imprimé est par
  construction la somme des lignes imprimées + la taxe imprimée. Correction rétroactive : le
  prochain export d'un devis déjà émis sort les bons montants, sans ré-enregistrement.
- Réservations : éditer une réservation qui chevauche déjà une autre (fréquent sur les imports iCal) ou qui dépasse déjà la capacité ne bloque plus l'enregistrement quand l'édition ne touche pas aux dates/logement (resp. au nombre de personnes/lits). On peut donc saisir le paiement plateforme ou corriger un champ sans tout perdre. Déplacer la réservation vers un vrai conflit reste refusé comme avant.
- **Finance — detail tables show exact amounts again** (post-review correction of the DS phase-1 formatter migration, 2026-07-14). The per-reservation reconciliation tables (projection, période, retards) and the actionable « En attente de paiement » / « Retard total » chips were mistakenly rounded to whole euros — rows no longer visually summed to their footer when amounts carried cents (routine with platform commissions). They now use the exact `formatCurrency` (`250,50 €`); only KPI tiles and chart labels keep the rounded overview style. +1 cents-reconciliation test.
- Suivi financier → Suivi opérationnel (Paiements en attente) : le « reste à payer » reflète désormais le vrai montant dû — la somme des règlements **encore dus uniquement** (acompte + solde + complément + complément de fin de séjour), en excluant ceux déjà payés (y compris les compléments réglés en caisse interne) et l'acompte désactivé. Le tableau affiche les quatre règlements, chacun en vert s'il est réglé / rouge s'il reste dû, pour coller aux fiches de réservation (auparavant le « reste à payer » n'intégrait que l'acompte et le solde).
- Suivi financier — la carte « En attente de règlement » couvre désormais TOUS les séjours terminés
  non réglés, quelle que soit la période sélectionnée (un impayé du mois précédent ne disparaît plus
  de la carte), et compte le restant dû réel (net de commission) au lieu du total de séjour entier —
  plus de double comptage avec « Encaissé », et la carte égale le chip « Paiements en attente » du
  suivi opérationnel à l'euro près. Légende « séjours terminés » ; le détail cliquable suit les mêmes
  règles. (specs/finance-pending-global-remaining.md)
- Dépendances : les **trois paquets sont désormais à `0 vulnérabilité`** et sans majeure en retard.
  Les deux derniers avis ouverts sont levés — `esbuild` 0.27.7 → **0.28.1** (aucune montée de Vite
  n'était nécessaire : la 0.28 était déjà dans la plage `^0.27.0 || ^0.28.0` déclarée par Vite 8, npm
  avait simplement conservé la version présente), et **`react-router-dom` 7 → `react-router` 8.3.0**,
  ce qui clôt l'avis CSRF en mode RSC. En v8 le paquet `-dom` n'est plus publié, tout étant fusionné
  dans `react-router` : les imports de 61 fichiers ont été réécrits, sans autre changement — les 11
  symboles utilisés (`useNavigate`, `useLocation`, `useSearchParams`, `useParams`, `Routes`, `Route`,
  `Link`, `Navigate`, `BrowserRouter`, `MemoryRouter`) portent les mêmes noms. Complété par
  `googleapis` 174.0.1 et `concurrently` 10. 2364 tests serveur, 788 client et 45 E2E verts,
  inchangés ; navigation vérifiée dans le navigateur (URL profonde avec paramètres, lien, paramètres
  de recherche, retour arrière).
- Réservations plateforme : le **« Montant total payé par le client »** (brut) et la **commission** n'étaient pris en compte que dans l'aperçu de la fiche, **pas à l'enregistrement** — du coup le montant stocké (et donc la **comptabilité**) ignorait le brut (ex. Yann P. : 983 € enregistré au lieu de 994 €, net 892 € au lieu de 903 €). Désormais ces montants (ainsi que la plateforme à la création) sont transmis au moteur de prix aussi à la sauvegarde : le total du séjour et le net perçu enregistrés correspondent à la fiche. _(Note : les réservations enregistrées avant ce correctif doivent être ré-enregistrées — ouvrir + Enregistrer — pour mettre à jour leur montant stocké.)_
- A property's **default options** are now always applicable to that property, so the Gîte's offered bed-linen default finally shows on the reservation page (with its bed-configuration card) — for new and existing reservations alike. The included option stays hidden from the public booking form. Previously the bed-config card never appeared on any Gîte reservation.
- **« Gîtes de France » : pluriel canonique + fusion des doublons** (spec `platforms-and-ical-rework.md`, 2026-06-19). La plateforme intégrée par défaut était au singulier « Gîte de France » (`gitedefrance`) ; elle est désormais au pluriel **« GitesDeFrance »** (`gitesdefrance`), la forme singulière restant un simple alias de **couleur** (les anciennes données restent dorées) sans apparaître comme entrée séparée dans les listes. Une migration de données idempotente au démarrage (basée sur le slug, donc tolérante aux variantes singulier/pluriel/avec espaces ou accents) **fusionne automatiquement** les doublons existants en une seule plateforme « GitesDeFrance » : réservations, sources iCal (un seul flux conservé par logement — le flux avec URL gagne, ses réservations sont reliées au survivant) et registre des plateformes (couleur reportée). Aucune perte de réservation.
- Google Calendar : quand l'API Calendar n'est pas activée dans le projet Google Cloud, le message d'erreur nomme désormais la vraie cause (projet + où l'activer) au lieu du générique « pas la permission d'écrire dans cet agenda ».
- The « Agenda cible » label of the Google Calendar picker no longer overlaps the « Choisir un agenda… » placeholder before the first open (label now permanently shrunk).
- The « Connecter mon compte Google » flow now always shows Google's account picker (`prompt=select_account`) — on a multi-account browser it used to silently take the active account, which an Internal app then rejects.
- Réservations plateforme : modifier une réservation ne déclenche plus l'erreur « GROSS_BELOW_NET » lorsque le solde recalculé dépasse un « prix payé client » saisi auparavant et non modifié dans cette édition. La sauvegarde est autorisée si le prix payé n'a pas changé ; une valeur trop basse saisie volontairement reste refusée.
- **"Prix payé par le client" is validated against the balance, not the full stay** (spec `gross-validated-against-balance.md`, 2026-06-08). On platform reservations the gross the guest paid is now required to be ≥ the **solde** (what the platform covers — the extras are collected on arrival in the complément), instead of ≥ the total stay price. A gross covering the accommodation but not the on-arrival complément is no longer wrongly rejected. Server + client thresholds + helper text updated; the platform commission display is unchanged. +3 server tests.
- **Une ressource horaire n'est plus effacée du devis** (spec `hourly-resource-quantity-and-sas-scheduling.md`, 2026-08-17). Activer le « Bain nordique » sur un devis affichait la carte mais n'ajoutait **aucune ligne au résumé ni au total** : le moteur abandonnait la ligne tant qu'aucune séance n'était planifiée. La ressource se vend désormais **à l'heure** (`quantity` = heures vendues, `billedUnits` = heures facturées), le champ « Heures » est de retour sur la fiche et le résumé marque la ligne « à planifier ». Trois défauts corrigés au passage : `GET /api/properties/:id` ne renvoyait pas `resources` — le bloc Ressources était **totalement absent** d'un nouveau devis ; `recomputeDevisQuote` perdait les séances ; `countConflicts` ignorait les séances des réservations, si bien qu'une réservation externe pouvait être créée **par-dessus** un créneau client. Au passage, le planning ressources ne fusionne plus les deux listes en React : le serveur renvoie l'occupation unifiée (`kind: 'booking' | 'session'`), une seule définition de « occupé », partagée avec le contrôle à l'écriture. +63 tests serveur, +12 tests client.
- iCal sync no longer raises a cancellation-to-validate alert when a **past** reservation (checkout before today) drops out of a platform's feed — platforms routinely prune bygone bookings, so its disappearance is not a cancellation. The stale mapping is dropped silently and the past stay is kept. Present/future reservations falling out of the feed still raise an alert (a same-day checkout, `endDate === today`, still counts as a real cancellation).
- **Plateformes iCal dans les menus déroulants** (spec `ical-platforms-in-dropdowns.md`, 2026-06-11). Une plateforme ajoutée dans les imports iCal d'un logement apparaît désormais dans les menus « Plateforme » (formulaire de réservation + formulaire iCal), via le nouvel endpoint `GET /api/platforms` (plateformes connues ∪ table `platforms`). +5 tests serveur.
- iCal sync no longer duplicates imported reservations after a transient bad feed response
  (2026-07-21 Gîtes de France incident): the matching cascade now re-claims reservations by their
  stored feed UID, a suddenly-empty feed is only trusted from the 2nd consecutive empty fetch
  (new `ical_sources.emptyFeedStreak` counter, first hit surfaces as a sync error), non-ICS 200
  bodies are rejected, and matched reservations missing `icalOriginalSummary` are backfilled.
- **iCal/Lodgify import — paid default options are priced immediately** (spec `import-price-default-options.md`, 2026-07-03). A « obligatoire par défaut mais payante » option (property default with `offered = 0`) now lands on a freshly-imported reservation at its real amount instead of 0 € — no more open-and-save just to materialise it. Free (`offered = 1`) defaults stay at 0 and the reservation totals stay unpriced until the operator saves. A later re-sync that changes a still-pristine reservation's stay reprices its options too (a `per_night` default follows the new nights); locked (operator-edited) reservations are never touched. +4 server tests.
- PWA push notifications now reach iOS devices: the VAPID contact subject is a routable address (`mailto:contact@domainesolio.com`, overridable via `VAPID_SUBJECT`) instead of the `.local` domain that Apple rejected with `403 BadJwtToken`, which had silently killed every iPhone notification.
- Blanchisserie : le décompte du linge se base désormais uniquement sur l'option « Linge de lit » /
  « Linge de toilette » **cochée sur la réservation**. Un défaut de propriété ne crée plus de contrat
  linge sur un séjour où l'option n'a pas été cochée — le linge de lit n'étant devenu obligatoire
  qu'en juin 2026 sur la Lodge, les séjours antérieurs ne doivent pas être comptés, et retirer le
  linge d'une réservation doit rester possible. Les options **internes** (« Tapis de bain »), qui ne
  sont jamais écrites sur la réservation, continuent d'être comptées via le défaut de propriété.
  Corrige une incohérence où une réservation était comptée par le défaut de propriété alors que le
  serveur remettait sa configuration de lits à zéro à chaque enregistrement : elle apportait 0 drap
  définitivement, sans le signaler (observé en prod sur 3 séjours Aventura lodge).
- Blanchisserie : la carte du planning signale désormais les séjours qui déclarent du linge de lit
  sans quantité saisie — « N séjour(s) sans quantité de linge saisie — chiffre incomplet » avec une
  puce cliquable par réservation. La carte s'affiche même quand la semaine totalise zéro des deux
  côtés, précisément le cas où l'alerte est utile.
- **Blanchisserie — projection de stock fausse (double comptage des arrivées du jour).** Le moteur de projection comptait les réservations arrivant **le jour même** deux fois (une fois dans l'état initial, une fois au check-in du jour) — gonflant la consommation, affichant un stock propre trop bas dans le planning et déclenchant de **fausses ruptures** sur le dashboard. Corrigé : l'état initial ne compte plus que les séjours arrivés **avant** aujourd'hui ; les arrivées du jour sont prises en compte par le check-in. Spec `linen-inventory-shortage-tracking.md` §3.2 + test de régression.
- Blanchisserie : la projection de stock chargeait les séjours terminés depuis 7 jours seulement, alors que le lot déposé au dernier voyage hebdo remonte jusqu'à 13 jours avant aujourd'hui — le linge des séjours terminés il y a 8 à 13 jours était compté propre pendant la semaine qui suit un voyage. La fenêtre passe à 35 jours (spec `laundry-extra-trip.md` §3.3 règle 14) : le « Disponible après ce dépôt » et l'alerte de rupture peuvent baisser de quelques pièces sur les jours qui suivent un voyage.
- Linen forecast: fixed a phantom « rupture de linge ». When today is a laundry day and a manual linen addition is entered for that same day, the day's drop-off used to overwrite the initial « at the laundry » batch's return record, stranding that linen forever and faking a shortage a week or more later. The same-day drop is now merged with the initial batch so it returns normally.
- Mini planning strip (reservation page): reservation colors no longer bleed under the day-cell border — on a day with a departure followed by another arrival, the departure color showed as a rim along the bottom/right edges and the arrival color along the top/left ones.
- Sécurité : `nanoid` 3.3.17 → 3.3.18 côté client (GHSA-2v37-7h3g-55p8, gravité *high*) — un
  générateur personnalisé appelé avec une taille nulle pouvait boucler indéfiniment. La dépendance
  est transitive et purement outillage de build (`vite` → `postcss` → `nanoid`, marquée `dev`) :
  elle n'est pas embarquée dans le bundle servi aux navigateurs. Correctif verrouillage seul, sans
  changement de `package.json` ; `npm audit` du client repasse à **0** vulnérabilité. L'avis n'avait
  jamais été remonté par Dependabot parce que les **alertes de sécurité sont désactivées** sur le
  dépôt — seules les montées de version hebdomadaires tournent.
- E-mails d'arrivée (J-7 / J-2) : lorsque la **caution est marquée « reçue »** dans la fiche, le rappel « pensez à prévoir un chèque de caution » ne s'affiche plus. Avant, une caution déjà reçue était quand même demandée par le mail J-7 (le signal `cautionNotBanked` se basait uniquement sur l'acompte).
- Emails : un rappel d'avant-arrivée (J-7, J-2…) n'est plus reproposé dans « Emails à envoyer » une fois que le client est arrivé (date de début passée). Avant, la fenêtre de rattrapage de 7 jours continuait de le proposer jusqu'à 5 jours après l'arrivée. Les éventuels mails post-séjour (J+1, etc.) restent proposés normalement.
- **Options fantômes sur la fiche** : une option **archivée** ou **interne** (compteur blanchisserie type « Tapis de bain ») n'est plus ajoutée automatiquement à une nouvelle réservation. Elle apparaissait sur le récapitulatif, était facturée 0, puis disparaissait silencieusement à l'enregistrement — d'où le « Ménage » en double et le tapis de bain visibles côté client.
- **Prestations offertes** : une option comprise dans le tarif affiche désormais son **vrai prix barré** (au lieu de 0,00 €) sur la fiche comme sur le devis, et reste exclue du total. Le client voit ce qui lui est offert et ce que ça vaut.
- **Premières unités offertes** : une option peut avoir ses N premières unités comprises dans le tarif (le pack accueil : 2 petits déjeuners). Le client peut commander tous ses petits déjeuners — seuls ceux au-delà des offerts sont facturés, et le Planning comme le SAS en préparent toujours la totalité. Réservations directes uniquement.
- **Gestion tarifaire** : le calendrier se navigue à l'année via deux flèches encadrant l'année, en grand ; les réglages « Année de départ », « Nombre d'années affichées » et « Retour au logement » sont supprimés. Le tableau des saisons n'affiche plus que les dates à venir, séparées par un discret trait d'année.
- **Carte Recette tarifaire** : toutes les particularités du modèle sont désormais énoncées en clair — saisons et cibles nettes, dégressivité, personne supplémentaire et sa dégressivité, durées mini/maxi, jours de changement, règle des jours fériés, fermetures, ce qui est compris dans le tarif et les unités offertes en direct.
- Paiement en ligne (site) : le client est désormais débité **exactement du montant du devis qu'il a vu** (finalPrice enregistré + taxe de séjour), et non d'un recalcul moteur qui pouvait dériver (ex. ajout automatique d'une option « Linge de lit ») et le surfacturer. Le moteur n'est re-sollicité que pour savoir si la taxe est perçue à l'arrivée. Détecté lors d'un test sandbox de bout en bout (803,60 € facturés au lieu des 789,60 € annoncés).
- Paiement en ligne (site) : le montant réglé inclut désormais la **taxe de séjour** (montant = hébergement + options + ressources + taxe), sauf si la taxe est configurée « perçue à l'arrivée ». Le montant est recalculé par le moteur depuis le devis enregistré (jamais fourni par le client), avec repli sur le total stocké en cas d'erreur.
- **Le bouton de relance demandait la mauvaise échéance.** Sur une ligne « Acompte en retard » dont le
  solde n'était simplement pas encore dû, « Relancer » envoyait une demande de **solde** — et donc un
  lien de paiement pour la totalité, des semaines avant la date prévue. Le type de relance suit
  désormais l'état affiché par la ligne.
- **Le lien de paiement demande ce que le devis affiche** (spec `payment-link-quote-parity.md`, 2026-08-20). Deux écarts d'argent corrigés. (1) Le montant d'un lien Qonto de devis était re-calculé par un assemblage maison qui perdait les moments d'une option à carte — un petit déjeuner ou un repas **disparaissait purement et simplement du montant** —, les heures réservées d'une ressource horaire, les lignes offertes (refacturées plein tarif) et le verrou de prix (devis re-tarifé au tarif du jour). Il passe désormais par `devisModel.recomputeQuote`, le même rejeu que l'écran du devis et le PDF (`devis-pdf-total-parity.md` §3.1). (2) L'écran du devis et son PDF affichaient un acompte calculé sur le total **taxe de séjour comprise**, alors que la ligne stockée, l'email au client, la page Qonto et la même réservation après conversion appliquent `tourist-tax-on-solde.md` : acompte sur l'hébergement seul, taxe entièrement sur le solde. L'affichage reprend maintenant la répartition du moteur. Aucun changement de schéma ; un devis enregistré avant le 23/06/2026 garde la répartition qui lui a été promise jusqu'à son prochain enregistrement.
- **La TVA s'affiche sur la page de paiement Qonto/Mollie** (spec `payment-links-vat.md`, 2026-07-03). Les liens de paiement étaient créés à `TVA 0 %` alors que le taux est paramétré et calculé par le moteur ; la page hébergée affichait « Total HT = Total TTC, TVA 0,00 € ». Les liens envoient désormais un panier d'items HT (séjour/acompte/solde au taux global, taxe de séjour exonérée à 0 %) : Qonto affiche la vraie TVA tout en débitant **exactement** le total GuestFlow au centime (arithmétique entière, résidu d'arrondi absorbé par la ligne à 0 %, garde de contrôle du montant qui échoue plutôt que de facturer faux). Couvre les 3 flux (acompte email, lien admin, paiement plein tarif public). Validé en sandbox : séjour 256,25 € + 9,80 € taxe → 266,05 € débités, TVA 23,30 € affichée.
- **Prix d'option par logement : affiché correctement** (spec `per-property-option-prices.md`, 2026-06-20). Sur la **fiche de réservation**, une option dont le prix dépend du logement affiche désormais le **prix du logement concerné** (le prix unitaire affiché correspond enfin au montant calculé par le moteur ; il retombait à tort sur le prix de base). Sur la **page Options**, la liste affiche les **prix par logement** sous le prix de base (« Logement : X € » par surcharge).
- CI : les workflows épinglent **Node 24.18.0** au lieu de la majeure flottante `24`. Le 2026-08-06,
  la sortie du patch 24.19.0 a rendu `master` rouge — 214 fichiers de tests serveur signalés en
  échec alors que toutes les assertions passaient : les processus crashaient **à la fermeture**, dans
  le code natif de better-sqlite3 (`RemoveEnvironmentCleanupHook … Assertion failed: (env) != nullptr`
  depuis `Statement::~Statement()`). Le même code était vert quelques heures plus tôt sur 24.18.0.
  Correctif d'attente : la vraie sortie est la montée de `better-sqlite3` (encore en `^11` alors que
  la 13.x est publiée) — voir `specs/better-sqlite3-upgrade.md`.
- **Planning-card options are no longer re-priced on an existing booking** (spec
  `devis-extras-parity-and-price-lock.md` §3 rule 13bis, 2026-08-16). A `showsPlanningCard` option
  (petit déjeuner, repas) is billed from its occurrences, so its line was rebuilt on every save and
  escaped the price lock that freezes every other option: raising a catalogue or per-property price
  re-priced reservations already sold and paid, and the difference resurfaced as an unexplained
  « complément de fin de séjour ». The engine now replays the unit price the line was sold at —
  « Utiliser les tarifs actuels » stays the only way to re-price. +7 server tests.
- **Planning: no more false ménage collisions across different days** — the turnover/cleaning conflict on the Planning compared only the time-of-day (HH:MM), so a 10:00 checkout on 8 July was wrongly flagged in red as colliding with a 10:00 arrival on 17 July (same time, 9 days apart). Arrival/departure conflicts (red "ménage" turnover and the blue "arrival during another logement's cleaning") are now computed on the **full date+time** via a new pure `cleaningTurnoverConflict` helper, so only genuine same-window overlaps are flagged. The sidebar **Planning** icon also changes from the broom (cleaning) to a calendar. +5 client tests.
- **Acompte plateforme — n'apparaissait pas sur la fiche.** Quand une plateforme était réglée « Acompte = Oui », la fiche réservation affichait quand même « Pas d'acompte (réservation plateforme — virement unique) » et masquait le bloc Acompte. Le bloc (montant, échéance, « marquer payé ») s'affiche désormais correctement pour une plateforme avec acompte ; le message « pas d'acompte » ne reste que pour les plateformes réglées « Non ».
- **Plus aucune relance de paiement vers un client de plateforme.** Le cron d'envoi automatique
  n'appliquait aucun filtre de canal sur ses ancres `depositDueDate` / `balanceDueDate`, contrairement à
  la passe quotidienne de demande de solde : le modèle « Relance solde » (automatique, actif) pouvait
  donc réclamer à un client Airbnb un solde déjà réglé à la plateforme. Les deux ancres de paiement sont
  désormais restreintes aux canaux propres (direct, Lodgify) ; les emails d'arrivée, eux, partent
  toujours quel que soit le canal.
- **Platform/iCal extras now correctly land in the Complément** (spec `force-extras-complement-on-platform.md` §10 hotfix 2026-06-08). Adding an option to a non-direct (platform/iCal) reservation routed its price into the deposit/balance split while the DB row was flagged `inComplement=1` — an inconsistency where `complementAmount` stayed 0. The pricing engine now forces every extra (options, custom options, resources, auto-options) into the Complément bucket on non-direct platforms (authoritatively, no longer relying on the client to pass the flag), so `complementAmount` reflects them and the deposit/balance excludes them. The planning **arrival tile** now shows a "Complément à percevoir : X€" chip (with "(perçu)" once collected). +2 engine tests, +3 client tests.
- Grille « Prix plateformes » : la ligne Direct utilise le même séparateur que les autres lignes (le trait sous Direct était deux fois plus épais).
- **Paiement plateforme : plus d'écart égal à la taxe de séjour.** Pour les plateformes qui ne collectent pas la taxe de séjour (on la demande au client au check-in → elle est dans le complément), le « net perçu » du bloc « Paiement plateforme » incluait à tort la taxe : il était calculé sur le total séjour (taxe comprise) au lieu du montant pré-arrivée réellement versé par la plateforme. Résultat : un écart systématique égal à la taxe de séjour lors du rapprochement avec le virement reçu. Le net perçu est désormais `pré-arrivée − commission` (la taxe perçue à l'arrivée et les extras réglés sur place, qui vivent dans le complément, sont exclus). Pour les plateformes qui collectent la taxe, la valeur est inchangée.
- Paiement plateforme : pour une réservation dont la taxe de séjour est collectée par la plateforme puis reversée (« platform_reversed »), la taxe est désormais comptée comme une ligne du brut au lieu d'être ajoutée deux fois. Le « Net perçu », le total de séjour et le solde ne sont plus surévalués de la taxe, et la réconciliation avec le virement n'affiche plus un écart permanent égal à la taxe de séjour.
- **Taxe de séjour par plateforme — le changement de mode ne s'appliquait pas.** Quand la table des plateformes contenait un doublon de casse (ex. « Lodgify » et « lodgify »), changer le mode de gestion de la taxe de séjour mettait à jour une ligne mais en affichait une autre → la modification semblait ignorée. Un dédoublonnage par nom canonique tourne désormais à chaque démarrage (fusionne les doublons en conservant les réglages personnalisés, recolle les sources iCal + réservations sur le nom canonique).
- Relecture de la PR : la grille « Prix plateformes » remontait les paliers **affichés** de la
  personne supplémentaire comme s'ils étaient nets (16 € puis 9 € sur la ligne Direct au lieu de
  15 € puis 8 €) — les cibles nettes de la recette sont désormais stockées avec chaque palier et la
  grille se calcule à partir d'elles. Les cibles nettes ne quittent jamais le serveur.
- Le devis / la facture PDF affiche le **Surcoût voyageurs en ligne** (avec la règle des paliers, et
  barré quand il est offert) : le montant vivait jusqu'ici dans le total seul, et un devis avec des
  personnes supplémentaires imprimait un sous-total qui ne correspondait pas à ses propres lignes.
- Les années d'événement sans dates (Ardéchoise 2028…) remontent maintenant sur le **Dashboard**,
  dans la carte « Calendrier saisonnier », en plus de la fiche du logement.
- **Public API: per-property options now include global ("Tous les logements") options** (spec `public-api.md`). `GET /public/v1/properties/:id/options` used a plain `INNER JOIN property_options`, which silently dropped every **global** option (an option linked to no property at all) — so options set to "all properties" in GuestFlow (e.g. breakfast, bathroom linen, the animations) never appeared on the WordPress booking form, even though the pricing engine applies them. `optionsModel.listForProperty` now returns options **linked to the property OR global**, matching the engine's `getApplicableOptions` rule. This also fixes `POST /public/v1/quote` / `booking-requests`, which would have rejected a selected global option as "not applicable". +4 server tests. (Options carry a single base price; GuestFlow has no per-property option price — only the per-property `offered`/free default varies, and the quote engine already handles it.)
- **No duplicate confirmation email on a public online payment** (spec `public-online-payment.md`, 2026-07-02). When the Qonto webhook, the on-demand status poll and the cron poll observed the same paid link at once, the guest could receive the confirmation email (and the admin the conflict alert) twice. `processPaidLink` now runs the effect + email only for the caller that atomically flips the link to `paid`, so confirmation is sent exactly once.
- **Site web : le « Total » affiché correspond au montant réellement débité** (spec `public-online-payment.md`, E2E prod 2026-07-02). Le récapitulatif du bloc de réservation et la page de confirmation affichaient le total **hors taxe de séjour** (`finalPrice`) alors que le paiement en ligne encaisse le total taxe incluse — ex. « Total 210,25 € » affiché pour 220,05 € débités. Les deux affichent désormais `totalStayPrice` ; le récap `/status` renvoie ce champ.
- **Les options « à planifier » (Petit déjeuner, Repas des trappeurs…) sont enfin prises en compte sur le site** (spec `public-planning-options.md`, 2026-07-03). Ces options à créneau (carte planning) étaient **silencieusement ignorées** en réservation publique (sélectionnées mais ni facturées ni enregistrées, car le moteur exigeait des créneaux que le site ne peut pas fixer). Désormais le moteur les facture par **quantité** (quantité × (par personne ? nb personnes : 1) × prix unitaire) et laisse la ligne **non planifiée** ; la notification admin « nouveau devis site » liste les options « à planifier avec le client » pour que l'hôte convienne de l'horaire. Le site affiche le libellé de base de prix, une description dépliable (ⓘ, survol + tap mobile) et la mention « À planifier avec l'hôte ». Les devis admin (créneaux planifiés) sont inchangés. +6 tests serveur.
- Site web : l'aperçu de devis en direct (`/quote`) applique désormais les **options par défaut du logement** comme la demande de réservation — option par défaut **payante** ajoutée au prix, option par défaut **offerte** à 0 €. Avant, l'aperçu pouvait afficher un prix inférieur au montant réellement réservé/facturé pour les logements ayant une option payante par défaut (ex. « Linge de lit »).
- Notifications push (PWA) : corrige un cas où **aucune notification n'arrivait** sur les iPhones abonnés. Si la clé VAPID du serveur a été régénérée, les abonnements des appareils restaient liés à l'ancienne clé et le service de push (Apple) refusait chaque envoi (403). À l'activation, l'app **détecte un abonnement lié à une ancienne clé et se ré-abonne automatiquement** avec la clé courante ; le serveur **journalise désormais la raison du refus** (corps de l'erreur) pour faciliter le diagnostic.
- **Lien de paiement : le montant correspond à l'acompte affiché** (spec `online-payments-qonto.md`, 2026-06-29). Le montant du lien Qonto était lu sur la colonne stockée `depositAmount`, qui pouvait être **périmée** (changement de tarif, devis créé via l'API publique) → écart avec l'acompte montré sur la fiche. Le montant (acompte / solde / total) est désormais **recalculé par le moteur de tarification** (la même source que la fiche et le PDF) au moment de créer le lien, et le devis est enregistré avant la génération du lien. (Ex. vu : 30,72 € stocké → 30,00 € réel.)
- Fixed the « Envoyer la demande d'acompte » action which failed with a server error: the email sender was not imported in the payments controller, so creating + emailing the deposit link threw on every call. The endpoint now sends the email correctly.
- Un-offering an option/resource on a saved reservation whose stored unit price had been lost (legacy data persisted at `0`) now restores the real amount from the current catalog price instead of staying at `0` €. Offered lines also expose the catalog price as their struck-through original price again.
- **Reservation quantities — clearable field + mobile steppers** (spec `reservation-quantity-stepper.md`, 2026-08-01). On the reservation fiche, emptying an option's « Qté » to retype it no longer silently deselects the option: quantity fields now keep a local draft and commit on blur/Enter (an empty field falls back to its minimum). A new generic `QuantityField` component adds `−` / `＋` stepper buttons — tappable on mobile, where native number spinners never render — applied to the option « Qté », resource « Qté »/« Heures », and the Lits doubles / simples / bébé counters. +11 client tests (`QuantityField`, option-quantity-clear regression pin).
- Réglages → Ressources : activer « Planification par séances + tarif horaire » (et saisir les tarifs jour/soir/extérieurs + l'heure de bascule) est désormais bien enregistré. Auparavant ces champs étaient ignorés à la sauvegarde, donc la fiche de réservation continuait d'afficher la simple quantité au lieu de l'éditeur de séances.
- Réservations — une prestation vendue au SAS d'arrivée n'est plus facturée deux fois. Le SAS
  n'écrit plus aucune ligne de facturation parallèle dans le complément de fin de séjour : ce que
  prend le client est l'option activée sur la fiche, point. Les lignes « linge de toilette réglé en
  fin de séjour » laissées par l'ancien parcours (retiré de l'interface le 02/08) sont effacées.
- Comptabilité — un complément d'arrivée déjà encaissé ne peut plus absorber une vente faite pendant
  le séjour : le serveur conserve le montant réellement encaissé au lieu de reprendre celui calculé
  par le navigateur. Sans ça, la même prestation était créditée sur l'écriture « complément » ET sur
  l'écriture « complément de fin de séjour ».
- Saving the « Petit déjeuner » option from the Options page no longer strips its system type (`autoOptionType`) — a single save used to silently kill the planning breakfast card, the SAS breakfast step and the (new) breakfast push.
- The breakfast aggregation window now includes the departure-day morning when the window collapses to that very day (`endDate >= from` instead of a strict `>`), fixing the breakfast push runner and the preparation-popup deep-link for departure mornings.
- **SAS check-in : l'heure du petit déjeuner est enfin prise en compte.** Depuis les cartes petit
  déjeuner par matinée, l'heure affichée sur le planning (et celle de la notification) venait de la
  matinée, pas de la réservation : changer l'heure dans le SAS d'arrivée n'avait donc aucun effet
  visible. La validation du check-in réécrit désormais l'heure de toutes les matinées du séjour ; vider
  le champ les remet sur l'heure par défaut de l'option. (#426)
- **Check-in SAS — no more asking for cleaning already booked** (spec `sas-hide-settled-steps.md`, 2026-08-01). The arrival SAS re-displayed the « Ajouter le ménage » step even when the guest had booked the cleaning option, whenever that reservation used a second, untagged « Ménage » option. Cleaning is now detected via a shared `isCleaningOption` helper (by `autoOptionType='cleaning'` tag **or** by the option name containing « ménage » — the same rule the J-1 email already uses), and the boot seed now tags **every** untyped « Ménage » option instead of stopping at the first. +6 server tests.
- SAS de départ : le ménage n'est plus facturé une seconde fois quand il est déjà vendu (option
  réservée, ligne « Ménage » ajoutée au check-in ou ménage par défaut du logement). La page « le ménage
  de fin de séjour a-t-il été fait correctement ? » disparaît dans ce cas, et le serveur refuse la ligne
  quoi qu'il reçoive. Rejouer le SAS de départ sur un séjour déjà surfacturé supprime la ligne en double.
- **SAS départ : plus de question sur un ménage déjà réglé.** Le client n'indiquait pas au serveur de
  quel bout du séjour il parlait, si bien que le check-out demandait « le ménage de fin de séjour a-t-il
  été fait ? » pour un ménage déjà vendu, ajoutait son tarif au total à percevoir… et le serveur jetait
  la ligne au moment de valider. L'étape disparaît désormais et le récapitulatif indique « Ménage déjà
  réglé — aucune facturation de fin de séjour. »
- SAS wizard: on an installed iOS PWA, the answer buttons could become unresponsive after the phone went to sleep and woke up mid-SAS. The dialog now relaxes its focus trap (`disableEnforceFocus` / `disableRestoreFocus`) so it stays interactive after the page resumes.
- SAS arrivée/départ : correction d'un bug sur mobile où « Suivant » (et « Commencer ») ne réagissait pas, obligeant à cliquer plusieurs fois et faisant parfois sauter des étapes. La gestion du focus de la fenêtre est désormais totalement désactivée (`disableAutoFocus` en plus des réglages existants) pour que les boutons répondent de façon fiable.
- SAS d'arrivée : « Ajouter le ménage » et « Ajouter le linge de toilette » activent désormais la **vraie
  option du catalogue** au lieu de créer une ligne personnalisée. Conséquence corrigée : les serviettes
  vendues au check-in étaient invisibles pour la blanchisserie et le stock de linge (qui comptent le linge
  via l'option), donc jamais préparées ni décomptées. Le montant, lui, était déjà correct. Les options
  posées par le SAS restent retirables en rouvrant le SAS (l'étape se rouvre pré-cochée) et ne sont jamais
  confondues avec une option vendue depuis la fiche.
- Migration : les lignes personnalisées « Ménage » / « Linge de toilette » déjà créées par le SAS sont
  déplacées vers leur option catalogue **au montant exact enregistré** (aucun séjour n'est re-tarifé). Les
  réservations qui portaient déjà l'option sont laissées telles quelles et listées dans les logs.
- Sécurité : montée des dépendances vulnérables — **8 failles « high » éliminées**. Serveur (`npm audit`
  passe de 6 à **0** vulnérabilité) : `sharp` 0.34 → 0.35 (CVE libvips 2026-33327/33328),
  `nodemailer` 8 → 9 (l'option `raw` contournait `disableFileAccess`/`disableUrlAccess`), `multer`
  2.1 → 2.2 (déni de service par champs profondément imbriqués), plus les transitives
  `brace-expansion` (DoS) et `ip-address`. Client : `react-router-dom` → 7.18.2, qui corrige la
  redirection ouverte via antislash dans `<Link>`/`useNavigate`, ainsi que `postcss` (traversée de
  chemin) et `form-data` (injection CRLF).
  **Restent connues et assumées, faute de correctif sans montée majeure :** l'avis CSRF de
  react-router ne concerne que le **mode RSC**, que GuestFlow n'utilise pas (SPA cliente pure), et il
  exigerait react-router 8 ; l'avis `esbuild` est en gravité *low*, limité au **serveur de dev sous
  Windows**, et son correctif viendra avec Vite 8.
- Paramètres : le « Code portail » enregistré s'affiche désormais au chargement de la page (il était sauvegardé mais toujours affiché vide, car absent de la réponse `GET /settings`).
- **Baby bed now visible on a site devis** (spec `site-booking-notifications.md` §3 rule 16, 2026-06-11). A baby bed chosen in the website booking popup was sent as a hidden 0 € "Lit bébé" resource line — which GuestFlow filters out of the supplements list — while the devis `babyBeds` couchage field stayed empty, so the operator saw no baby bed at all. The public API now accepts `babyBeds` (capped at the number of babies) and persists it on the devis `babyBeds` field (Couchage section); the WordPress booking widget sends it as a count, not a resource. +2 server tests.
- **Site booking devis kept full options/resources** (spec `site-booking-notifications.md`, 2026-06-11). A devis created from a public website booking request now keeps **every** option the visitor selected — including options that carry an `autoOptionType` but are not auto-enabled (breakfast, bed/bathroom linen). They were previously dropped by an over-broad pre-filter that assumed any `autoOptionType` option was engine-managed. Property option **defaults** carrying such a type are also fixed (paid → priced, offered → 0 €). The fix is shared with the in-app devis/reservation flow. +5/+2 server tests.
- Sécurité : les réglages qui finissent tels quels dans un en-tête d'email — *Nom expéditeur*,
  *Adresse expéditeur* et le destinataire des notifications — refusent désormais les caractères de
  contrôle. Un retour à la ligne glissé dans le nom expéditeur fermait la ligne `From:` et laissait
  interpréter la suite comme un nouvel en-tête (`Bcc:`, `Content-Type:`…). L'enregistrement renvoie
  maintenant une erreur sous le champ concerné (*« Caractère interdit (retour à la ligne ou
  caractère de contrôle). »*) au lieu de stocker la valeur. Les espaces et retours à la ligne en
  bordure restent tolérés et sont nettoyés à l'écriture, pour qu'une adresse copiée-collée depuis
  une messagerie passe sans friction ; les accents et tirets cadratins ne sont pas concernés
  (`Gîte Solio — été` reste un nom valide).
- **Une réservation garde le tarif sous lequel elle a été vendue.** Changer une recette ne re-tarife
  plus ce qui est déjà en base, même en rouvrant et ré-enregistrant la réservation : le supplément
  voyageurs et les unités offertes sont désormais figés à la création, comme l'étaient déjà les nuits
  et les lignes d'options. **Les réservations déjà en base sont figées elles aussi**, par une
  migration qui les estampille au tarif en vigueur au moment de la mise à jour — celui sous lequel
  elles ont été vendues, puisque la recette n'est appliquée qu'après le déploiement. C'est la RÈGLE
  qui est figée, pas le montant — ajouter un voyageur recalcule le supplément, à l'ancien tarif.
  « Utiliser les tarifs actuels » reste le moyen délibéré de re-tarifer.
- Un **jour férié tombant un samedi** fait désormais passer sa nuit en saison supérieure (1er mai
  2027, 8 mai 2027…). Il ne forme aucun pont — le samedi est déjà chômé — donc une seule nuit et
  aucun minimum de séjour imposé. Un férié un dimanche continue de ne rien déclencher.
- La grille « Prix plateformes » n'affiche plus **Lodgify en ligne séparée** : c'est la ligne Direct,
  dont la commission est justement celle du moteur.
- Ni les **options** : une réservation déjà vendue garde ses lignes, leurs prix et son total quand
  une option devient « comprise dans le tarif » ou gagne des unités offertes, et une sauvegarde
  n'y greffe jamais les nouvelles options par défaut du logement.
- Fiche réservation — sur une résa plateforme, le résumé affiche désormais l'acompte et le solde
  **bruts** (ce que le client paie) sous les libellés « Montant acompte / solde payé par le client »,
  au lieu du montant net de la commission (qui faisait apparaître un acompte de 122,97 € comme
  119,56 € et ressemblait à un bug). La commission par échéance et le « Versement plateforme » (net
  perçu) restent détaillés dans la cascade juste au-dessus. (specs/platform-per-echeance-commission.md)
- Réservations : sur une réservation déjà créée, changer l'heure d'arrivée ou de départ recalcule maintenant le tarif de l'arrivée anticipée / du départ tardif (au prorata) — il restait figé sur l'ancien montant. Le cas « offert » met aussi à jour sa valeur sous-jacente. Le tarif de la nuit, lui, reste verrouillé comme avant.
- Toast notifications no longer slide half off-screen to the left on desktop (the mobile full-width override applied to every viewport while MUI's centering translate stayed) — long error toasts looked like an empty box with only a close cross.
- **Taxe de séjour : plateformes multi-mots correctement prises en compte** (spec `platforms-and-ical-rework.md` / `per-platform-tourist-tax-collection.md`, 2026-06-19). Pour une plateforme dont le nom contient un espace/accent (ex. « Gîtes de France ») configurée en « collectée par vous », le toggle était silencieusement ignoré sur une réservation **saisie manuellement** : la taxe était à tort retirée du total **et** absente du « Suivi taxe de séjour » à reverser. La résolution du toggle (`pricing.js`) et la requête d'extraction (`financeModel.getTouristTaxExtraction`) comparent désormais le `platform` de la réservation au `platformKey` **ou** au `platformLabel` de la source (les imports iCal stockent la clé à tirets, les saisies manuelles le libellé concaténé). +2 tests serveur.
- Fiche réservation : le bouton **« Recalculer la taxe de séjour »** (résa passée) recalcule désormais immédiatement sur les **montants en cours**, même non enregistrés. Avant, le recalcul ne se faisait qu'après avoir enregistré la fiche (dépendance manquante dans le memo du devis live).
- Tourist-tax extraction page: the « Dates réservation » column now shows the reservation's real stay dates (arrival → departure, like the fiche réservation) instead of subtracting a day — a 1-night stay 20/06 → 21/06 no longer renders as « 20/06 au 20/06 » (specs/tourist-tax-declared-checkbox.md).
- Page « Suivi taxe de séjour » : le **mois en cours** s'affiche désormais réellement. Le sélecteur l'autorisait déjà mais le serveur le refusait encore avec « Seuls les mois déjà passés sont autorisés. » — seuls les mois **futurs** sont maintenant rejetés.
- Le pack accueil de l'Aventura Lodge (les premiers petits déjeuners et le jus de pomme compris dans
  le tarif) ne se déclenchait que sur les réservations enregistrées sous « direct », alors que la
  majorité des réservations directes passent par le moteur Lodgify. Les deux canaux y donnent
  désormais droit ; les canaux commissionnés facturent toujours la totalité.
- Le pack est complet : 2 petits déjeuners + 1 jus de pomme 1 L, soit les 25 € annoncés. Le petit
  déjeuner passe à 10 € à la Lodge (le Gîte reste à 8 €). Les réservations déjà enregistrées gardent
  leur prix figé.
- **WordPress plugin: the booking form now lists paid add-on options** (spec `wordpress-plugin.md`, plugin 1.2.0). The booking block previously hid **every** auto-option, which dropped genuine paid add-ons (bed linen, bathroom linen, breakfast) and left only fully-manual options (e.g. cleaning). It now hides **only** the time-derived auto-options (`early_check_in` / `late_check_out`, already covered by the arrival/departure fields) and shows all other options, including paid ones. Per-person prices now display their unit (`/ pers.`, `/ pers. / nuit`). The public API already returned every option linked to the property — this was purely a client-side filter. (Options still need to be linked to the property in GuestFlow to appear.)
- Widget de réservation du site : une option choisie dans un menu dépliant restait rangée dans la
  partie repliée au lieu de remonter parmi les lignes toujours visibles, et le libellé du menu
  continuait d'annoncer le nombre total d'options. Replier la catégorie masquait donc une ligne que
  le visiteur venait d'ajouter à son devis. La ligne remonte désormais immédiatement, le compteur et
  le libellé (« Voir les 8 autres ») se mettent à jour, et le bouton « + » garde le focus clavier.

### Removed
- **Dead `deploy.sh` script** removed at the repo root (2026-06-04). The script was
  superseded by the GitHub Actions self-hosted runner (`.github/workflows/deploy.yml`)
  back in April 2026; nothing in the repo still referenced it. Removing keeps the
  surface area honest and was tactically convenient — it also hardcoded the Pi's LAN IP,
  which would otherwise have needed parameterising for the anonymisation pass below.
- **Legacy "Accès comptable" card** in `/parametres` (`SettingsAccountantAccessSection.js`). Its
  single-purpose "create the accountant + show the temp password on screen" hack is canonicalized
  by `/comptes` (admin only) where the temp password is emailed instead. The schema column
  `users.role` is dropped in the same migration — see Migration below.
- **"Extraction Taxe de séjour" navigation card on `/finance`** — the same page is reachable from
  the sidebar (Suivi financier → Taxe de séjour), so the redundant card on the overview was just
  noise. The Suivi page itself is unchanged.
- **Dead `recalcPrice` wrapper** in `ReservationPage.js` — a no-op (`return { ...updatedForm }`) left over
  after the pricing engine moved server-side (Bloc 2). Its 9 call sites now spread the form directly.
  Behavior-preserving; closes out the client-side pricing logic removal.
- **`devis_*` tables** (`devis`, `devis_options`, `devis_custom_options`, `devis_resources`,
  `devis_nights`, `devis_history`) — folded into the `reservations` family (`kind='devis'`). Data migrated
  (see Migration).
- **`GET /api/finance/pending`** — folded into the new `/finance/operational` (its only consumer was
  FinancePage). The endpoint now returns `404`.
- **Client-side payment math** — both `FinancePage.getRemainingDue` and `Dashboard.getRemainingDue`, plus
  FinancePage's client-side overdue derivation + upcoming-by-property grouping (now server-computed).
- **Client-side public-holiday computation** (`getFrenchPublicHolidays` in `client/src/frenchHolidays.js`)
  — moved server-side; the file now keeps only the `getSchoolHolidayInfo` lookup.
- **Dead `PRICE_TYPE_LABELS` constant in `CalendarPage.js`** — leftover from the removed reservation
  dialog, referenced nowhere.
- **Dead `client/src/pages/DevisForm.js` (501 LOC)** — unrouted and imported nowhere (all devis editing
  goes through `ReservationPage ?mode=devis`). Removed during the devis MVC refactor.
- `db.getAppSettings` / `db.upsertAppSettings` (logic moved to `settingsModel`). `database.js` keeps only DDL + migrations + the singleton bootstrap for `app_settings`.
- Logements : retrait de la carte « Options incluses » de la fiche logement (Paramètres → Logements). Les options incluses par défaut se configurent désormais uniquement depuis la page Options.

### Migration
- `properties.nameArticle` added (`ALTER TABLE properties ADD COLUMN
  nameArticle TEXT DEFAULT 'au'`), idempotent at boot. Existing rows
  backfill to `'au'`; no data loss.
- Shipped J-7 reminder content migrations (idempotent, scoped to the
  `arrival_reminder_7d` template; operator templates + the
  "- Logement : {{propertyName}}" line untouched): rewrites the legacy
  `séjour à {{propertyName}}` phrasing to `séjour {{propertyWithArticle}}`,
  and the `{{companyName}}` signature to `{{senderName}}` — so installs
  seeded before these features pick up the article-aware + sender-name
  defaults.
- **`ical_cancellation_alerts`** — new table (id, reservationId, sourceId, eventUid,
  detectedAt, acknowledgedAt, outcome). Three partial indexes on `acknowledgedAt IS NULL`
  (Dashboard listing, per-reservation UPSERT, per-event auto-resolve lookup). Created
  idempotently on first boot. Empty on existing installs.
- **VAT schema collapse** — `app_settings` gains a new column `vatRate REAL NOT NULL DEFAULT
  10`; the migration seeds it once from the legacy `vatRateAccommodation` value (prod has
  10 % there → no behavioural surprise), then DROPs both `vatRateAccommodation` and
  `vatRateStandard`. Idempotent on re-runs (the DROP guards on `cols.includes(...)`).
  SQLite ≥ 3.35 (well below the Pi's bundled version) supports DROP COLUMN.
- **`ical_date_drift_alerts`** — new table (id, reservationId, previousStart/End,
  newStart/End, detectedAt, acknowledgedAt, outcome). Created idempotently on first boot.
  Two partial indexes on `acknowledgedAt IS NULL` for the Dashboard listing and the
  per-reservation UPSERT lookup. Empty on existing installs.
- **6 new columns on `app_settings`** for the linen-inventory feature: `bedLinenStock
  Single / Double / Baby`, `towelStockLarge / Medium / Small` — all `INTEGER NOT NULL DEFAULT
  0`. Idempotent ALTER TABLE; existing installs see 0 everywhere = "no type tracked" = no UI
  change.
- **`property_option_defaults`** (§3.7) — new table created on first boot, primary key
  `(propertyId, optionId)`, ON DELETE CASCADE on both FKs. Empty on existing installs; no
  data migration needed. Decoupled from the existing `property_options` table to preserve the
  current "global option = available everywhere" semantic.
- **`users.emailChangedAt`** (`TEXT NULL`) added by an idempotent ALTER TABLE in
  `server/src/database.js`. Stamped by `updateUser` whenever the email column is rewritten.
  Existing users see `NULL` → no banner, no behaviour change until they actually change their
  email.
- **`options.countsAsBedLinen`**, **`options.countsAsBathroomLinen`** (both `INTEGER NOT NULL
  DEFAULT 0`) and **`app_settings.laundryWeekday`** (`INTEGER NOT NULL DEFAULT 2`) added by
  idempotent ALTER TABLE in `server/src/database.js`. Existing options default to "not a linen
  option" on both flags (the feature stays silent until Adrien ticks them). Default weekday =
  Tuesday.
- **§3.5.ter** adds six more columns on `options`, all idempotent ALTER TABLE:
  - `linenIncludesSingle`, `linenIncludesDouble`, `linenIncludesBaby` (INT 0/1, default 1)
  - `towelLargePerPerson`, `towelMediumPerPerson`, `towelSmallPerPerson` (INT ≥ 0, defaults
    1 / 0 / 1)
  Defaults match the pre-existing semantic so no row needs backfill.
- **Admin account management:** `users` gains `firstName`, `lastName`, `companyName`, `notes`
  (all `TEXT NOT NULL DEFAULT ''`) and `lastLoginAt TEXT NULL`. New `user_roles(userId, role)`
  table with `ON DELETE CASCADE`. On boot, existing single-role values are backfilled into the
  join table and the legacy `users.role` column is dropped (native `ALTER TABLE DROP COLUMN`
  supported by better-sqlite3 v11). `app_settings` gains 8 SMTP/public-URL columns
  (`smtpHost`, `smtpPort` default 587, `smtpSecure` default 0, `smtpUsername`,
  `smtpPasswordEncrypted` — AES-256-GCM at rest —, `smtpFromEmail`, `smtpFromName` default
  `'GuestFlow'`, `publicUrl`). Idempotent; replaying the migration on an already-migrated DB is a
  no-op.
- **Per-platform tourist tax collection:** `ical_sources` gains
  `collectsTouristTax INTEGER NOT NULL DEFAULT 1`. The default `1` preserves the prior
  hardcoded behaviour (non-direct = platform collects = tax offered) until the owner explicitly
  flips a source to `0` on the property page. Idempotent.
- **Complément à percevoir columns:** `reservations` gains `complementAmount REAL NOT NULL DEFAULT 0`,
  `complementPaid INTEGER NOT NULL DEFAULT 0`, `complementPaidDate TEXT`. For existing fully-paid
  reservations (`depositPaid = 1 AND balancePaid = 1`), `complementAmount` is backfilled to
  `max(0, finalPrice + touristTaxTotal − depositAmount − balanceAmount)` so any silent gap from
  before this fix is visible the moment the migration runs.
- **Reservation payment dates + platform gross:** `reservations` gains `depositPaidDate TEXT`,
  `balancePaidDate TEXT` and `clientGrossAmount REAL`. Paid-dates are backfilled once from the
  corresponding due-dates for rows already marked paid (sensible accounting date for legacy data);
  `clientGrossAmount` stays NULL on existing rows. Idempotent.
- **Global VAT rates:** `app_settings` gains `vatRateAccommodation` (default 10) and `vatRateStandard`
  (default 20). Backfilled once from any existing property's `vatPercentageAccommodation` (→
  accommodation) and `vatPercentageOptions` (→ standard) so a single-gîte install keeps its configured
  values; the per-property `vatPercentage*` columns are then **dropped** via `ALTER TABLE … DROP COLUMN`.
  Migration is defensive (skips backfill if old columns absent) and idempotent.
- **Devis ↔ Reservation fusion (one-time, backed up):** on boot, `reservations` gains
  `kind`/`devisNumber`/`devisStatus`/`validUntil`/`convertedReservationId` (+ a unique index on
  `devisNumber` and a `kind` index). If the legacy `devis` table exists, the DB is first copied to a
  timestamped `*.pre-devis-fusion-*.bak` backup, then `migrateDevisIntoReservations` folds every devis into
  `reservations` (`kind='devis'`) with its options/custom options/resources/nights/history moved into the
  `reservation_*` children — insert + verify + drop run in one transaction (all-or-nothing). Idempotent
  (skips once `devis` is gone). Rollback = restore the `.bak`. Existing reservations are untouched.
- **Resource applicability pivot (Bloc 1):** new `resource_properties` table (`resourceId`, `propertyId`).
  On boot, `migrateResourcePropertiesFromJson` backfills it from the legacy `resources.propertyIds` JSON
  (empty stays global; stale property ids skipped), then drops the `propertyIds` column. Idempotent;
  lossless.
- **Clients single-phone (Bloc 1):** the legacy multi-number `clients.phoneNumbers` JSON column is
  dropped. On boot, `migrateClientPhonesToSingle` keeps each client's **first** listed number in the
  scalar `phone` (extras discarded) before the column is removed; idempotent (no-op once gone). Locally
  lossless (0 clients had >1 number); in prod, multi-number clients keep only their first number.
- **Users + sessions (Bloc S):** new `users` table (`CREATE TABLE IF NOT EXISTS` + `uniq_users_email`)
  seeded with the default admin on first launch (`mustChangePassword = 1`); a `sessions` table is
  created by `better-sqlite3-session-store`. Existing Google credentials in `app_settings` are
  encrypted in place once on boot (idempotent, tagged `enc:v1:`); `server/.env.local` gains
  auto-generated `GUESTFLOW_ENCRYPTION_KEY` and `GUESTFLOW_SESSION_SECRET` (git-ignored).
- `school_holidays` table gains three additive columns: `externalRef TEXT`, `isLocked INTEGER NOT NULL DEFAULT 0`, `lastSyncedAt TEXT` (idempotent `ALTER TABLE ADD COLUMN` block). Existing rows: `externalRef = NULL`, `isLocked = 0`. New singleton table `school_holidays_sync_state` auto-created. New index `idx_school_holidays_externalRef` added via the DB hygiene catalog.
- New table `establishment_closures` auto-created on boot via the existing `CREATE TABLE IF NOT EXISTS` pattern. No data migration needed — the table never existed before.
- On boot, the DB hygiene pass attempts to drop the legacy `resources.propertyId` column. SQLite refuses to drop a column that is part of a `FOREIGN KEY` definition, so on existing databases the column stays in the schema but is no longer read or written by any code — an info log explains this is harmless. Fresh installations / minimal test schemas without the FK definition do drop the column cleanly.
- New `linen_priced_items` table (priced linen elements + towels for the SAS). Additive.
- `reservations` gains `endOfStayComplementAmount` / `endOfStayComplementPaid` / `endOfStayComplementPaidDate` / `endOfStayComplementDetail` (idempotent ADD COLUMN, default 0/null) — the departure SAS's separate end-of-stay complement.
- `app_settings.portalCode` (domain gate code shown on the arrival SAS).
- Le boot crée l'option catalogue **« Lit bébé »** (`autoOptionType = 'baby_bed'`, 5 €, par séjour) et la relie à chaque logement. Seed idempotent et non destructif : une option déjà typée n'est jamais réécrite (titre, prix et prix par logement restent ceux de l'opérateur), une option « Lit bébé » créée à la main n'est pas absorbée mais signalée au démarrage. Aucune donnée existante n'est modifiée — les réservations et devis déjà enregistrés avec des lits bébé conservent leur total.
- **Options — colonne `isCancellationInsurance`** (spec `cancellation-insurance.md`). Ajout
  idempotent au démarrage (`0` par défaut), plus l'insertion d'une option « Assurance annulation »
  **non tarifée** (0 %) rattachée à tous les logements. Aucune donnée existante n'est modifiée : tant
  qu'aucun tarif n'est saisi, ni les fiches ni le site ne changent. Une option maison déjà nommée
  « Assurance annulation » / « Garantie annulation » est **adoptée** (prix, périmètre et libellé
  conservés) plutôt que dupliquée.
- `reservation_options` gagne `cardPersons` (REAL, nullable — ALTER gardé) : le nombre de personnes servies sur chaque moment d'une option à carte facturée par personne. `NULL` = toute la tablée, c'est-à-dire le comportement de toutes les lignes existantes — aucun backfill, aucune réservation ni aucun devis re-tarifé.
- Colonne additive `clients.emailLanguage` (`fr` par défaut). La colonne `reservations.emailLanguage` est conservée comme repli transitoire.
- Deux réparations de données au démarrage, sur les réservations touchées par les doublons de
  complément corrigés ci-dessus. La base est sauvegardée avant migration par le déploiement.
  - `endOfStayComplementDetail` / `endOfStayComplementAmount` : les lignes « linge de toilette »
    écrites par l'ancien report en fin de séjour sont supprimées et le montant recalculé sur les
    lignes restantes (les marqueurs de paiement ne sont jamais touchés). Idempotent.
  - `complementAmount` : un complément d'arrivée encaissé qui avait absorbé une vente en séjour est
    réduit de la part déjà facturée par le complément de fin de séjour. **Passage unique**, verrouillé
    par la table `migrations` (`frozen_complement_midstay_repair_v1`) — la correction soustrait, la
    rejouer entamerait le montant à chaque démarrage.
- **`reservations.depositAmountOverride`** (nullable REAL) — stores the operator's manual deposit amount; `NULL` = automatic. Additive and idempotent; existing rows default to `NULL` and keep the previous percentage-based behaviour. No backfill.
- Colonnes additives : `email_templates.subjectEn` / `bodyEn` (version anglaise optionnelle) et `reservations.emailLanguage` (`fr` par défaut). Les deux rappels d'arrivée par défaut reçoivent leur traduction anglaise au démarrage si elle est absente (le français existant n'est jamais modifié).
- New `email_manual_queue` table (idempotent `CREATE TABLE IF NOT EXISTS`, FK cascade to `email_templates` + `reservations`) for on-demand queued emails. Purely additive.
- Boot seed tags the existing **"Ménage"** option with `autoOptionType = 'cleaning'` (idempotent, untyped rows only) so the J-1 reminder can detect whether cleaning was booked. Side effect: the tagged option becomes non-deletable in Paramètres → Options (like the linen/breakfast options).
- `email_log` gains a `channel` column (`TEXT NOT NULL DEFAULT 'smtp'`, idempotent `ADD COLUMN`) recording how a logged email left: `'smtp'` (sent by GuestFlow) or `'manual'` (marked sent by the operator). Historical rows default to `'smtp'`. No status CHECK change.
- `email_log` devient une **fenêtre roulante** : une tâche quotidienne supprime physiquement les lignes dont la réservation a dépassé la date d'arrivée + 3 jours (et les lignes orphelines). Au premier démarrage après mise à jour, les anciens logs hors fenêtre sont purgés. Aucune donnée de réservation/client n'est touchée.
- `app_settings.fiscalYearEndMonth` (INTEGER NOT NULL DEFAULT 12) — mois de clôture de l'exercice comptable (spec `fiscal-year-and-nights-sold.md` §5). Ajout idempotent au démarrage. Le défaut 12 reproduit exactement le comportement antérieur (année civile) : aucune donnée n'est réécrite, aucun backfill, et les totaux annuels ne bougent tant que le mois n'est pas changé depuis Paramètres.
- `app_settings` gains 7 Google OAuth columns (`googleOAuthRefreshTokenEncrypted` — AES-256-GCM encrypted —, `googleOAuthConnectedEmail`, `googleOAuthConnectedAt`, `googleCalendarSummary`, `googleLastSyncAt`, `googleLastSyncOk`, `googleLastSyncDetail`). The legacy service-account credential values (`googleServiceAccountEmail`, `googleServiceAccountPrivateKey`) are **cleared** by a one-shot idempotent migration (columns physically kept), along with any `googleCalendarId` stored while no OAuth connection exists (service-account-era leftover — prevents the first connect from silently syncing to the old target calendar); the mechanism is removed and the credentials remain recoverable in the Google Cloud Console.
- `reservations.arrivalExtrasBaseline TEXT DEFAULT NULL` — instantané JSON des extras au démarrage du
  séjour (`{ "opt:9": 24, "custom:linge manquant": 18 }`), base de comparaison pour détecter les
  prestations vendues en cours de séjour. Ajout idempotent au boot, purement additif : les
  réservations existantes valent `NULL`, donc rien n'est requalifié rétroactivement et aucun montant
  déjà enregistré n'est recalculé. Aucun backfill.
- `reservations.midStaySettledNotes TEXT DEFAULT NULL` — registre JSON des notes encaissées pendant
  le séjour (`[{ id, paidDate, paidCash, total, lines[] }]`). Ajout idempotent au boot, purement
  additif : les réservations existantes valent `NULL` (aucune note), donc comportement inchangé.
  Encaisser une note ne fait que **déplacer** des montants déjà stockés entre le détail du complément
  de fin de séjour et le registre, dans une seule transaction — l'invariant « reste + registre = tout
  ce qui a été vendu en cours de séjour » tient à chaque étape. Aucun backfill, aucune perte.
- `app_settings`: two new non-secret columns `notificationsEnabled` (INTEGER, default `1` = ON) and `notificationRecipientEmail` (TEXT, default `''`). Added idempotently on startup; safe defaults mean existing installs get notifications ON with the recipient falling back to the SMTP sender. No data backfill.
- `options` gagne deux colonnes : `category` (libellé de regroupement, `''` = aucun) et `seedKey`
  (identité stable des articles seedés, pour qu'un renommage ne crée pas de doublon au redémarrage).
  Ajout idempotent au boot, valeur par défaut `''` sur les lignes existantes — aucun impact sur
  l'affichage des options déjà en place.
- Migration one-shot `option_categories_v1` : les 5 options « Animation… » passent en catégorie
  `Animations`, « Le repas des trappeurs » en `Restauration`. Les options portant déjà une catégorie
  ne sont pas touchées. Aucune réservation, aucun prix, aucun total n'est modifié.
- **Échéancier de paiement** (spec `payment-schedule-and-cancellation.md`). Au démarrage :
  `properties.depositDueDays` (défaut 7) et `properties.cancelAfterBalanceDueDays` (défaut 7) sont
  ajoutées, `balanceDaysBefore` passe **une seule fois** à 30 pour les logements en dessous (migration
  `balance_days_before_30_v1`, une valeur choisie ensuite n'est plus écrasée), et `depositDaysBefore`
  est supprimée — plus aucun lecteur. `reservations` gagne `cancelledAt`, `cancellationReason`,
  `cancelledBy` et `paymentAlertSnoozedUntil` ; son `kind` accepte la valeur `cancelled`, qui retire la
  ligne de toutes les lectures opérationnelles tout en la laissant visible à la comptabilité.
  `cancellation_compensations` gagne `origin` (`platform` | `retained_deposit`). Le mail
  « Relance acompte », déjà installé, est recalé sur l'échéance d'acompte (migration
  `deposit_reminder_anchor_v1`) : sans cela il aurait cessé d'être programmé en silence. Aucune
  réservation existante ne voit ses dates d'échéance recalculées.
- **Modèles d'email `deposit_reminder` et `balance_reminder` basculés en envoi manuel**
  (`payment_templates_manual_v1`). Les modèles n'étant semés qu'une fois, une base existante conserve
  le mode avec lequel ils sont nés : sans cette migration les deux relances auraient continué de
  partir seules à 8 h après le déploiement. Seul `sendMode` est touché — le texte, l'ancre, le décalage
  et l'activation restent ceux de l'opérateur, et une relance désactivée le reste.
- **`ical_sources.touristTaxRemittedByPlatform`** (INTEGER NOT NULL DEFAULT 1) ajoutée au démarrage (idempotent). `1` = la plateforme reverse la taxe à la commune elle-même (on n'y touche pas) ; `0` = c'est vous qui la reversez. Backfill au boot : `UPDATE ical_sources SET touristTaxRemittedByPlatform = 0 WHERE collectsTouristTax = 0`, de sorte que chaque source conserve exactement son comportement actuel (les plateformes « collecte » restent masquées du Suivi, les « à l'arrivée » continuent d'y figurer) tant qu'on ne choisit pas explicitement le nouveau mode « reversée à vous ». Aucune réservation ni donnée financière n'est réécrite.
- **`platforms.color`** (TEXT, nullable) — couleur d'affichage globale par plateforme. NULL ⇒ couleur intégrée par défaut. Backfill unique depuis les couleurs personnalisées existantes (`ical_sources.platformColor`). **`ical_sources.disabled`** (INTEGER NOT NULL DEFAULT 0) — masque par (logement, plateforme) des réservations dans les vues du logement (indépendant de `isActive` / de la disponibilité). **`ical_sources.lastSyncCounts`** (TEXT, nullable) — JSON des compteurs de synchro par catégorie (créé / màj / annulation / verrouillé / inchangé / ignoré) pour l'affichage visuel de l'état. **`ical_sources.url`** est désormais optionnelle (chaîne vide autorisée = pas de synchro). Migrations additives idempotentes, aucune perte de données.
- **`reservations.requestOrigin` column added** (spec `public-api.md`, 2026-06-08). Additive, nullable `TEXT`; `NULL` for every existing row, `'public'` for booking requests created via the public API. Idempotent `ALTER TABLE` in `database.js`. No data loss or behavior change for existing records.
- **`properties.publicDepositEnabled INTEGER NOT NULL DEFAULT 0`** (spec `public-online-deposit.md` §5) — active le mode « acompte en ligne » du site logement par logement. `ADD COLUMN` idempotent dans `database.js` ; défaut 0 → tous les logements existants gardent le paiement unique tant que l'opérateur ne l'active pas.
- **`reservations.publicToken TEXT`** (nullable) — per-devis capability token for the public online-payment routes (spec `public-online-payment.md` §7). Idempotent `ADD COLUMN` in `database.js`; NULL on all existing/non-public rows (tokens are minted only for new WordPress booking requests).
- Les numéros de réservation existants au format d'origine `AAAA-MM-###` sont reformatés en `AAAAMM###` au démarrage. Les numéros personnalisés ou non conformes sont laissés tels quels ; aucun reformatage en cas de collision.
- **`resources.heatUpMinutes` + `resources.heatRetentionMinutes`** (`INTEGER NOT NULL DEFAULT 0`, ADD COLUMN idempotent dans `database.js`). Les lignes existantes reçoivent `0` / `0`, ce qui **reproduit exactement la disponibilité actuelle** — aucune ressource ne change de comportement tant que l'opérateur ne renseigne pas les deux champs dans Réglages → Ressources (bain nordique : typiquement 240 / 480). Aucune ligne réécrite ; en revanche, un devis dont la ressource horaire avait été silencieusement perdue verra son total **augmenter** à son prochain enregistrement — c'est le correctif.
- `reservations` gains `breakfastBread` (REAL, half-baguette steps) and `breakfastNotifiedDate` (push guard); `options` gains `breakfastNotifyLeadMinutes` (INTEGER DEFAULT 30) — and the previously schema.sql-only `breakfastTime` column is now backfilled on older DBs; `user_push_prefs` gains `breakfast` (INTEGER DEFAULT 1). All defaults safe for existing rows.
- `reservations` gains `breakfastMilk`, `breakfastPastries`, `breakfastCereals` (INTEGER NOT NULL DEFAULT 0) — guarded ALTERs, default 0 for every existing row, no data impact.
- **`tariff_change_events`** — nouvelle table (spec `tariff-change-journal.md` §5), créée au démarrage avec son index. **Rattrapage en une passe :** chaque logement portant une recette et sans aucun événement reçoit une ligne `recipe` datée de `properties.updatedAt`, marquée `source = 'backfill'` avec une note précisant que la date est **déduite de la dernière modification de la fiche, pas observée** — c'était la dernière occasion de récupérer la date de la refonte tarifaire de l'été 2026 avant qu'un enregistrement de fiche ne l'écrase. Aucune donnée existante n'est modifiée : le journal n'écrit que dans sa propre table et n'entre dans aucun calcul de prix.

