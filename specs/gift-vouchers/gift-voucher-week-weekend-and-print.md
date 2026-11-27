# Gift vouchers — week and weekend rates, value-based redemption, card backs, print sheets

| | |
|---|---|
| **Status** | Implemented |
| **Owner** | Adrien |
| **Created** | 2026-11-27 |
| **Revised** | 2026-11-27 (owner's answers Q1–Q8 and second review: one external price grid, no duplicate price fields, validity menu, 2 h + drink, 8 per sheet, price on the merchant front) |
| **Branch** | `feature/gift-voucher-week-weekend` |
| **Builds on** | `specs/gift-vouchers/gift-voucher-campaigns.md` (rules 2, 4, 11, 13–15, 33, 41, 49–50, 63, 66), `specs/resources/hourly-extra-hour-rates.md`, `specs/site/site-outside-resource-booking.md` |
| **Summary for validation** | `docs/specs/2026-11-27-gift-voucher-week-weekend-and-print.html` (interactive, French) |

---

## 1. Context

Request of 2026-11-27. The bath vouchers sell « 1 h journée » (50 €) and « 1 h soirée » (70 €), and
the outside sessions have one price per band whatever the day. The owner wants a weekend price, the
giver choosing a week or a weekend voucher, a redemption that settles the difference both ways, a
hand-made voucher whose validity is picked from a short list, redrawn card backs, the « à partir
de » price on the merchant card front, and printing several cards per sheet, two-sided or folded.

What exists today (2026-11-27, master):

- **Validity.** A campaign holds `validityMonths` (1–120, default 18); a voucher freezes only
  `expiresOn` at issue (`issuance.js:56`). « Nouveau bon » exposes « Validité » for « Sur mesure »
  only (`NewVoucherPage.jsx:229`). « Prolonger » changes an issued voucher's end date.
- **Prices of an hourly resource, spread over three sections of the resource panel**
  (`ResourceEditorPanel.jsx`, `HourlyResourceFields.jsx`):
  - « Prix »: « Prix de base » (`price`, the guests' day first hour) and « Prix par logement » (a
    price and a « 1re heure offerte » per lodging, `property_resource_prices`);
  - « Horaires »: a « Clients hébergés » grid whose day first hour repeats `price` read-only
    (« Prix général »), and a « Clients extérieurs » grid whose first hours fall back to the guests'
    when empty or 0 (« Vide / 0 = tarif logés »);
  - empty following-hours fields mean « same as the first hour ».
  The same price is thus shown in two places, and an outside price can silently be a guest price.
- **No price depends on the weekday**; `sessionQuote.quoteSession` prices on a placeholder date.
- **Redemption.** A slot is « Inclus » or « + x € soirée »; a cheaper slot is not traced; an
  evening voucher is offered evening slots only (campaigns rule 14).
- **Backs.** Merchant card: steps around a QR, a code box with four guide cells. Voucher: header,
  « BON CADEAU », QR, contents, parties, code, validity. The website draws the voucher back too
  (rule 66, `cardBack.js`).
- **Printing.** One card per page, front then back.
- **No voucher has been sold yet** (owner, 2026-11-27): no compatibility with existing vouchers is
  needed.

## 2. Goal

The operator sets every price of the bath in one place, sells week or weekend vouchers at their own
price, sees each voucher used on any slot with the difference settled (a supplement when the slot
costs more, an extra hour or a drink when it costs less), and prints merchant cards and vouchers up
to eight per sheet, two-sided or folded.

## 3. Functional rules

### 3.A Prices of an hourly resource, without duplicates

1. **Section « Prix » of an hourly resource of the planning** (a `per_hour` resource with a planning card; one with no planning card keeps « Prix de base », its per-lodging prices and
   the offered hour as they are) shows two grids and nothing else priced:
   - **« Clients logés »**: rows « Journée », « Soirée (dès <hourlyEveningStart>) »; columns
     « 1re heure », « Heures suivantes ». The day first hour is `price` itself, editable here.
     « Prix de base » is no longer shown for an hourly resource (it remains for the other price
     types).
   - **« Prix pour les extérieurs »**, shown when the resource is « vendable hors séjour »: rows
     « Journée », « Soirée »; column groups « Semaine » and « Week-end », each « 1re heure » and
     « Heures suivantes » — eight fields. A line under the grid: « Week-end : du vendredi
     <hourlyEveningStart> au dimanche soir, et les jours fériés. »
   - The rates leave the « Horaires » section, which keeps only hours and planning settings.
   - Mobile: one block per audience and band, fields stacked.
2. **Every price field is required and explicit.** No field falls back to another:
   - the « Vide / 0 = tarif logés » fallback of the outside first hours is withdrawn;
   - an empty following-hours field no longer means « same as the first hour »
     (amends hourly-extra-hour-rates rule 1).
   - The outside grid is required only when the resource is sold outside a stay.
   - Validation: a number 0–10 000, two decimals. Refusal under the field, naming it:
     « Le tarif extérieurs (week-end, soirée, heures suivantes) doit être un montant positif. »
3. **« Prix par logement » keeps only « 1re heure offerte »** for an hourly resource of the planning: the per-lodging
   price is withdrawn (it duplicated the guests' grid); an hourly resource with no planning card keeps its per-lodging prices. The list becomes « Heure offerte par
   logement ». The free hour (`freeMinutes`) and its valuation are unchanged.
4. **Migration** (idempotent, logged), so no price changes on the day of the update:
   - each empty following-hours rate gets its first-hour rate;
   - each outside first-hour rate at 0 or empty gets the guests' rate it fell back to — a resource sold outside only (K9: one that is not keeps its week columns, which may stay empty);
   - the weekend rates copy the week rates wherever those are set and the weekend value is empty, for every hourly resource of the planning (a captured weekend value is never overwritten);
   - a per-lodging price on an hourly resource of the planning is dropped, and the log names the lodging and the
     price dropped. Production must be read before the release (see §9).
5. **Production values** after release (entered by the owner): outside week day 50, week evening
   70, weekend day 70, weekend evening 90 (€ per first hour); following hours as the owner sets them.

### 3.B Week and weekend

6. **Period of a slice.** A slice takes its band from its start time (unchanged) and its period
   from its date and start time: `weekend` on Friday from `hourlyEveningStart`, all Saturday, all
   Sunday, all of a French public holiday, and the evening (from `hourlyEveningStart`) of the day
   before a public holiday, like a Friday (owner, R2); `week` otherwise.
   - Public holidays are computed by the server (fixed dates, Easter Monday, Ascension, Whit Monday),
     in `utils/` so any feature can reuse them.
7. **Guests are untouched.** The weekend applies to the outside grid only; a guest pays the same
   price every day, and the free hour is unchanged.
8. **The engine prices with the real date** wherever one is known (site booking, « Mon bain »,
   outside-booking fiche, planning). A dateless quote (campaign preview, giver's price) receives an
   explicit `period`; without it, `week`.
9. Everywhere an outside session is priced (hourly-extra-hour-rates rule 4 list, outside
   audience), the period applies. A slot grid shows the first-hour rate of the slot's band and
   period.

### 3.C Week and weekend vouchers

10. **A `resource` campaign offers one or both periods** (« Périodes proposées », checkboxes
    « Semaine », « Week-end », at least one; default both). Its price preview shows one price per
    period.
11. **The giver chooses the period inside the campaign** (owner, Q1): a segmented control
    « Semaine » / « Week-end » on the site's purchase page, a « Période » select on « Nouveau bon »
    and « Sur mesure », each with the server's price. A single period is shown as a fact. The
    offer switcher shows the « à partir de » price (lowest period).
12. **Frozen on the voucher**: `contents.resource.period`. The title on the voucher and in the mail
    adds « · semaine » / « · week-end ». The two campaigns on sale get both periods at migration.

### 3.D Validity, from a short list

13. **Validity is picked in a menu: 3, 6, 12, 18 or 24 months, nothing else** — in the campaign
    editor, on « Nouveau bon » (every campaign, prefilled with the campaign's) and for « Sur
    mesure ». The server refuses any other value: « La validité doit être de 3, 6, 12, 18 ou 24
    mois. ». The recap shows « Valable jusqu'au <date> », computed by the server. The site's giver
    never chooses. « Prolonger » is unchanged.

### 3.E Redemption by value

14. **The voucher covers a value**: the price, at the day's rates, of its band, minutes and period
    (its reference).
15. **Every slot is offered, in every direction** (amends campaigns rule 14). For each slot the
    server returns one tag:
    - **« Inclus »** — the slot's price equals the reference;
    - **« + x € »** — it costs more; the supplement is paid as today's remainder (owner, Q2: a week
      voucher on a weekend slot pays the supplement). Its line is named « Supplément soirée »,
      « Supplément week-end », « Supplément soirée week-end », or « Supplément créneau » when neither
      explains it (an odd grid). The cause has a direction: « soirée » only when the slot is evening and the voucher day and the evening costs more at the slot's period, « week-end »
      only when the slot is weekend and the voucher week and the weekend costs more in the slot's band; `evening` (the « dont soirée » flag) is true when the slot is evening and the voucher day, or when the time added by the recipient falls in the evening;
    - **« Inclus · boisson offerte »** — it costs less;
    - **« Inclus · 2 h + boisson offerte »** — rule 17.
16. **A cheaper slot gives one free drink, whatever the difference** (owner, Q3). Nothing is kept
    as a balance; the voucher is settled whole.
    - The booking gets a 0 € line « Boisson offerte » (catalogue option chosen in the plugin's
      settings, « Boisson offerte sur l'écart »), on the outside-booking fiche, its SAS, the
      planning card and the confirmation mail (« Une boisson vous sera offerte sur place. »).
    - The difference is traced as campaigns rule 15 (`gift_voucher_unused`, « Écart de créneau »).
    - No drink option set → the trace alone (« Écart non utilisé : x € » as today).
17. **An evening-weekend voucher on a day-week slot gives 2 h and a drink** (owner, 2026-11-27,
    « toujours 2 h + boisson »; this case only).
    - The voucher's minutes are doubled, the added time being a 0 € line « Heure offerte » of the
      booking; the drink line of rule 16 is added; the trace records the difference.
    - The slot is tagged so only when the doubled session is free and ends by `closeTime`; the
      added time may run into the evening, at no charge (owner, R1).
    - Otherwise the slot gets rule 16 (1 h + drink).
    - Extra time bought by the recipient (campaigns rule 27) starts after the offered hour; it is offered only within what fits after the doubled block — otherwise the quote refuses with
      `EXTRA_TIME_UNAVAILABLE`, the offered hour is never traded for it.
    - **The decision is the confirmation's** (G1): the offered hour is decided when the recipient confirms and stored with the use's recap; the payment of the remainder books exactly that
      composition — the doubled span or not, whatever was freed or taken since — or, when it can no longer be booked, flags the money « à rembourser » and books nothing. No line of the sale and no
      sentence of the mail lies outside the booking.
    - The voucher's own hold on a slot never takes the slot from its own recap (the recipient back from the bank page).

### 3.F Card backs (amends campaigns rules 33 and 66)

18. **Both backs follow the design proposed on 2026-11-27, on a white background** (owner, Q6), top
    to bottom, centred in the safe area: the company logo (or name in serif); « BON CADEAU »,
    honey, letter-spaced capitals; a serif title; an italic subtitle; the QR code in a rounded
    honey frame; « Scannez le QR code » and the printed short link; three numbered honey discs with
    one line each; one single rectangle for the code; small lines; the footer « <company> ·
    <town> · <department> », italic, honey; the vertical legal mention (rule 50).
19. **Merchant card back** (owner, Q4–Q5):
    - title « Offrez un bon cadeau », subtitle « en quelques minutes, depuis votre téléphone »;
    - QR to `/<base>/offrir/<slug>`;
    - steps: 1 « Scannez le QR code avec votre téléphone », 2 « Choisissez et réglez le bon sur
      notre site », 3 « Recopiez ci-dessous le code reçu par mail, offrez la carte »;
    - the rectangle is empty, labelled « Code du bon » inside at top left, full width, 16 mm high,
      no guide cells;
    - under it, small: « Valable <n> mois à partir du paiement. » and « Vous avez reçu cette
      carte ? <`/<base>/utiliser`> ».
20. **Voucher back** (PDF of the mail, download, website):
    - title = the campaign's public title (e.g. « Une heure de bain nordique en soirée · week-end »),
      subtitle « offert par <giver> à <recipient> »;
    - QR to `/<base>/utiliser#bon=<code>`;
    - steps: 1 « Scannez le QR code avec votre téléphone », 2 « Choisissez votre créneau en
      ligne », 3 « Savourez votre parenthèse en Ardèche »; a voucher for a **stay** (a lodging
      campaign) says instead 2 « Réservez votre séjour en ligne : le code se remplit tout seul »
      — its use page shows a notice and a link to the booking page, where the code fills itself in
      (`BACK_TEXTS.lodgingSteps`, sent with the back by `cardBack.js`);
    - the rectangle holds the printed code (bold, large), labelled « Code du bon »;
    - under it, small: the contents (« Votre bon comprend — … », at most 3 lines: the line is built for the lines it is allotted: whole when it fits; when it does not, with several lines the items are listed in order as far as they fit and the last line ends with « … », the first item staying whole; only with ONE line does the first item keep its detail and its period while its name gives way, with room kept for « ·… » when other items follow), the message in
      italics (at most 2 lines), « Valable jusqu'au <date> ». When room runs out the lines are shared in two rounds — each gets its first line, the validity first — and what does not fit ends
      with an ellipsis; the validity is never the line that gives way.
    - The voucher draws its own, smaller sizes than the merchant card (`VOUCHER_BACK_LAYOUT`: QR 18 mm, title 14 pt, logo band 10 mm), so the mock's own configuration — logo, a two-line
      title, « offert par Claire à Julien », a one-line message — prints all three small lines in full.
    - The website draws the same back (`cardBack.js` layout + `blocks/gift-voucher/view.js`).

### 3.G Price on the merchant card front

21. **The merchant card front carries « à partir de <price> »**, drawn by GuestFlow over the
    uploaded visual, read from GuestFlow when the PDF is generated: the lowest price the campaign
    offers (its cheapest period).
    - Style: white rounded label, fir-green text, « à partir de » small and the price in serif.
    - **Corner set per campaign** (owner, 2026-11-27): « Position du prix » in the campaign editor,
      « En bas à droite » (default), « En bas à gauche », « En haut à droite », « En haut à
      gauche », « Aucun »; the editor's preview shows it on the visual.
    - Inside the safe area, never in the bleed.
    - A printed price does not follow later price changes: the editor says « Le prix est celui du
      jour de l'impression. » beside the download and print buttons, only on a resource campaign the server says is priceable (a lodging campaign prints no price).
    - The voucher front (mail) carries no price (campaigns rule 34 stands for the voucher).

### 3.H Print sheets

22. **« Imprimer… » opens a dialog** on the campaign page (merchant card) and on the voucher fiche
    (voucher), beside the existing downloads.
23. The dialog offers:
    - **Mode**: « Recto-verso » or « Côte à côte, à plier »;
    - **Cartes par feuille** (A4): recto-verso 1, 2, 4 or 8; côte à côte 1, 2 or 4;
    - **Nombre de cartes**: 1–200; default = cards per sheet on a campaign (it follows « Cartes par feuille », after a change of mode too, until the operator types a number), **1 on a
      voucher's fiche** (K5: a voucher is a single-use code, one copy);
    - **Retournement de la feuille** (recto-verso): « De gauche à droite » (default) or « De haut en
      bas » — named by the gesture, because printers use « long / short edge » inconsistently in
      landscape;
    - a live preview of the first sheets, numbered so each back matches its front, captioned « Feuille n · Recto » / « Feuille n · Verso », drawn from the server's layout, with the
      crop marks and the sentence the server writes (`layout.description`): « Feuille A4 paysage, 4 × 2, cartes à 66 % (≈ 69 × 98 mm) ». The layout is fetched once per set of options,
      never again because the parent re-rendered.
24. **Recto-verso**: odd pages = fronts, even pages = backs; each back sits where its front lands
    after the flip (columns mirrored for « de gauche à droite », rows for « de haut en bas »). **With « De haut en bas », each back is rotated half a turn** (`cell.rotateDeg: 180`,
    K6): a cut card turned like a page then shows its back upright; the preview draws those backs upside down. The last sheet holds what remains.
25. **Côte à côte**: each card is its front and its back side by side with a dotted fold line and
    crop marks around the pair (K11: at every cut line of the grid, starting 3 mm from the sheet's edge, at least 2 mm long and 1 mm from any card, at 94 % and 66 % too); folded, the paper gives a two-sided card.
26. **Sizes and scale** (owner, Q8: reduced with crop marks):

    | Mode | Per sheet | Sheet | Card scale |
    |---|---|---|---|
    | Recto-verso | 1 | A4 portrait | 100 % |
    | Recto-verso | 2 | A4 landscape, 2 × 1 | 100 % |
    | Recto-verso | 4 | A4 portrait, 2 × 2 | 94 % |
    | Recto-verso | 8 | A4 landscape, 4 × 2 | 66 % (≈ A7) |
    | Côte à côte | 1 | A4 landscape | 100 % |
    | Côte à côte | 2 | A4 portrait, pairs stacked | 94 % |
    | Côte à côte | 4 | A4 landscape, 2 × 2 pairs | 66 % |

    No bleed between cards: the fronts are cropped to the trim, the backs are white. Crop marks (K11) are drawn on recto-verso sheets too, with the same rule.
27. The PDF is built by the server (`…/print.pdf?mode=&perSheet=&count=&flip=`); the preview is the
    server's JSON layout (`…/print-layout`). Refusals (count outside 1–200, a per-sheet value the
    mode does not offer, an unknown flip) → 400 with the sentence under the field.

### 3.I The bath stays a plugin

28. **Switching `hourly-resources` off breaks nothing** (owner question, 2026-11-27): every piece
    of this spec that is about hourly resources lives in `hourly-resources` (rates form contributed
    to the resource panel, weekend period, slots), and every piece about vouchers lives in
    `gift-vouchers`. With `hourly-resources` off, `gift-vouchers` offers lodging campaigns only and
    its resource campaigns answer their refusal sentence; nothing throws.
    - **Audit of 2026-11-27** (87 tests run, nightly `plugin-removal.yml` read): switching the plugin
      off crashes nothing; resource campaigns leave the offer, `use/slots|quote|confirm` answer
      `409 BOOKING_UNAVAILABLE`, sold lines stay readable, the session block hides itself. But
      bath code still lives in the core behind guards, and four risks are not crashes.
    - **Fixed by this spec** (the code it touches anyway): the hourly rates form, its defaults and
      validation leave `ResourceEditorPanel.jsx`, `resourceForm.js` and `resourcesController.js`
      for the plugin (`HourlyPriceGrids.jsx` contribution + the plugin's resource-fields validator);
      the weekend period and public holidays are read only through the plugin; a versioned test
      covers `useService` with `hourly-resources` off.
    - **Found, scope decided by the owner (§9)**: the evening-line rule in `reservationsModel.js`,
      `sessionMaxPeople` in the core panel, the core reading the plugin's settings
      (`settingsProvider.js:138`), the `nordicBath*` tokens; the bath turnover missing from the
      accounting export and the Mollie reconciliation while the plugin is off; online payments in
      flight ending `basket-unallocated` with no « à rembourser » flag and no block on switching
      off; no warning when sold bath vouchers become unusable; the nightly removal matrix red
      since 5 runs (`GIFT_VOUCHER_PEPPER` missing in the CI sandbox), hiding any real regression;
      deleting the folder alone breaks start-up (`plugins/index.js:18` — `plugin-removal.mjs`
      is the supported way).

### 3.J One pricing engine

29. **Every bath price comes from the pricing engine** (owner, 2026-11-27: « nous avons un moteur
    de prix qui doit être utilisé »). Read on master the same day:
    - The engine (`utils/pricing/`) prices articles by **family**; the `hourly` family is the
      plugin's contribution (`hourlyFamily.js`, registered through the SDK), and the rate maths
      sit behind it (`bookingPricing.rateGridOf`, `hourlyPricing.priceSessions`).
    - A stay line goes through the engine → `hourly` family → `rateGridOf(…, { external: false })`.
    - Gift vouchers ask `engine.quote({ lines })` (`offerService.priceContents`).
    - **But** `outsideOffer.quote` and `publicSessionService` call `sessionQuote.quoteSession`
      directly, on a placeholder date, outside the engine's request; and the family tags every
      amount `customerContext: 'hosted'`, even for an outside customer.
30. **So this spec**:
    - carries the **date** (or, dateless, the **period**) and the **audience** in the engine's
      request (`lines[].session.date | period`, the head's `customerContext`), down to the
      family, down to `rateGridOf(resource, { external, period })` — the one place that reads a
      rate column;
    - routes `outsideOffer.quote`, `publicSessionService` and `useService` through
      `engine.quote`, as the vouchers already do: one path, so a slot's price on the site, in
      « Mon bain », on the fiche and in a voucher can never differ;
    - tags an outside session's amounts `customerContext: 'external'`;
    - writes no rate, weekday or holiday rule anywhere else (no client computation, no second
      grid in `gift-vouchers`).

**Edge cases:**
- Sunday 2026-04-05 20:00 (eve of Easter Monday) → weekend evening (it already is, being Sunday);
  Wednesday 2026-05-13 20:00 (eve of Ascension) → weekend evening.
- Session 19:30–21:00 on a Friday, evening at 20:00 → 19:30–20:00 week day, 20:00–21:00 weekend
  evening.
- Monday 2026-04-06 (Easter Monday) → weekend all day.
- Evening-weekend voucher on Tuesday 21:00 slot, closing at 22:00 → no 2 h possible, but the slot is
  an evening-week slot (70 < 90) → « Inclus · boisson offerte ».
- Evening-weekend voucher on Tuesday 14:00, bath free 14:00–16:00 → « Inclus · 2 h + boisson
  offerte »; booked 15:00–16:00 → « Inclus · boisson offerte ».
- Day-week voucher (50) on Friday 20:00 (90) → « + 40 € », « Supplément soirée week-end ».
- 9 cards, 8 per sheet → 4 pages: fronts 1–8, backs 1–8, front 9, back 9.
- A pair of a side-by-side card is 210 mm wide: it never fits A4 portrait at true size, hence
  landscape for 1 and 94 % for 2.

## 4. Architecture

### 4.1 Server (`server/src/`)

- `database.js` / `schema.sql` — four `REAL` weekend columns on `resources`; migration of rule 4.
- no new core module: the French public holidays are the existing `sdk.calendar.frenchPublicHolidays`; `hourlyPricing.js` of the plugin keeps the per-year set and the eve of a holiday (`isPublicHoliday`, `isEveOfPublicHoliday`), unit-tested in `hourly-public-holidays`.
- `plugins/hourly-resources/hourlyPricing.js` — `periodOf(date, start, eveningStart)`; slices pick
  the week or weekend grid; no fallback between fields.
- `plugins/hourly-resources/bookingPricing.js` — `rateGridOf(resource, { external, period })`.
- `utils/pricing/` (engine head, `steps/externalExtras.js`) — passes the session's date/period and
  the audience to the family; no rate logic added in the core.
- `plugins/hourly-resources/hourlyFamily.js` — reads date/period/audience from the request; tags
  external amounts `external`.
- `plugins/hourly-resources/sessionQuote.js` — `quoteSession` takes `date` or `period`; called
  only by the family.
- `plugins/hourly-resources/publicSessionService.js` — prices through `engine.quote`.
- `plugins/hourly-resources/outsideOffer.js` — `quote` prices through `engine.quote` and returns `supplementCents`, `leftoverCents`,
  the supplement's cause, and whether the doubled session is free (rule 17).
- `plugins/hourly-resources/catalogueLines.js` — week and weekend in the external line.
- Resource validation (current save path, `controllers/resourcesController.js` → moved into the
  plugin's field contribution where it is hourly-specific, §3.I) — required fields, rule 2.
- `plugins/gift-vouchers/migrations.js` — `campaigns.periods`, `campaigns.frontPricePosition`,
  setting `leftoverDrinkArticleRef`; on-sale campaigns get both periods.
- `plugins/gift-vouchers/voucherRules.js` — `VALIDITY_CHOICES = [3, 6, 12, 18, 24]`.
- `plugins/gift-vouchers/campaignRules.js` — `periods`, `frontPricePosition`, validity choices.
- `plugins/gift-vouchers/offerService.js` — period in offer, contents and pricing; validity on the
  admin path.
- `plugins/gift-vouchers/useService.js` — tags of rule 15, drink and offered-hour lines, trace.
- `plugins/gift-vouchers/voucherPdf.js` — both backs (rules 18–20), front price (rule 21),
  `renderPrintSheets` (rules 24–26).
- `plugins/gift-vouchers/printLayout.js` (new) — pure imposition (positions, mirroring, scale, page
  count), used by the PDF and the preview; unit-tested.
- `plugins/gift-vouchers/cardBack.js` — new back layout and texts for the website.
- `plugins/gift-vouchers/routes/admin.js`, `controllers/campaignsController.js`,
  `controllers/adminController.js` — print endpoints.
- `plugins/gift-vouchers/settings.js` — drink option setting.

### 4.2 Client (`client/src/`)

- `plugins/hourly-resources/HourlyResourceFields.jsx` — rates leave it; a new contribution
  `HourlyPriceGrids.jsx` (plugin) renders both grids in « Prix » (rule 1).
- `pages/options/ResourceEditorPanel.jsx` / `resourceForm.js` — no « Prix de base » for an hourly
  resource; per-lodging list reduced to the offered hour; a contribution slot in « Prix ».
- `plugins/gift-vouchers/CampaignEditor.jsx` — « Périodes proposées », validity menu, « Position du
  prix » with preview, « Imprimer… ».
- `plugins/gift-vouchers/NewVoucherPage.jsx` — « Période », validity menu, end date from the recap.
- `plugins/gift-vouchers/GiftVoucherDetail.jsx` — « Imprimer… », trace label.
- `plugins/gift-vouchers/GiftVoucherSettings.jsx` — « Boisson offerte sur l'écart ».
- `components/PrintSheetsDialog.jsx` (new, generic for any A6 two-sided document) — `FormDialog`,
  `fullScreen` on xs.

### 4.3 WordPress (`integrations/wordpress/guestflow-booking/`)

- `blocks/gift-voucher/view.js` — period control, new back drawing.
- `blocks/session-booking/view.js` — the four slot tags, drink and offered-hour lines.
- Connector minor version bump.

### 4.4 API

- `GET /public/v1/gift-vouchers/offer` — `periods: [{ period, priceCents, label, hint }]` per resource
  campaign, cheapest first, with `contentsByPeriod` and `extraTime.pricesByPeriod`; `back.layout` and `back.texts` unchanged from 4.7.0 (K10), the redrawn back under `back.design`.
- A public price or order request without `period` gets the campaign's cheapest offered period (K1); an unoffered period is refused on every public path.
- Order creation (public and admin) — `period` required when the campaign offers two; admin
  `validityMonths` ∈ {3, 6, 12, 18, 24}.
- `POST /use/slots` — `tag: 'in' | 'supplement' | 'drink' | 'twoHoursDrink' | 'twoHours'`, `dueCents`,
  `supplementLabel`, `evening`, the doubled `end`. The site tags: « Inclus · 2 h + boisson offerte » / « + x € · 2 h + boisson offerte » (`twoHoursDrink`), « Inclus · 2 h » / « + x € · 2 h » (`twoHours`, no drink option set).
- `POST /use/quote`, `/use/confirm` — drink and offered-hour lines; `/use/confirm` takes the `end` the recap showed and refuses with `RECAP_CHANGED` when it no longer holds — a connector before 1.27.0 sends no `end`, the check is then skipped.
- Admin: `GET /campaigns/:id/print.pdf|print-layout`, `GET /:id/print.pdf|print-layout`
  (`mode`, `perSheet`, `count`, `flip`).

## 5. Data model

- `resources`: `hourlyExternalWeekendDayRate`, `hourlyExternalWeekendEveningRate`,
  `hourlyExternalWeekendNextDayRate`, `hourlyExternalWeekendNextEveningRate` — `REAL`.
- Existing hourly rate columns: filled by the migration (rule 4) for a resource of the planning sold outside; the outside columns of a resource that is **not** sold outside may stay NULL / 0 (nothing is priced from them: its lodging with no stay is priced at the guests' live rate, K9).
- `property_resource_prices.price` for an hourly resource of the planning: cleared by the migration (logged); a `per_hour` resource with no planning card keeps its per-lodging prices.
- `resource_bookings.engineRated` — `INTEGER`, nullable (migration `resource_bookings_engine_rated_v14`, rule 29): 1 = an outside session made or moved on the engine path; NULL = every row of before, which keeps its stored figure and its way of pricing.
- `gift_voucher_campaigns.periods` — `TEXT NOT NULL DEFAULT '["week","weekend"]'`;
  `frontPricePosition` — `TEXT NOT NULL DEFAULT 'bottom-right'`.
- Voucher `contents.resource.period`.
- Plugin setting `leftoverDrinkArticleRef`.

## 6. UI / UX

See the interactive summary (French). Mobile: price grids stacked by audience and band; selects full
width; print dialog full screen with the preview under the fields.

## 7. Test plan

- `server/src/tests/hourly-weekend-rates.unit.test.js` — period of each slice (Friday day/evening,
  weekend, public holiday), guests untouched, required fields and refusals, migration of rule 4.
- `server/src/plugins/hourly-resources/tests/hourly-offered-session-move.unit.test.js` — a session offered at the visit is one figure (0 €) on the booking, the preview, the invoice basis and the document, through the offer, a notes-only save and a move, and back to the slot's price when the offer is taken back.
- `server/src/plugins/gift-vouchers/tests/gift-voucher-back-room.unit.test.js` — the back's contents: with several lines the options are listed in order as far as they fit (the last line ending « … »), with one line the first item keeps its detail and period.
- `server/src/tests/hourly-public-holidays.unit.test.js` — holidays of 2026 and 2027, the eve of a holiday.
- `server/src/plugins/gift-vouchers/tests/gift-voucher-period-redemption.unit.test.js` — offer per period, frozen period,
  tags in every direction, supplement labels, drink line and trace, 2 h + drink (free, not free,
  past close), validity choices.
- `server/src/plugins/gift-vouchers/tests/gift-voucher-print-layout.unit.test.js` — every row of rule 26 × long/short,
  page count, refusals.
- `server/src/plugins/gift-vouchers/tests/gift-voucher-card-backs.unit.test.js` — both backs and the front price drawn
  (text extraction), corner « Aucun ».
- `server/src/tests/hourly-booking-pricing-invariants.unit.test.js` — the seeded generative harness of the booking pricing (rules 2, 29, 30; seeded, ≈ 10 s: 1 500 random sessions per pure invariant — about 7 500 in all — and, on the stored half, 120 scenarios of four bookings (outside, outside stored before the engine path, lodging; each run first with no document, then with its visit document, through create, a notes-only save, a full resend, « Offrir » at the visit and two moves whose preview is compared with the save) plus 120 sold scenarios (website session or voucher use, alternately, on slots of 30, 60 and 120 min with the evening switch on or off the slot grid, as far as the engine can sell them)), six invariants — I-a planning = engine on the grid, I-b one figure per booking across every reader and the preview of a move = what the save stores, I-c an unsold band or period refused on the preview and the save, I-d lodging, stay guests and a stay's own sessions (through the price-line contributor) = origin/master (frozen oracles `masterBookingPricing.oracle.js` and `masterHourlyPricing.oracle.js`), I-e a booking sold on a document keeps its session figure, I-f the free and the offered minutes are valued on the gross's own slices (and an on-grid week-day session = master) — each with a negative control that must fail.
- `gift-voucher-back-contents-line.unit.test.js` (the contents line built for the lines it is allotted, resource names of 13 to 60 characters × roomy / crowded × with / without another item), `gift-voucher-slots-own-hold.unit.test.js` (the slot list excludes the voucher's own hold like the recap), `wordpress-gift-voucher-card.cross-version.test.js` (the back from `design` alone, a stay voucher's steps whatever an older GuestFlow sends, the card shown after payment).
- Plugin off: `server/src/plugins/gift-vouchers/tests/gift-voucher-hourly-off.unit.test.js` — `hourly-resources` off → the voucher offer, the use screen, the confirmation, the late payment and the lapse job answer without
  throwing (the boundary suites `plugin-boundary-*`, `resource-offer-follows-plugin` and `gift-voucher-catalogue-view` still pass).
- Client: `plugins/hourly-resources/__tests__/HourlyPriceGrids.test.jsx`, `plugins/gift-vouchers/__tests__/NewVoucherPage.period-validity.test.jsx`, `CampaignEditor.periods.test.jsx`,
  `CampaignEditor.front-price.test.jsx`, `components/__tests__/PrintSheetsDialog.test.jsx`, and `GiftVoucherSettings.test.jsx` for the drink select.
- WordPress block tests: `wordpress-gift-voucher.period.test.js` (period control), `wordpress-session-booking.voucher-tags.test.js` (slot tags, offered lines), `wordpress-gift-voucher-card-back.test.js` (new back, stylesheet drift).
- Manual: print at 4 and 8 per sheet two-sided on a home printer, fold side by side; mobile check of
  the resource panel, « Nouveau bon » and the print dialog.

## 8. Out of scope

- Weekend prices for guests and for lodging.
- A balance kept on a voucher; several drinks for a large difference.
- Other paper sizes than A4.
- A price on the voucher's front.

## 8b. As built (2026-11-27)

Implemented on `feature/gift-voucher-week-weekend` in five steps (engine and rates, campaigns and validity, redemption, backs and front price, print sheets). Where the code differs from the text above:

- **Read-time defence for rows not saved through the form.** `rateGridOf` still reads a `null` following-hours rate as the first hour of its band (rule 2 withdraws it from the form, the validation and the stored data: the plugin's `resourceRates.js` refuses a blank, migration `explicit_hourly_rates_v13` fills every stored one). The outside first hour at 0 is *not sold* (no fallback to the guests' rate), and an unset weekend column reads 0, not the week rate: nothing is priced from a column nobody filled.
- **Engine path (rule 30).** The date or period travels in the session of the standalone sale's quote (`session: { band, minutes, start?, date?, period?, rankOffsetMinutes? }`), the engine entry `outsideOffer.quote`, the public session check and the vouchers all use. `customerContext: 'external'` is tagged on the outside session line by `quoteSession` and by the engine head's `externalVat`; `hourlyFamily.price` keeps `'hosted'` — it prices stay lines only (an outside session never goes through it). The `outsideOffer.quote` answer carries `session.leftoverCents`, `session.supplementCause` (`evening` | `weekend` | `eveningWeekend` | `slot`, from what costs more at the grid: rule 15), `session.eveningOverDay`, `session.slot` and `twoHours: { free, minutes, endTime, line }`.
- **SDK 2.38.0** (minor): `ctx.resourceValidator(validate)`, the client slot `resources.priceFields` and the client export `PrintSheetsDialog` — no core module (the holidays are the existing `sdk.calendar.frenchPublicHolidays`); `hourly-resources` 1.13.0 and `gift-vouchers` 1.10.0 (which imports `PrintSheetsDialog`) ask `^2.38.0`. The price grids are a new client slot `resources.priceFields` (`{ key, appliesTo, Component, form: { fields, defaults, fromItem, payload, validate } }`); the core resource form only asks its contributions, and plugin off means no grid and no check.
- **Per-lodging price (rule 3).** The editor no longer asks it and the payload never sends it for an hourly resource of the planning (a `per_hour` resource with a planning card); the migration clears the stored ones of those only — a `per_hour` resource with no planning card keeps « Prix de base », its per-lodging prices and its offered hour. The read path of `property_resource_prices.price` is untouched.
- **Redemption.** The tags are `in`, `supplement`, `drink`, `twoHoursDrink`, plus `twoHours` (an offered hour when no drink option is set — the spec's four tags assume a drink). With no drink option set `drink` becomes `in`. The drink line is the option's own `offered` line (0 €, its catalogue label shown struck), named « Boisson offerte » in the recap; the added hour is a fulfilment `hourly-slot:<id>:offered`. The gap is traced in the booking's transaction (`traceGap`), the voucher is settled whole as before.
- **Validity.** An operator's choice on « Nouveau bon » for a named campaign is frozen in the order's `contents.validityMonths` (read by the issuance); the price answer carries `validUntil`. Existing campaigns whose validity is not on the list are moved to the nearest of 3/6/12/18/24 by `gift_voucher_week_weekend_v5`.
- **Period title.** The voucher's title always ends « · semaine » or « · week-end », for a campaign that sells one period too. The offer's campaign view carries `periods` and `extraTime.pricesByPeriod`; the website's card back carries `back.titles` per period.
- **Backs.** `BACK_LAYOUT` / `BACK_TEXTS` were rewritten (the four numbers `safeMm`, `legalStripMm`, `qrMm`, `logoMm` kept); the department of the footer is read from the postcode of the company address (`companyProfile.departmentOf`), none when it names none. The website draws the back in `voucher-card.js` / `style.css` from the same layout (a stylesheet-drift test holds the two together).
- **Print.** `printLayout.plan` is the one layout; `voucherPdf.renderPrintSheets` draws each cell with a translated and scaled frame of the page (each card draws its front over the bleed box and is clipped to the trim, exactly as the single merchant PDF does; each image is embedded once per document; crop marks are planned by `printLayout` — recto-verso included — at the cut lines, never closer than 3 mm to the sheet's edge (K11); with « De haut en bas » each back is rotated half a turn). The dialog previews the first four pages from the same JSON and downloads the PDF; printing a merchant card locks the slug like the merchant-card download.
- **Test files** that read the gift-vouchers folder live in `server/src/plugins/gift-vouchers/tests/` (the removal matrix refuses such a test in `server/src/tests/`); the suites of rule 6 and 2 (`hourly-weekend-rates`, `hourly-public-holidays`) stay in `server/src/tests/`.
- **Test counts (2026-11-27, before the review; the figures after it are the next bullet).** Server `npm test`: 15 245 tests, all green (the two price-gate suites carry the weekend first-hour columns the migration would copy, allowed in `scripts/price-gate/anonymise.js`); client `vitest`: 5 018 tests in 1 095 files, all green; `npm run build` green. New suites: `hourly-weekend-rates` (11), `public-holidays` (3), `gift-voucher-period-redemption` (14), `gift-voucher-hourly-off` (1), `gift-voucher-card-backs` (6), `gift-voucher-print-layout` (20) on the server; `HourlyPriceGrids` (9), `NewVoucherPage.period-validity` (4), `CampaignEditor.periods` (4), `CampaignEditor.front-price` (4), `PrintSheetsDialog` (6), the drink select (1), and three WordPress block files (3 + 2 + the updated card-back suite) on the client.
- **Decisions of the review of 2026-11-27 (K1-K8, the owner's session).**
  - **K1.** A *public* price or order request without `period` gets the campaign's cheapest offered period (what an older connector shows as « à partir de »); the connector now forwards `period` on the order and price routes. The admin paths (« Nouveau bon », « Sur mesure ») keep requiring it.
  - **K2.** Every field of the outside grid (« Prix pour les extérieurs », 8 fields) is above 0 when the grid is required; the sentence stays « … doit être un montant positif. ». The guests' grid keeps 0–10 000. To stop selling outside, the operator switches « Vendable hors séjour » off. The checks judge the stored resource under the payload (a partial save is judged whole), and a per-lodging price on an hourly resource of the planning is refused.
  - **K3.** A booking that carries a lodging (with or without a reservation) is priced on the week period, as before the branch (rule 7); its free minutes are valued on the week grid. It keeps its flat fallback off the slot grid.
  - **K4.** A new or moved outside planning booking (no lodging) is priced by the engine's own functions with its real date and period, for any start and duration the planning allows, off the slot grid included; a stored booking keeps its stored figures. An outside band whose first hour is 0 or empty is *not sold*, on every placed path (planning, site, vouchers, « Mon bain »): refused with « « … » n’a pas de tarif extérieur pour la <bande> en semaine. » / « … le week-end. » (« … pour la <bande>, en semaine et le week-end. » when the band is unsold in both periods, as the catalogue and the sellability read it), never priced 0 €, never another rate; sellability, « à partir de » and limits read both periods.
  - **K5.** Printing from a voucher's fiche defaults to 1 copy; the campaign page keeps « default = cards per sheet ».
  - **K6.** With « De haut en bas » each back is rotated half a turn (PDF and preview).
  - **K7.** On a phone the price fields stack, one per row, the refusal sentence the full width; the grid from `sm` up.
  - **K8.** An order keeps the period it was priced with, even when its campaign later stops offering it (`repriceOrder` reads the frozen contents); an amount (lodging) campaign prints no « à partir de ».
- **Decisions of the second review (K9-K11).**
  - **K9.** A booking that carries a lodging but no stay is priced exactly as on origin/master: on the outside grid, week period, where its band has an outside first hour, otherwise at the guests' live rate (`legacyGridOf`, kept for this kind of booking and the rows of before only, D6). Migration `explicit_hourly_rates_v13` fills an empty or 0 outside first hour with the guests' rate only for a resource sold outside (`sellableExternally = 1`), and copies the week grid to the weekend columns wherever the week columns are set and the weekend value is empty, for every hourly resource of the planning (a captured weekend value is never overwritten; idempotent); an outside booking without a lodging on a band with no outside price stays refused (rule 2).
  - **K10.** `/public/v1` stays backward compatible for the card back (CLAUDE.md §5.6): `back.layout` and `back.texts` are exactly what 4.7.0 sent (`legacyBack.js`), the redrawn back is `back.design = { layout, voucherLayout, texts }`; connector 1.27.0 reads `design`, with `var(--x, default)` for every stylesheet variable and its own words when GuestFlow is older (never a literal « {lines} »): either order of update works: the card is drawn from `design` alone when the legacy keys are absent, and a stay voucher's steps (`lodgingSteps`, chosen from the voucher's `kind`) are the connector's own when a GuestFlow sends none, so a stay voucher never says « Choisissez votre créneau en ligne ». A drift test holds the legacy variables, the fallbacks and the card drawn both ways.
  - **K11.** Crop marks start 3 mm from the sheet's edge, are at least 2 mm long and keep 1 mm from any card; every cut line has its marks, at 94 % and 66 % too.
- **One figure per booking (rule 29).** The price path of a booking is a fact stored on it, `resource_bookings.engineRated` (migration `resource_bookings_engine_rated_v14`, nullable): 1 for an outside session made or moved on the engine path, empty for every row of before — which keeps its stored figure and its way of pricing through any save that does not move it (a notes-only save of an off-grid outside booking keeps its 45 €). The fiche preview, the stored total, the visit's session line and the invoice basis all read it. An off-grid session is cut where its price can change: the evening switch, the period switches of a Friday or an eve of holiday, and each whole hour from the first paid minute; on every session of the slot grid it equals the engine's quote. A stored pair whose end does not follow its start prices 0 € (rule 23 exemption), never throws.
- **Rule 30 readers.** `rateGridOf` (the strict grid: no fallback, an outside 0 is not sold) and `legacyGridOf` (K9) in `bookingPricing.js` are the only readers of the outside rate columns, besides the resource form's own model and the migration. The guest-side readers of the guests' day price are accepted exceptions: `scheduler.js`, `schedulingModel.js` and `hourlyFamily.js` (`config.price`, a stay line's unit) read `resources.price` for the guests, and `outsideOffer.freeSlots` passes it to the slot walk, which prices nothing.
- **The planning equals the engine (rounds 2-3, M1-M3).** On a session that starts and ends on the slot grid the planning walks the grid as the engine does (`hourlyPricing.slicesOf`): the same figure whatever the slot (5 to 120 min) and wherever the evening switch falls; only an off-grid session is cut where its price can change. The free and the offered minutes (« Temps offert ») of such a session are valued on those same slices — overlap × the rate of the slice they fall in (`hourlyPricing.bookingDeductions`), never on a sub-range walked on its own; a lodging's deductions keep origin/master's walk (D6). A refusal names its period, in the engine's one sentence (`notSoldSentence`: « … pour la journée en semaine. » / « … le week-end. »). An outside band or period with no first-hour price is refused on exactly the slices the pricer prices (`pricedSlices`, one walk shared with `unsoldSliceOf`), on and off the grid, by the preview and the save together. A booking whose session is sold on a document (a website session, a voucher use with its offered hour and paid added time, an arrival visit) keeps that document's session figure on every reader — the fiche preview, the invoice basis, a notes-only or full save — and moving it reprices the document's session lines together (`visitModel.sessionFigureOf`, `repriceSession`; a settled line refuses the move). A session offered at the visit (« Offrir ») moves the booking's stored total to 0 € at once (`visitModel.patchLine`), keeps it there through a move, and the preview of that move says 0 € too (`visitModel.offeredSessionFigure`). `hourly-booking-pricing-invariants.unit.test.js` holds all of this as a seeded generative harness (I-a to I-f, each with a negative control).
- **Site back, accepted for production.** On the website a crowded line of the back (a long contents line under a long message) can be cut at a fractional height without an ellipsis; the PDF always ends a cut line with « … ».
- **Read after the review.** « Mon bain » prices each distinct figure of a slot list once (`memo` of `outsideOffer.quote`); the offered hour (rule 17) is frozen at the recipient's confirmation and the payment of the remainder books exactly that composition (G1; `excludeHoldRef` only lets the voucher's own hold stand aside in the recap and the slot list); `/use/confirm` refuses with `RECAP_CHANGED` when the end the recap showed no longer holds; the contents of every voucher face end with « · semaine » / « · week-end »; the website's back has `linesByPeriod`; the catalogue's modes carry `byPeriod`; a recipe carries `periods` and `frontPricePosition`; migration `gift_voucher_week_weekend_v5` moves a validity to the nearest allowed value, a tie going up, one log line per campaign.
- **Test counts after the review (2026-11-27).** Server `npm test`: 15 321 tests, all green; client `vitest`: 5 051 tests in 1 105 files, all green. New server suites: `gift-voucher-rule17-paid-online` (3), `gift-voucher-rule15-17-edges` (7), `gift-voucher-slots-memo` (1), `gift-voucher-back-priority` (2), `gift-voucher-print-marks` (4), `gift-voucher-print-description` (3), `gift-voucher-print-pdf` (5), `gift-voucher-contents-period` (5), `gift-voucher-lodging-back-steps` (2), `gift-voucher-recipe.periods` (2), `gift-voucher-validity-migration` (1), `gift-voucher-order-period-kept` (2), `gift-voucher-long-date` (1), `gift-voucher-hourly-off.reason` (1), `hourly-outside-bands-sold` (6), `hourly-rates-partial-save` (3), `hourly-migration-planning-scope` (1), `hourly-public-holidays` (3, ported), `wordpress-voucher-proxy-period` (2). New client suites: `HourlyPriceGrids.layout` (4), `PrintSheetsDialog.behaviour` (5), `CompositionEditor.periods` (3), `CampaignEditor.stale-state` (3), `GiftVoucherSettings.drink` (2), `resourceToPayload.lodging-prices` (2), `ResourceEditorPanel.hourly-price` (1), `wordpress-gift-voucher-card.validity-priority` (3).
- **Price gate (2026-11-27).** The gate's loader runs the hourly plugin's migration as a boot runs it (`scripts/price-gate/recompute.js`: the weekend grid copies the week grid where it is empty, a per-lodging price on a bath of the planning is dropped); the hand edit of `inputs.json` is reverted. The production capture moves no figure (Granja and Estiva carry 30 €, the bath's own price). The 10 figures of synthetic booking #4 that D20 moves (total 34,56 → 39,38 €, rate 19,75 → 22,50 €, VAT 3,14 → 3,58 €…) are recorded in `allowlist.json`, approved by Adrien on 2026-11-27. `price-gate-loader.unit.test.js` pins that the loader treats the synthetic set as it treats a capture, so no branch on the kind of set can hide a moved figure again (`specs/pricing/pricing-components.md` rule 68).
- **Not done / for the owner.** The print of 4 and 8 per sheet on a real printer and the fold of side-by-side sheets (manual plan); the sentence that says what the week-end is (« Week-end : du vendredi 20:00 au dimanche soir… ») is worded by the editor from the typed evening switch, not by the server; the SDK floor check (`scripts/check-plugin-versions.mjs`) does not follow client exports (it reads the server's core modules and the client files a plugin's apps build in), so `PrintSheetsDialog` is held by the manifest's `sdk` only.

## 9. Open questions

Resolved 2026-11-27 (owner): Q1 choice inside the campaign · Q2 supplement · Q3 one drink · Q4 wording
adapted to the real flow · Q5 keep validity and the recipient line · Q6 both backs · Q7 weekend rate on
public holidays · Q8 4 per sheet reduced to 94 % with crop marks · 2 h + drink for an evening-weekend
voucher on a day-week slot, always · per-lodging price withdrawn, offered hour kept · front price
corner set per campaign · validity menu 3/6/12/18/24 · no voucher sold yet · R1 the offered hour may run
into the evening · R2 the eve of a public holiday is weekend from `hourlyEveningStart` · rule 28: the
minimum here (price grids, their defaults and validation into the plugin, a voucher test with the bath
off), the other gaps in a separate spec « bath isolation » · rule 29: every price through the engine.

Still open:
- Production read before release: does any lodging carry its own price on the bath (rule 4 drops it)?
