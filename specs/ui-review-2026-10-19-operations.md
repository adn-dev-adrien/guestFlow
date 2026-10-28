# UI/UX review 2026-10-18 — operations: SAS, quotes, reservation fiche, calendar, quote PDF

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/ui-resa-sas-quotes` |
| **Created** | 2026-10-19 |
| **Author** | Adrien |
| **Related PR** | feature/ui-resa-sas-quotes → `inte/plugins` |

---

## 1. Context

The UI/UX review of 2026-10-18 (`docs/rapports/2026-10-18-ui-ux-review.html`, zone « Planning,
réservations, devis, SAS ») measured the operator screens at 390, 900 and 1280 px on a copy of the
Solio data. Adrien arbitrated it on 2026-10-19. This spec carries the five retained proposals of the
zone and the three decisions that shape them:

| Retained proposal | Decision | Rules |
|---|---|---|
| 6 — SAS: primary action at the bottom, « Reporter » neutral, « 3 sur 9 », « Rien à percevoir » | 5 — the primary action sits at the bottom, under the thumb | 1-4 |
| 7 — Quotes list: amounts never wrap, a single « ⋯ » menu | 7 — the PDF button stays visible on large screens, in « ⋯ » on phones | 5-9 |
| 17 — Reservation fiche below 1200 px: sticky total bar + identity | 6 — a platform reservation's bar shows the server's main figure, « Vous percevez » | 10-12 |
| 21 — Calendar: closures as hatching, legible platform bars, mobile filter | — | 13-16 |
| 22 — Quote PDF in the Maison identity, total on page 1, no « (expiré) » | — | 17-20 |

What was measured:

- **SAS.** « Reporté » was a filled red button with black text (3.5:1, under AA), and deferring is not
  an error. The frequent answer sat on top, away from the thumb. The header said « Étape 3 » with no
  total. The recap printed « Total : 0,00 € » when nothing was due.
- **Quotes list.** At 1280 px the « Actions » column was clipped and « 1 117,40 € » broke over three
  lines. At 390 px a card read « Gite10/05/2027 » and every website request carried « Origine
  inconnue ». Each row had 3-4 icons, a red bin at the same weight as the pencil.
- **Reservation fiche.** At 390 px the fiche is about 6 100 px tall and the pricing summary sits at the
  very end: ticking an option changes a total nobody can see. The bar shows icons only, nothing says
  whose reservation is open.
- **Calendar.** A winter closure drew a grey bar on every week row and took a lane from the stays.
  Platform bars put white text on yellow. The legend printed the raw key « GitesDeFrance ». At 390 px the
  « Logement » select collapsed to « L… ».
- **Quote PDF.** A navy band and Helvetica: another brand than the app. Six offered items took two
  lines each and pushed the grand total to page 2. A quote past its validity printed « (expiré) » on the
  document the guest receives.

Not in this spec: the payments as a ledger of states (decision 8) has its own spec, written by another
batch; the pricing summary's hero/waterfall (review proposal 6) was not retained.

## 2. Goal

At the door, on a phone, the operator answers the SAS with the thumb and knows how far along the
check-in is; on every screen width the quotes list, the fiche total and the calendar read without
guessing; and the quote the guest receives looks like the house that sends it.

## 3. Functional rules

### SAS (proposal 6, decision 5)

1. **The primary action sits at the bottom (decision 5).** On a phone the SAS footer stacks its
   buttons in reading order: the alternative on top, the primary answer last, under the thumb. From
   `sm` they sit side by side, primary on the right. The primary answer is the filled button: the
   reassuring answer of a yes/no page, « Non merci » on an upsell page, « Suivant » / « Valider et
   terminer » elsewhere. Amends `arrival-departure-sas.md` §6 « Footer — yes/no answer colour code »
   (the reassuring answer used to sit on top).
2. **Deferring is never red.** The alternative answer of a yes/no page is a neutral tonal button (ink
   on a light warm fill, AA). The caution step reads « Caution perçue » / « Reporter au départ ». Red is
   kept for one answer only, « Dégât / litige » on the departure caution return, drawn as an outlined
   error button (error text on white, AA) — never black on red.
3. **« 3 sur 9 ».** The header reads « N sur M ». M counts the questions of the run, decided by the
   reservation's data; a page an answer opens (linge manquant, serviettes et draps, extincteur, matins
   du petit déjeuner vendu et sa composition, restauration) carries the number of the question that
   opened it. The reminder of a caution deferred at check-in comes just before the recap and carries
   the number of the page before it. M therefore never grows when an upsell is accepted, which is
   why `review-2026-10-18-reservations.md` rule 3 had removed the total (amended here). The progress
   bar fills to N / M, the same figures.
4. **« Rien à percevoir ».** The server decides whether anything was owed at the door before this run
   (`nothingToCollect` in the SAS payload): a stay still unsettled on a direct channel — at departure
   too, so a stay deferred at check-in is never greeted by a green badge —, an unsettled arrival
   complement, and at departure a stored end-of-stay complement. A platform solde is the OTA's payout,
   not door money. Only when the server says nothing was owed AND this run adds nothing (arrival: no
   stay amount, complement total 0; departure: end-of-stay total 0) does the recap show a success
   badge « Rien à percevoir » instead of « Total : 0,00 € ». A caution deferred to the departure keeps
   the badge away. The server re-prices everything at commit, as before. (Reworded 2026-10-19 after
   review: the first version decided it from the client's totals alone.)

### Quotes list (proposal 7, decision 7)

5. **Amounts never wrap.** The « Montant TTC » cell and its header are right-aligned, `nowrap`,
   tabular figures. The amount is the server's `totalTtc` of each list row (accommodation + tourist
   tax), no longer summed in the page.
6. **One « ⋯ » menu per row.** Modifier, Télécharger le PDF, Confirmer en réservation (not on a
   converted quote) and, last and in the error colour, Supprimer… (still confirmed). The row itself
   opens the quote.
7. **The PDF button stays visible on large screens (decision 7).** From `md` a download icon sits
   beside « ⋯ » and the menu does not repeat it; below `md` it lives in the menu.
8. **One readable caption on a phone.** The card reads « Logement · 10/05/2027 → 13/05/2027 » on one
   line with a real separator; a long client name wraps instead of widening the card. The list is
   cards below `lg` (at 900 px the table ran 289 px past its card); from `lg` it is a table whose
   logement and dates share one « Séjour » column and whose long client name ends in an ellipsis, so
   it fits its card at 1280 px with no column cut.
9. **No « Origine inconnue » in the list.** A list row whose website request carries no attribution
   sends `originLabel: null`; the « Site internet » badge already says where it came from. The quote
   fiche keeps the full origin (`site-traffic-analytics.md` rule 19 unchanged there).

### Reservation fiche below 1200 px (proposal 17, decision 6)

10. **The server names the headline figure (decision 6).** Every quote carries `headline =
    { label, amount, secondary }`. A platform reservation: « Vous percevez » = `sejourNetTotal`, with
    « Total du séjour » (what the guest pays, the gross of the summary's first line) as secondary. A
    direct one: « Total du séjour », with « Total perçu » (`sejourNetTotal`) as secondary whenever the
    two differ by more than half a cent — a refund, a reduction, a tip, a commission on a channel that
    counts as direct (Lodgify on Solio), money collected above the stay.
11. **A sticky total bar below `lg`.** Under 1200 px the fiche ends with a bar pinned to the bottom of
    the screen that renders `headline` and nothing else computed. Touching it opens the full pricing
    summary in a bottom sheet that is dragged down to close. The figure cross-fades when it changes;
    with reduced motion it swaps at once. From `lg` there is no bar: the summary column is sticky. On a
    phone the bar steps aside while a text field has focus (the keyboard is up), and the page keeps its
    height free at the bottom so the last field is never covered. The bar bleeds over the page padding:
    flush with the screen's edges and its bottom, scrolled to the end too. Its accessible name carries
    both figures.
12. **Whose reservation is open.** Below `lg` the action bar carries a second line « Prénom Nom ·
    N° 6646665983 · 07/08 → 13/08 », ellipsised, in place of the centred name it shows from `lg`.

### Calendar (proposal 21)

13. **A closure is a texture, never a lane.** In the all-logements calendar a closure no longer draws
    a bar. A closure of every logement hatches the whole day cell; a closure of one logement hatches a
    band along the bottom of its days. One label per week row, on the first closed day: « Aventura
    lodge fermé », or « Tout fermé » for a global closure. The label is reachable from the keyboard and
    its name carries the dates; the tooltip shows them too. The phone agenda shows the closure as one
    hatched row.
    **Superseded 2026-10-28** for a logement's closure by `calendar-property-parity.md` rules 9-11: it is
    a hatched bar in its logement's lane group with a stay's half-day edges. A global closure keeps the
    column hatch.
    > **Sans test** — superseded by `calendar-property-parity.md` rules 9-11, which carry the tests of the closure bars.
14. **Legible stay bars.** A stay bar is a soft tint of its platform colour (14 %), a 3 px stripe of the
    platform colour on its left edge and ink text: AA on every platform colour, including the yellow
    ones. The phone agenda's platform chip uses the same tint and ink text. A past stay fades to 65 %,
    not 50 %, so its text keeps 3:1.
    **Superseded 2026-10-28** by `calendar-property-parity.md` rules 4-8: a current or future stay is a
    solid bar with a server-chosen text colour (≥ 4.5:1); the tint is kept for past stays only.
    > **Sans test** — superseded by `calendar-property-parity.md` rules 4-8, which carry the tests of the stay bars.
15. **A folded legend with real names.** The platform legend is folded behind « Légende » (closed by
    default) and prints display names: « Gîtes de France », « GreenGo », never a raw key. The name comes
    from the server, with each row of the reservation list (`platformDisplay`): one source.
16. **A usable property filter on a phone.** With three logements or fewer the filter is a segmented
    control « Tous | Gite | Aventura lodge », full width on a phone; with more, a select that takes the
    full width on a phone. « Tous » is the all-logements calendar, a logement opens its own calendar
    (unchanged).

### Quote PDF (proposal 22)

17. **The Maison identity.** Fir green (`#2F5D46`) for the rules, the table header and the total band;
    ink (`#27251F`) for the text; the serif (Source Serif 4, embedded) for « DEVIS », the company name
    and the section headings; figures in the sans with tabular widths. No navy anywhere. The serif and
    the sans are embedded full-coverage files, a title drawn run by run with the face that has its
    glyphs (rules 27-29, owner decision 2026-10-20, which replaced the Latin / Latin Extended serif
    subsets and the standard Helvetica of the body). The fonts ship with their OFL notice (© Adobe).
18. **Offered lines grouped.** Every line offered to the guest (options, resources, the extra-guest
    supplement) prints in ONE row « Offert avec le séjour » that names them, billed 0,00 € and showing
    their value once (« valeur 115,00 € »); its quantity cell stays empty. The table, the sub-totals and the grand total are unchanged
    in money (`devis-pdf-total-parity.md`).
19. **The total on page 1.** A summary block right after the stay section prints the grand total TTC
    and the schedule (acompte, solde or single payment, with their due dates). Its total is the same
    resolved figure as the totals block after the table, whatever the table's length.
20. **No « (expiré) » on the guest's document; « prolonger » announced, and only on an open quote.**
    The PDF prints the validity date alone (amends `devis-pdf-and-tourist-tax-fixes.md` rule 21). The
    operator is warned on the fiche instead. The server says whether a quote may be re-issued
    (`extendable`: expired AND still draft or sent). Only then does the chip read « Périmé ·
    prolonger »; an accepted expired quote reads « Périmé », a converted one shows no chip. Touching
    « prolonger » first asks the server what it would change (`GET /api/devis/:id/extension`: the new
    validity, the total and the schedule today and after — a stay re-priced at today's tariffs, and a
    direct quote with no acompte owing a single payment on its new validity date,
    `deposit-blocks-the-dates.md` rule 17), shows it in a confirmation (with a warning when the fiche
    holds unsaved changes), and only on « Prolonger » re-issues it (`POST /api/devis/:id/extend`),
    reloads the fiche from it and confirms with a toast. The preview and the extension run the same
    computation on the stored quote. The server refuses both for a quote that is not extendable (409),
    and refuses any save of a converted quote (409 `DEVIS_CONVERTED`): its reservation is edited
    instead. (Reworded 2026-10-19 after review: the chip used to save the fiche straight away, on a
    converted quote too.)

### Quotes list, after review

21. **A stale quote says so in the list.** Each list row carries `expired` (never on a converted
    quote) and `extendable`. An expired quote shows a « Périmé » badge under its status, and
    downloading its PDF — whose validity date is past — asks first (« Télécharger quand même »).
22. **Back from a page opened directly stays in the app** (integrated review of inte/plugins,
    2026-10-19, P1). A reservation opened from a link in a new tab (no `from`, nothing of the app behind
    it: React Router's `history.state.idx` is 0 or absent) used to `navigate(-1)` on save and leave the
    app for about:blank. Saving, « Retour » and leaving go to the planning instead (a quote: the quotes
    list), replacing the entry. With an app page behind, back is one step as before; a `from` wins.
23. **The quotes list opens from the keyboard** (integrated review, 2026-10-19, P3). The quote number
    of each row (table and phone card) is a link to what the row opens — the quote, or its reservation
    once converted — named « Ouvrir le devis <n° > »: Tab reaches it, Entrée opens it. The rest of the
    row stays clickable with the mouse.
24. **The mini planning's arrows are named** (integrated review, 2026-10-19, P3). They move the strip by
    one day: « Jour précédent » / « Jour suivant » (the review's « Mois précédent / suivant » would
    have announced a jump they do not make).
25. **A long logement name stays readable in the segmented filter** (integrated review, 2026-10-19,
    L7). Under `sm` a segment takes the width its label needs and wraps on two lines (« Aventura /
    lodge ») instead of ending in an ellipsis; from `sm` the segments keep one line (rule 16).
26. **The way back survives the unsaved-changes guard; a logement and a phone finger too** (review of
    PR #728). The guards that keep a dirty page on Back (`useDirtyFormGuard`, the reservation page,
    the logement page) put the page's own router state back (`pushState(<page state>)`), never `null`:
    a null entry lost `idx`, so after « Rester » the next « Retour » believed the page was opened
    directly and went to the planning. A logement opened directly goes back to the logements list
    (`/properties`), not the planning. On a phone the quote-number link of rule 23 is 44 px tall.

### Quote PDF, every alphabet (owner decision 2026-10-20)

27. **Every word of the quote is drawn by an embedded face** (owner decision 2026-10-20: « une police
    qui prend tout en compte »). The body (names, addresses, lines, totals, schedule) is Source Sans 3
    — Regular, Semibold where Helvetica-Bold was, Italic where Helvetica-Oblique was — the sister of
    the Source Serif 4 Semibold of the titles, so the document keeps one voice. Each face is ONE
    upstream release file (Adobe, SIL OFL 1.1, unmodified, CFF-flavoured WOFF2 — fontkit cannot
    subset the TrueType flavour's composite glyphs) covering Latin, Latin Extended-A in full, the
    Romanian comma-below letters, Vietnamese, modern Greek and Cyrillic; PDFKit embeds only the glyphs
    a document uses. « Łukasz Wójcik », « Çağrı Yılmaz », « Dvořák », « Nguyễn Thị Ánh »,
    « Γιώργος », « Анастасия » print as typed. The PDF standard fonts (WinAnsi only — they garbled
    every one of those names) remain only as the fallback of a font file that is missing or unreadable
    (empty, truncated, not a font): each face is opened when the document starts, so a bad file falls
    back to its standard face for that role and the quote is still produced, never a 500.
28. **A title borrows the sans for a glyph the serif lacks.** The serif misses a handful of letters
    the sans has (« Ŧ », « Ĳ », some Cyrillic of minority languages): a company name is still drawn run
    by run, the serif first, then the embedded sans Semibold. The runs use the faces the document
    actually registered: with a standard serif (rule 27) or no coverage readable, the whole name stays
    in that serif, and a standard bold is never borrowed.
29. **Scripts no embedded face covers never break the document** (owner decision 2026-10-20). CJK,
    Arabic, Hebrew, Thai, emoji: the quote is still produced, every line is kept, and each uncovered
    character prints as an empty box in place, the rest of the text intact; right-to-left text is not
    reordered. No multi-megabyte CJK or Arabic font is embedded: the four faces add about 0.5 MB to the
    release archive. The operator sees the boxes on the PDF before sending it.
30. **A long text stays inside its box.** The serif company name in the header shrinks from 20 pt down
    to 13 pt to hold its line above the rule, then takes two lines at most and ends in an ellipsis; in
    the footer it keeps one line, cut with an ellipsis (a wrapped footer ran below the page and made
    PDFKit add empty pages); an issuer or client line that wraps (a long
    name, an address) pushes the following lines down instead of printing over them; the value of a
    meta pill shrinks from 10 pt down to 8 pt, then takes two lines at most and ends in an ellipsis.

**Edge cases:**
- A SAS with only intro and recap → « 1 sur 2 », « 2 sur 2 ».
- A quote with no deposit and a platform channel → the page-1 block prints the solde alone.
- A quote with no offered line → no « Offert avec le séjour » row.
- A fiche before its first quote → no bar (nothing to render yet).
- A calendar week where two logements close → two bands, two labels, still no lane.

31. **One headline, live or stored (audit 2026-10-27).** « Total du séjour » counts the tourist tax as
    the books know it: the amount the platform withheld when the operator stated it, else the tax the
    stay carries (0 when the platform handles it). The engine's estimate of a tax the platform
    handles is not a stored fact: reading it live printed 506 on an Airbnb brut of 500 that the
    stored row printed 500. « Total perçu » is the engine's `sejourNetTotal` on both sides: the stored
    row adds every bucket — caisse interne included — net of the commissions, plus the mid-stay
    notes, minus the book refunds, plus the arrival payment adjustment (`quoteHeadline.storedNetTotal`).
    A complement collected in caisse interne made the stored headline show « Total perçu 306 » where
    the live one showed nothing. The finance pages keep their own caisse-interne carve-out.
32. **The pricing summary's closing cascade is served (audit 2026-10-27).** The quote carries
    `summaryCascade = { grossTotal, offeredTaxDeduction, onSiteTotal, commissionBase }`; the panel
    prints it and computes none of it. `grossTotal` is rule 31's gross; the « Taxe de séjour
    (plateforme) » deduction is the withheld amount only (an estimate is no longer added then taken
    back); `onSiteTotal` = arrival + end-of-stay complements + mid-stay notes; `commissionBase` = the
    pre-arrival amount.

---

## 4. Architecture

> Fat backend, thin frontend: the headline figure (rule 10), the list row total, origin and validity
> (rules 5, 9, 21), whether a quote may be re-issued and what that would change (rule 20), whether
> anything was owed at the door (rule 4) and a platform's display name (rule 15) come from the server. The SAS step numbering (rule 3) is wayfinding over
> the dialog's own page list and stays in the plugin; the calendar's bar geometry was already a
> render-only layout (`cumulative-month-calendar.md`).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `quoteHeadline.js` | C | Pure `quoteHeadline(quote, { isPlatform })` → `{ label, amount, secondary }` (rule 10). |
| `utils/` | `pricing.js` | T | `calculateReservationQuote` returns `headline` (rule 10). |
| `utils/` | `devisListRow.js` | C | Pure shaper of a quotes-list row: `totalTtc`, `originLabel` null when unknown, `expired`, `extendable` (rules 5, 9, 21). |
| `utils/` | `devisValidity.js` | T | `isDevisExtendable(row, today)`: expired and still draft/sent (rule 20). |
| `models/` | `devisModel.js` | T | `list()` through `devisListRow`; `extendable` on the full quote; `previewExtension` / `extend` on the same payload; `update` refuses a converted quote (rules 5, 9, 20, 21). |
| `controllers/` | `devisController.js` | T | `extensionPreview`, `extend` (rule 20). |
| `routes/` | `devis.js` | T | `GET /:id/extension`, `POST /:id/extend` (rule 20). |
| `utils/` | `platformDisplay.js` | C | A platform's display name (rule 15). |
| `controllers/` | `reservationsController.js` | T | `list` rows carry `platformDisplay` (rule 15). |
| `plugins/sas/` | `nothingToCollect.js` | C | Pure: was anything owed at the door before this run (rule 4). |
| `plugins/sas/` | `controller.js` | T | The SAS payload carries `nothingToCollect` (rule 4). |
| `utils/` | `devisPdf.js` | T | Maison palette + serif drawn run by run, rows built before drawing, offered lines grouped, page-1 summary, no expired suffix (rules 17-20). `FACES` / `registerFaces` embed the serif and the three sans faces for every text, the PDF standard fonts only for a missing file; `faceHasGlyph` reads coverage from the font files; `fitFontSize` / `nextLineY` keep long texts in their boxes (rules 27-30). |
| `utils/` | `devisPdfLabels.js` | T | `offeredGroup`, `offeredValue`, `summaryHeading`; `expiredSuffix` removed (rules 18-20). |
| `assets/fonts/` | `SourceSerif4-Semibold.otf.woff2`, `SourceSerif4-OFL.txt` | C | Embedded serif of the PDF and its licence notice (SIL OFL, © Adobe; upstream release `adobe-fonts/source-serif` 4.005R, unmodified). Replaces the two `@fontsource` subsets (rules 17, 27). |
| `assets/fonts/` | `SourceSans3-Regular.otf.woff2`, `SourceSans3-Semibold.otf.woff2`, `SourceSans3-It.otf.woff2`, `SourceSans3-OFL.txt` | C | Embedded body of the PDF and its licence notice (SIL OFL, © Adobe; upstream release `adobe-fonts/source-sans` 3.052R, unmodified) (rule 27). |
| — | `server/package.json` | T | `fontkit` declared (it was only reached through `pdfkit`): the coverage of rules 28-29 reads the font files with it. |
| `plugins/sas/` | `manifest.json` | T | 1.0.4 + changelog line (rules 1-4). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | Footer order, neutral alternative, « N sur M », « Rien à percevoir » (rules 1-4). |
| `plugins/sas/` | `sasStepNumbering.js` | C | Pure `stepNumbering(activeKeys, key)` → `{ number, total }` (rule 3). |
| `pages/` | `DevisPage.jsx` | T | `totalTtc`, nowrap amounts, « ⋯ » menu, PDF icon from `md`, cards below `lg`, « Périmé » + PDF confirmation (rules 5-8, 21). |
| `components/` | `ResponsiveTable.jsx`, `DataPageScaffold.jsx` | T | Generic prop `cardsBelow` (rule 8). |
| `components/` | `RowActionsMenu.jsx` | C | Generic « ⋯ » row menu: items, a danger item last, optional always-visible icon actions from a breakpoint (rules 6-7). |
| `components/` | `StickyTotalBar.jsx` | C | Generic bottom bar below a breakpoint: label + amount + secondary, cross-fade, `bleed` over the page padding, opens a bottom sheet with `children` (rule 11). |
| `components/` | `PageActionBar.jsx` | T | Generic prop `identity` + `identityBelow`: a second ellipsised line under the bar below a breakpoint (rule 12). |
| `components/reservation/` | `DevisValidityChip.jsx` | C | The quote's validity chip, extracted from the page; « prolonger » only when `extendable` (rule 20). |
| `components/reservation/` | `DevisExtensionSummary.jsx` | C | The confirmation's content: new validity, total and schedule today vs after (rule 20). |
| `pages/` | `ReservationPage.jsx` | T | Mounts `StickyTotalBar` with `pricingQuote.headline` + the summary; identity line; preview → confirm → extend → reload (rules 11, 12, 20). |
| `api.js` | `api.js` | T | `getDevisExtension`, `extendDevis` (rule 20). |
| `components/` | `CumulativeMonthCalendar.jsx` | T | Closures out of the lanes into cell hatching + week labels, tinted bars, folded legend (rules 13-15). |
| `components/` | `SegmentedSelect.jsx` | C | Generic: a segmented control while the options fit, a labelled select past that; full width on a phone (rule 16). |
| `pages/` | `CalendarPage.jsx` | T | « Tous | logements » filter through `SegmentedSelect` (rule 16). |
| `plugins/sas/` | `ReservationSasDialog.jsx` (bis) | T | Badge from the server's `nothingToCollect`, hidden while the caution is deferred; progress bar on N / M (rules 3-4). |

**Component reuse declaration.** Created generic: `StickyTotalBar` (the quote editor and the SAS recap
are the next users named by the review), `RowActionsMenu` (every list with per-row actions: clients,
devis, options), `SegmentedSelect` (every short exclusive filter). Page-specific: `DevisValidityChip`,
`DevisExtensionSummary`. Consumed: `PageActionBar`, `StatusBadge`, `PricingSummary`, `DataPageScaffold`,
`ConfirmDialog` through `useAppDialogs`.

### 4.3 API contract

- `POST /api/reservations/calculate-price` (and every quote): adds `headline: { label, amount,
  secondary: { label, amount } | null }`. Additive.
- `GET /api/devis` rows: adds `totalTtc`, `expired`, `extendable`; `originLabel`/`originDetail` are null
  for a website request with no attribution. `GET /api/devis/:id` adds `extendable`.
- `GET /api/devis/:id/extension` (new): `{ validUntil, current: { validUntil, totalTtc, schedule[] },
  next: { totalTtc, schedule[] } }`, schedule lines `{ label, amount, dueDate }`; 409 when not extendable.
- `POST /api/devis/:id/extend` (new): the re-issued quote (same shape as `GET /api/devis/:id`); 409 when
  not extendable.
- `PUT /api/devis/:id` on a converted quote: 409 `DEVIS_CONVERTED` (was 200, re-dating it).
- `GET /api/reservations` rows: adds `platformDisplay`.
- `GET /api/reservations/:id/sas`: adds `nothingToCollect`.

**Integrated review of inte/plugins (2026-10-19)** — rules 22–25:
- Client `utils/navigation.js`: `hasInAppHistory()`, `navigateBack(navigate, fallback)`,
  `DEFAULT_BACK_PATH = '/planning'`; `navigateBackWithFrom` falls back instead of leaving the app.
  `pages/ReservationPage.jsx` uses them (the quote mode falls back to `/devis`).
- Client `pages/DevisPage.jsx`: the quote number is a `Link` to `editPathOf(devis)`.
- Client `components/MiniPlanningStrip.jsx`: named arrows.
- Client `components/SegmentedSelect.jsx`: segments wrap under `sm`.
- Client `hooks/useDirtyFormGuard.js`, `pages/ReservationPage.jsx`, `pages/PropertyDetail.jsx`: the
  Back guard re-pushes the page's state; `PropertyDetail` falls back to `/properties` (rule 26).

**Audit 2026-10-27 (rules 31-32).** `utils/quoteHeadline.js` — `stayGross` reads the stored-fact tax,
new `storedNetTotal` and `summaryCascade`; `utils/pricing.js` sets `quote.summaryCascade`;
`controllers/reservationsController.js` `storedHeadlineOf` uses `storedNetTotal`;
`client/src/components/PricingSummary.jsx` renders `summaryCascade`.

## 5. Data model

None. Binary assets: four embedded fonts (Source Serif 4 Semibold; Source Sans 3 Regular, Semibold,
Italic) and their two OFL licence notices in `server/src/assets/fonts/` (rules 17, 27).

## 6. UI / UX

- **SAS** — phone: buttons full width, alternative on top, primary at the bottom; header « 3 sur 9 ».
  `sm+`: side by side, primary on the right.
- **Quotes list** — below `lg` (phone and tablet): cards, the PDF icon beside « ⋯ » from `md`, caption
  « Logement · dates », « Périmé » under the status of a stale quote. From `lg`: columns N° devis,
  Statut, Client, Séjour (logement over its dates), Montant TTC (`nowrap`), then a download icon and
  « ⋯ ».
- **Reservation fiche** — phone and tablet (< 1200 px): the identity line under the action bar, the
  total bar flush with the screen's bottom and edges, frosted, with the safe-area inset, the sheet with
  its grab handle. An expired open quote: « Périmé · prolonger » → a confirmation listing the new
  validity, total and schedule → the fiche reloads re-issued. Desktop: unchanged (sticky summary column, centred name).
- **Calendar** — phone: full-width segmented filter, agenda rows with tinted chips, a hatched closure
  row. Desktop: hatched closed days, one label per week, tinted bars, « Légende » folded.
- **PDF** — A4: fir-green rule under the company block, serif « DEVIS », the summary block on page 1.
  Body in Source Sans 3; a guest's name in Polish, Turkish, Czech, Vietnamese, Greek or Cyrillic prints
  as typed; a long company name shrinks on its line, a long client name pushes the address down
  (rules 27-30).

Validated rendering: the review's mocks; the two departures from them (decisions 6 and 7) and the
step numbering are shown in `docs/specs/2026-10-19-ui-review-operations.html`.

## 7. Test plan

- Server (34 tests): `ui-review-operations-headline.unit.test.js` (rule 10) — 7;
  `ui-review-operations-devis-list.unit.test.js` (rules 5, 9) — 3;
  `ui-review-operations-devis-pdf.unit.test.js` (rules 17-20) — 9;
  `ui-review-operations-devis-extension.unit.test.js` (rules 20, 21) — 5;
  `ui-review-operations-platform-display.unit.test.js` (rule 15) — 1;
  `plugins/sas/tests/sas-nothing-to-collect.unit.test.js` (rule 4) — 4. `devis-reissue-dates-and-expiry`
  rewrites its rule-21 case for the amended rule.
- Client (34 tests): `ReservationSasDialog.thumb-footer.test.jsx` (rules 1, 2, 4) — 7;
  `ReservationSasDialog.step-counter.test.jsx` (rule 3) — 1; `sasStepNumbering.test.js` (rule 3) — 2;
  `DevisPage.row-menu.test.jsx` (rules 5-8, 21) — 6; `StickyTotalBar.test.jsx` (rule 11) — 4;
  `PageActionBar.identity.test.jsx` (rule 12) — 2; `DevisValidityChip.extend.test.jsx` (rule 20) — 4;
  `CumulativeMonthCalendar.closures-and-bars.test.jsx` (rules 13-15) — 6;
  `CalendarPage.property-filter.test.jsx` (rule 16) — 2.
  Existing suites updated for the new wording (« Caution perçue », « Rien à percevoir », the folded
  legend); the SAS fixtures carry `nothingToCollect`. Shared fixture:
  `components/__tests__/viewportFixture.js` (a width for `useMediaQuery`).
- E2E: `reservations/ui-review-2026-10-19-operations.spec.js` (rules 11, 12, 16) — 3 tests at 390 and
  1280 px; `review-2026-10-18-layout.spec.js` reads the filter by its label.
- Manual (Playwright, neutralised copy of the Solio data): 390 / 900 / 1280 px on the quotes list, the
  calendar, a Booking and a direct fiche, an expired open quote (preview, confirm, extension) and a
  converted one (no chip), the arrival SAS walked through its 9 steps; no horizontal scroll at 390 px.
  The PDF of quote 22274 (six offered lines) checked with `qlmanage -t`: one « Offert avec le séjour »
  row, total on page 1, no « (expiré) ».

**Integrated review of inte/plugins (2026-10-19)** — rules 22–26: `utils/__tests__/navigation.back-fallback.test.js` (3),
`hooks/__tests__/useDirtyFormGuard.history-state.test.jsx` (1, rule 26),
`pages/__tests__/DevisPage.keyboard.test.jsx` (5: the link at 1280 and 390 opens with Entrée, a
converted quote links to its reservation, the mini planning arrows, the 44 px link on a phone),
`components/__tests__/SegmentedSelect.phone-wrap.test.jsx` (2).

**Every alphabet in the quote PDF (owner decision 2026-10-20)** — rules 27–30:
`server/src/tests/devis-pdf-font-coverage.unit.test.js` (8: the font dictionary of a quote naming
guests in Polish, Turkish, Czech, Vietnamese, Greek and Cyrillic holds the four embedded faces and no
standard font; each body face covers Latin Extended-A, Vietnamese, modern Greek and Cyrillic in full;
every letter of the six names is drawable; CJK / Hebrew / Arabic / Thai / emoji render without throwing
and keep their line; the fitted size and the wrapped-line advance; an empty / truncated / non-font
file falls back to the standard face and the quote still renders; the runs follow the registered
serif; a 130-character company name takes two header lines at most and adds no page through the
footer). `ui-review-operations-devis-pdf`
rewrites its rule-17 cases for the single serif file and the sans fallback (rule 28) and checks both
licence notices. Manual: `qlmanage -t` page 1 and every page through PDFKit (Swift) of sample quotes
before and after — Latin Extended, Vietnamese, Greek + Cyrillic, CJK + RTL, and a 30-line quote with a
long company and logement name.

**Audit 2026-10-27:** `tests/quote-headline-live-stored-parity.unit.test.js` (3, rules 31-32);
`tests/ui-review-operations-headline.unit.test.js` adjusted to the rule-31 tax; the
`PricingSummary.commission` / `.platform-tourist-tax` client suites feed `summaryCascade`.

## 8. Out of scope

- Payments as a ledger of states (decision 8) — its own spec.
- The pricing summary's hero figure and waterfall (proposal 6 of the zone report, not retained); the
  bar's headline is the only hero.
- « Reste à percevoir » in the bar: the outstanding amount belongs to the payments ledger.
- The per-logement calendar (`CalendarDayCell`) already hatches its closures.

## 9. Open questions

None. The undecided details took the review's recommendation: the counter numbers questions, not pages
(rule 3); the PDF summary block repeats the schedule rather than moving it (rule 19).
