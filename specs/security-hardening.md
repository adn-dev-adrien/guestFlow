# Security hardening — CORS, headers, rate limiting, uploads, validation

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/security-hardening` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc S — Security hardening (PR 2 of 2). See `specs/ROADMAP.md`. |

---

## 1. Context

PR 1 (`security-auth-encryption.md`) added authentication + credential encryption. The remaining audit
findings are the lower-severity-but-still-important hardening items:

- **CORS** is an allowlist with credentials (set in PR 1) but still defaults permissively in dev and
  isn't formalized for prod.
- **No HTTP security headers** (helmet absent): no HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
  CSP, etc.
- **No real rate limiting** — only a minimal in-memory login throttle from PR 1.
- **Upload hardening gaps:** the document upload (`properties.js:511-519`) uses disk storage with the
  extension taken from the user's filename, **no size limit, no fileFilter**; the logo upload takes the
  extension from the filename without a whitelist. (Photo upload is already MIME-checked + size-capped.)
- **Money/percentage inputs are validated only at `calculate-price`**, not at the actual write
  endpoints (reservations/devis/resourceBookings create/update/payment).

## 2. Goal

Close the remaining hardening gaps so the internet-exposed instance resists common attacks: locked-down
CORS, security headers (incl. a CSP tuned for the app), rate limiting on the API and login, safe file
uploads, and authoritative money validation at every write boundary.

## 3. Functional rules

**CORS**
1. CORS is a strict allowlist with `credentials: true`, driven by `CORS_ORIGINS` (comma-separated). Dev
   default `http://localhost:3000`. In production the app is same-origin (Express serves the SPA), so
   cross-origin requests are rejected unless explicitly allowlisted.

**Security headers (helmet + adapted CSP)**
2. `helmet()` is enabled (`X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, etc.).
   **HSTS and CSP are enforced in production only** (`NODE_ENV === 'production'`). Both assume HTTPS: HSTS
   pins the host to `https`, and helmet's default CSP includes `upgrade-insecure-requests`. Over a
   plain-HTTP dev session they upgrade `http://localhost` asset requests to `https://localhost`, which
   fails with a TLS error (observed in Safari: the document loads but `main.<hash>.js` fails). Production
   runs behind an HTTPS reverse proxy where both are correct; in development they are disabled
   (`contentSecurityPolicy: false`, `strictTransportSecurity: false`).
3. The production **Content-Security-Policy tuned for the app**: `default-src 'self'`;
   `img-src 'self' data: blob:` (uploaded images); `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
   (MUI/emotion inline styles + Google Fonts stylesheet); `font-src 'self' data: https://fonts.gstatic.com`;
   `script-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; plus helmet's
   default `upgrade-insecure-requests`. To keep `script-src 'self'` (no `unsafe-inline`), the client is
   built with `INLINE_RUNTIME_CHUNK=false` so CRA does not inline its runtime script. (The Inter web font
   is loaded from Google Fonts in `client/public/index.html`.)
4. CSP must not break the running app — verified against a **production build served by Express** with
   `NODE_ENV=production`. In dev (`npm run dev`), CSP/HSTS are off, so opening the Express-served build at
   `:4000` over HTTP no longer triggers the TLS upgrade; the dev CRA server (`:3000`) is unaffected.

**Rate limiting (`express-rate-limit`)**
5. **Login**: max **10 attempts / 15 min / IP** on `POST /api/auth/login` → `429 TOO_MANY_ATTEMPTS`.
   Replaces the PR 1 in-memory throttle.
6. **Global API**: max **300 requests / 15 min / IP** across `/api` → `429`. Both limits configurable via
   env (`LOGIN_RATELIMIT_MAX`, `API_RATELIMIT_MAX`, window overrides). The public iCal export is exempt
   from the global limit (external pollers) or given a generous separate allowance.

**Upload hardening**
7. **Document upload** gets a size limit (e.g. 10 MB) and an **extension + MIME allowlist**
   (pdf/jpg/png/webp/…); rejected files return a clear `400`. Stored filenames are sanitized and the
   extension comes from the allowlist, not raw user input.
8. **Logo upload** extension is whitelisted (png/jpg/jpeg/webp/gif), not taken verbatim from the filename.
9. **Path containment**: file deletion helpers resolve the path and verify it stays within `uploads/`
   (`path.resolve` + prefix check) before unlinking.

**Money validation at write boundaries**
10. `validateFinanceInputs` (from PR 1's `financeValidation`) is enforced on every write that accepts
    money/percentage from the client: reservations `POST /`, `PUT /:id`, `PATCH /:id/payment`; devis
    `POST /`, `PUT /:id`. Invalid → `400 NEGATIVE_AMOUNT|NOT_A_NUMBER|INVALID_PERCENTAGE` before any DB
    write. **resourceBookings is excluded**: its total price is computed server-side
    (`computeBookingTotalPrice`), the client sends no money amount, so there is nothing to validate at
    that boundary.

**Logs**
11. No secret (password, private key, session secret, encryption key) is ever logged. Verified; a short
    helper/convention documented to keep it that way.

**Edge cases**
- Legitimate burst (saving a reservation with many sub-requests) stays well under 300/15min.
- iCal export polled frequently by an external service is not throttled out.
- An upload with a spoofed extension but disallowed MIME (or vice-versa) is rejected.
- CSP: an uploaded image renders (`img-src data:`/`'self'`); MUI styles render (`style-src 'unsafe-inline'`).

---

## 4. Architecture

> All enforcement is server-side middleware/validation. The only client change is a build flag
> (`INLINE_RUNTIME_CHUNK=false`) to keep the CSP strict; no UI change.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `index.js` | `index.js` | T | Add `helmet()` + CSP; mount global + login `express-rate-limit`; remove the PR1 in-memory throttle; keep the credentialed CORS allowlist. |
| `middleware/` | `rateLimiters.js` | C | Configured `apiLimiter` + `loginLimiter` (env-driven), exported for index.js. |
| `middleware/` | `multerLogoUpload.js` | T | Whitelist the stored extension. |
| `routes/` | `properties.js` | T | Document upload: add `limits` + `fileFilter` (ext+MIME allowlist), sanitize filename; harden `removeUploadedFile` path containment. |
| `routes/` | `reservations.js` | T | Validate money/% in `POST /`, `PUT /:id`, `PATCH /:id/payment`. |
| `routes/` | `devis.js` | T | Validate money/% in `POST /`, `PUT /:id` (targeted; full MVC stays Bloc 4). |
| `routes/` | `resourceBookings.js` | T | Validate money/% in `POST /`, `PUT /:id`. |
| `utils/` | `financeValidation.js` | — | Reused as-is (created in PR 1). |
| `utils/` | `uploadSafety.js` | C | Pure helpers: `isAllowedUpload(ext, mime, kind)`, `safeUploadPath(uploadsDir, name)`. Unit-tested. |

**New dependencies:** `helmet`, `express-rate-limit`.

### 4.2 Client side (`client/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `package.json` | `client/package.json` | T | Build script sets `INLINE_RUNTIME_CHUNK=false` so the prod build keeps `script-src 'self'` (committed; `client/.env` is git-ignored and dev-only). |

No component changes.

### 4.3 API contract

No new endpoints. New failure modes: `429 TOO_MANY_ATTEMPTS` (rate limits), `400` with an upload error
code on rejected files, `400` money/percentage errors on write endpoints. Existing success responses
unchanged.

---

## 5. Data model

No schema changes.

**Data impact:** none.

## 6. UI / UX

No new screens. Existing flows must keep working under the new CSP and limits:
- Upload of a property document/photo and the company logo still works (allowed types); a disallowed
  type shows the existing error path (French message).
- Login beyond 10 failed attempts shows "Trop de tentatives. Réessayez plus tard." (already mapped in
  `LoginPage` for `TOO_MANY_ATTEMPTS`).
- No visual change otherwise. Responsive: unaffected.

## 7. Test plan

### Server unit tests
- [ ] `tests/upload-safety.unit.test.js` — `isAllowedUpload` accepts/rejects by ext+MIME per kind;
      `safeUploadPath` blocks traversal (`../`), keeps files within `uploads/`.
- [ ] The money validation logic itself is already unit-tested (`finance-validation.unit.test.js`, PR 1);
      the route-level enforcement is verified by curl (negative amount / >100% → `400`), consistent with
      the codebase's no-HTTP-harness testing style.
- [ ] Existing suite stays green.

### Manual verification
- [ ] **Production build** (`cd client && npm run build`, run server with the build): app loads, no CSP
      violations in the console; images, MUI styles, navigation, login all work.
- [ ] Rapidly hit `/api/auth/login` >10× → `429`; normal usage never hits the global 300 limit.
- [ ] Upload a `.pdf`/`.png` document → OK; upload a `.exe`/oversized file → rejected `400`.
- [ ] Upload company logo (png) → OK; spoofed extension → rejected.
- [ ] Create/edit a reservation with a negative amount or >100% discount via API → `400`.
- [ ] iCal export feed still reachable and not throttled.

## 8. Out of scope

- Full MVC refactors of `properties.js` / `reservations.js` / `devis.js` (Blocs 3/4) — only targeted
  validation + upload edits here.
- WAF, fail2ban, IP allowlisting, 2FA, account lockout policy — future/infra.
- Per-user rate limiting (we rate-limit per IP).

## 9. Open questions

**Resolved at kickoff (2026-05-27):**
- Helmet **with an adapted CSP** (not report-only). ✅
- Login limit **10 / 15 min / IP**; global API limit **300 / 15 min / IP**; both env-configurable. ✅
