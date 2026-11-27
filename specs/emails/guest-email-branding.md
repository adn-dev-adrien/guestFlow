# Guest emails wear the house's identity — logo, colours, a night variant

| Field | Value |
|---|---|
| **Status** | Approved (2026-11-27) |
| **Branch** | `feature/guest-email-branding` |
| **Created** | 2026-11-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary for review** | `specs/emails/guest-email-branding-resume.html` (interactive) |

---

## 1. Context

Every guest email leaves as text + HTML (`specs/emails/guest-email-texts-made-simple.md` rules 37–39). The HTML part
(`server/src/utils/guestEmailHtml.js`) is GuestFlow's « Maison » look: ink on `#F8F5EF` paper, fir-green links, the
sender's name in a serif heading, **no image**, and a **dark variant** (`#1E1D1A` background) chosen by the reader's device.

On 2026-11-27 Adrien previewed the new J-7 on a Mac in dark mode and saw a black email. Two problems:

- the dark variant is near-black, the opposite of Domaine Solio's « forêt et heure dorée » identity (warm stone paper,
  fir, golden ochre — the showcase site's and the « Mon séjour » app's);
- the email carries no logo, although the company logo is already stored (Paramètres › Entreprise, `companyLogoPath`,
  used by the devis PDF).

The same check showed that the J-7 and J-2 are « Manuel » templates: three of them were never sent in November because
nobody validated them. Adrien wants them automatic once this format ships (§3 rule 9).

## 2. Goal

A guest opening any GuestFlow email sees a letter from the house: its logo, its colours, the same on every device.

## 3. Functional rules

1. **A letter on stone paper.** The HTML part is a white card (the letter), at most 600 px wide, centred on the
   page colour; 1 px line around the card, small radius (4 px, the site's square cut), generous inner padding
   (32 px, 20 px on a phone). The text rules of rules 38 and 40 of `guest-email-texts-made-simple` are unchanged:
   the HTML still says what the text says and nothing more.
2. **The logo heads the letter.** When a company logo is stored, it is drawn centred at the top of the card, 72 px
   high (rendered from a 2× image), with the sender's name (`fromName`) under it in a serif, then a thin accent rule.
   No logo stored → the sender's name alone, as today. A logo the server cannot read (rule 8 of `settings.md`) →
   no logo, never no email.
3. **The logo travels with the email.** It is an inline attachment (`Content-ID`, `cid:` reference), resized by
   the server to 144 px high PNG. Nothing is loaded from the network: no remote image, font, stylesheet or pixel
   (rule 39's « self-contained » stands; only « no image » is lifted; rule 39's dark variant is replaced by rule 4).
   The `text/plain` part is unchanged.
4. **A night variant** (Q1, 2026-11-27). The email declares `color-scheme: light dark` and carries a
   `@media (prefers-color-scheme: dark)` block that switches to the night palette: page `#161C16`, card `#1F261E`,
   card line `#2E3B2A`, text `#ECE8DF`, muted `#B9B3A6`, links `#E2B46A`; the accent rule keeps `emailColorAccent`.
   The night palette is fixed (not in Settings): a warm dark that reads with any accent. Clients that ignore the
   media query (Gmail, Outlook desktop) show the day version, which is complete on its own.
4bis. **The night logo.** Paramètres › Entreprise gains an optional second upload, « Logo sur fond sombre »
   (`companyLogoDarkPath`, same upload rules, files and checks as the company logo — `settingsController` logo
   upload/delete, `printableLogo`). The email carries both images inline (two `cid:`); the day one shows by default,
   the night one only inside the dark media query (`display:none` + `max-height:0;overflow:hidden;mso-hide:all` by
   default). No night logo stored → the night variant shows the day logo on a white rounded tile (8 px radius,
   10 px padding), so a logo drawn on white never sits as a white box on the dark card.
5. **The house's colours, from Settings.** Three colours drive the HTML: page (`emailColorPage`), accent
   (`emailColorAccent`, the rule under the heading) and links (`emailColorLink`). Defaults are Maison's (paper
   `#F8F5EF`, honey `#C99038`, fir `#2F5D46`): an installation that sets nothing gets today's palette, light only.
   Text stays ink `#22271F` / muted `#5C6153` on the white card: not configurable, so contrast cannot be broken.
6. **A colour is refused where it is typed.** Each field accepts `#RRGGBB` only. The link colour must reach 4.5:1
   on white, the accent 3:1 (it is a rule, not text): below that the server refuses the save with the measured
   ratio (« Contraste 3,6:1 sur fond blanc — 4,5:1 minimum pour les liens »), and the field shows it.
7. **Solio's values** (set through the API after the release, not by a migration — no house is hard-coded):
   page `#F5F0E6` (pierre), accent `#B87B2A` (ocre), links `#2E3B2A` (sapin).
8. **Every guest email, one look.** The sequence, the confirmation, the automatic pass, the manual send, payment
   links, « M'envoyer un test » and the preview: all go through `guestEmailMessage`. The preview shows the logo
   from a `data:` URI (a sandboxed frame cannot resolve `cid:`); the sent email uses `cid:`.
9. **After the release, J-7 and J-2 switch to « Auto »** (Adrien, 2026-11-27), set by Claude through the API once
   the version is installed and a test email has been checked. Never before: they must not leave in the old
   format. `specs/emails/no-automatic-email-without-approval.md` is respected — the operator chose it.

## 4. Architecture

### Server
| Layer | File | Responsibility |
|---|---|---|
| utils | `guestEmailHtml.js` (edit) | Letter layout, palette from settings, day/night logo slots (`cid:` or `data:`), night media block |
| utils | `emailLogo.js` (new) | Stored company logo (day and night) → 144 px-high PNG bytes, cached by path + mtime; null when unreadable |
| utils | `emailService.js` (edit) | Pass `attachments` (inline, `cid`) through to the transport |
| utils | `emailColors.js` (new) | Hex validation + WCAG contrast ratio on white; the refusal message |
| models | `settingsModel.js` (edit) | Three colour columns + `companyLogoDarkPath` |
| controllers | `settingsController.js` (edit) | Night logo upload / delete (`POST/DELETE /api/settings/logo-dark`), same checks as the logo |
| controllers | settings controller (edit) | Validate the three colours on save (rule 6) |
| controllers | `emailsController.js` (edit) | Preview HTML with the `data:` logo |
| database | `database.js` (edit) | `ALTER TABLE app_settings ADD COLUMN emailColorPage/Accent/Link TEXT`, `companyLogoDarkPath TEXT` (NULL = default / none) |

Send paths (`guestEmailSequenceRunner`, `emailAutoSendRunner`, `reservationEmailSender`, `standaloneSaleLinks`)
keep calling `guestEmailMessage`, which becomes async to read the logo.

### Client
| Layer | File | Responsibility |
|---|---|---|
| components | `SettingsSmtpSection.jsx` (edit) | « Couleurs des e-mails » : three colour fields (swatch + hex), server error under the field |
| components | `SettingsCompanySection.jsx` (edit) | « Logo sur fond sombre » upload beside the logo, same control |
| hooks | `useSettingsForm.js` (edit) | Map the three fields and the night logo |

No new generic component: a colour field is a `TextField` with a swatch adornment, used once.

### API
`PUT /api/settings` accepts `emailColorPage`, `emailColorAccent`, `emailColorLink` (`#RRGGBB` or empty = default);
400 `INVALID_EMAIL_COLOR` with the field and the French message. `GET` returns them.

## 5. Data model
`app_settings`: four nullable TEXT columns. Existing rows: NULL → Maison defaults, so the email changes only in
layout (card, light only) until the operator sets colours. No data loss.

## 6. UI / UX
See the interactive summary. Phone: the card fills the width minus 12 px, padding 20 px, logo 56 px high.
Settings fields stack on xs.

## 7. Test plan
- Server unit (`tests/guest-email-branding.unit.test.js`): letter layout; logo present → `cid:` + attachment; absent or
  unreadable → heading only, email still built; night block present with the fixed palette; night logo stored → second
  `cid:` shown only in the dark block; no night logo → day logo on the white tile in the dark block; colours applied;
  invalid hex and low contrast refused with the ratio; text part byte-identical; night logo upload/delete.
- Client (`SettingsSmtpSection.email-colors.test.jsx`): fields render, server refusal shown under the field.
- Manual: « M'envoyer un test » to an iPhone (Mail, dark mode on and off) and to Gmail web; preview in Réglages.

## 8. Out of scope
Per-template colours, a header photo, buttons for links, night colours in Settings, editing the logo from the e-mail screen.

## 9. Open questions

Resolved 2026-11-27 by Adrien on the interactive summary:
- Q1 Dark mode → **night variant** (rules 4, 4bis). Night palette fixed; optional night logo, white tile without it.
- Q2 Logo placement → **centred above the name**.
- Q3 Heading → **logo + the house's name**.
- Q4 Identity → **Settings, three colours**; Solio's values `#F5F0E6` / `#B87B2A` / `#2E3B2A` (rule 7).
