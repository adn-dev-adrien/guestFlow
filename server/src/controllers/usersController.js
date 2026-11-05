/**
 * Users controller — admin-only account management for the `/comptes` page
 * (specs/admin-account-management.md).
 *
 * Factory `buildController({ usersModel, settingsModel, emailService, emailTemplates,
 * passwordGenerator })` so tests can inject fakes; a default instance is bound to the production
 * dependencies. The role guard (`middleware/enforceRoleAccess`) blocks non-admins before any route
 * here runs; `/users/me` is the only exception (any authenticated user can read their own profile).
 *
 * Key invariants:
 *   - The temporary password is NEVER returned in the HTTP response, NEVER logged, NEVER displayed.
 *     It's emailed once and immediately discarded.
 *   - Email send happens BEFORE the model write (create + reset) — if the email fails, nothing is
 *     persisted, so the admin doesn't end up with a half-created account whose owner can't log in.
 *     For password reset this also means the previous password keeps working until the email lands.
 *   - Self-action guards: an admin cannot delete themselves, remove their own admin role, or reset
 *     their own password from this page (they use /settings/password).
 *   - Last-admin guards: any action that would leave zero active admins is rejected with 400
 *     LAST_ADMIN. The guard reads `findActiveAdminCount` and projects the post-action state.
 */

const defaultUsersModel = require('../models/usersModel');
const defaultSessionsModel = require('../models/sessionsModel');
const defaultSettingsModel = require('../models/settingsModel');
const { createEmailService } = require('../utils/emailService');
const defaultEmailTemplates = require('../utils/emailTemplates');
const { generateTemporaryPassword: defaultGenerateTemporaryPassword } = require('../utils/passwordGenerator');
const { ROLES, ADMIN, isKnownRole } = require('../constants/roles');
const { MIN_PASSWORD_LENGTH, DEFAULT_ADMIN_EMAIL } = require('../constants/authDefaults');
const { quotaRefusal } = require('../utils/planQuota');
const { ROLE_PLUGINS } = require('../constants/plugins');
const { sendError } = require('../utils/httpError');
const { isValidEmailAddress } = require('../utils/emailAddress');
const { asText, isOptionalText } = require('../utils/bodyText');

function isValidEmail(value) {
  return isValidEmailAddress(value);
}

// specs/hosting-h2-account-security.md rule 68 — company and notes are text, null or left out.
function notTextRefusal(body) {
  const field = ['companyName', 'notes'].find((key) => !isOptionalText(body[key]));
  return field ? { error: 'INVALID_FIELD', field } : null;
}

// A blank entry is dropped; one that is not a string stays, for UNKNOWN_ROLE to refuse.
const readRoles = (list) => [...new Set(list
  .map((role) => (role === undefined || role === null ? '' : (typeof role === 'string' ? role.trim() : role)))
  .filter((role) => role !== ''))];

function unknownRoleRefusal(roles) {
  const role = roles.find((r) => !isKnownRole(r));
  if (role === undefined) return null;
  return { error: 'UNKNOWN_ROLE', field: 'roles', ...(typeof role === 'string' ? { role } : {}) };
}

function asInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function buildController({
  usersModel,
  settingsModel,
  emailService,
  emailTemplates = defaultEmailTemplates,
  passwordGenerator = defaultGenerateTemporaryPassword,
  buildEmailService = createEmailService,
  planQuota = quotaRefusal,
  twoFactor = null,
  sessionsModel = defaultSessionsModel,
  isPluginLive = (id) => require('../plugins/sdk/registry').isLive(id),
}) {
  // emailService can be passed in pre-built (test isolation). Otherwise we lazily build it from
  // the live SMTP settings on each call — that way settings changes are honoured without restart.
  function getEmailService() {
    if (emailService) return emailService;
    const smtp = settingsModel.decryptedSmtpSettings();
    return buildEmailService(smtp);
  }

  // The first role of `roles` the account does not already hold whose plugin is not live
  // (specs/plugins-phase-0-foundation.md rule 29). A role already held stays: the plugin cannot have
  // been switched off under it (rule 8).
  function roleWithoutPlugin(roles, held = []) {
    const role = roles.find((r) => ROLE_PLUGINS[r] && !held.includes(r) && !isPluginLive(ROLE_PLUGINS[r]));
    return role ? { error: 'ROLE_PLUGIN_INACTIVE', field: 'roles', role, plugin: ROLE_PLUGINS[role] } : null;
  }

  function currentUserId(req) {
    return req.user && Number(req.user.id);
  }

  function isSelf(req, targetId) {
    return currentUserId(req) === Number(targetId);
  }

  function ensureAdminCountAfter(predicate) {
    // predicate(count) → boolean; true means "the action keeps at least 1 active admin".
    const current = usersModel.findActiveAdminCount();
    return predicate(current);
  }

  // Rule 59 — the old address learns of the change. Best effort, after the change: a mail failure must
  // not undo it, nor tell the caller anything.
  function notifyOldAddress(before, after) {
    // The bootstrap login is nobody's mailbox.
    if (String(before.email).toLowerCase() === DEFAULT_ADMIN_EMAIL) return;
    Promise.resolve()
      .then(() => getEmailService().send({
        to: before.email,
        subject: 'Adresse email modifiée — GuestFlow',
        text: `L’adresse de connexion de ce compte est maintenant ${after.email}.\n\nSi ce changement n’est pas de vous, le signaler à l’administrateur sans attendre.`,
      }))
      .catch((err) => console.error('[usersController.updateSelf] old-address notice failed:', err && err.code ? err.code : err));
  }

  return {
    // GET /api/users — admin only (the route group is admin-gated by enforceRoleAccess).
    // Each account says whether its second step is on, so the admin can turn it off
    // (specs/hosting-h2-account-security.md rule 9). The support account is never listed.
    list(req, res) {
      const withTwoFactor = new Set(twoFactor ? twoFactor.enabledUserIds() : []);
      return res.json({ users: usersModel.list().map((u) => ({ ...u, twoFactorEnabled: withTwoFactor.has(u.id) })) });
    },

    // DELETE /api/users/:id/two-factor — rule 9: an admin turns another user's second step off
    // (a lost phone); recorded in that user's history. Never the admin's own: that takes a password.
    disableTwoFactor(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID', message: 'Compte introuvable.' });
      if (isSelf(req, id)) return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN', message: 'Action impossible sur son propre compte.' });
      try {
        return res.json(twoFactor.disableFor(req.user, id));
      } catch (err) {
        if (err && err.body) return res.status(err.status).json(err.body);
        throw err;
      }
    },

    // GET /api/users/me — any authenticated user reads their own profile.
    getMe(req, res) {
      if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
      const fresh = usersModel.findById(req.user.id);
      if (!fresh) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Compte introuvable.' });
      return res.json({ user: fresh });
    },

    // PUT /api/users/me — any authenticated user updates their OWN identity fields. Roles are
    // explicitly NOT editable from this endpoint:
    //   - email is editable since 2026-06-02 (the bootstrap admin needs to replace the
    //     `admin@guestflow.local` seed with a real address). The model enforces uniqueness
    //     and we validate the format here; an unchanged email skips the validation altogether
    //     so existing callers that don't touch it (or send the same string) keep working. A changed
    //     one needs `currentPassword` (+ `code` with a second step) and is told to the old address
    //     (specs/hosting-h2-account-security.md rule 59).
    //   - roles must never be self-modifiable — a user could otherwise grant themselves admin.
    // Validation mirrors `create` (firstName + lastName required). Returns the refreshed safe user
    // so the caller can update its local auth state immediately.
    updateSelf(req, res) {
      if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
      const body = req.body || {};
      const firstName = asText(body.firstName).trim();
      const lastName = asText(body.lastName).trim();
      if (!firstName) return res.status(400).json({ error: 'FIRSTNAME_REQUIRED', field: 'firstName' });
      if (!lastName) return res.status(400).json({ error: 'LASTNAME_REQUIRED', field: 'lastName' });
      const notText = notTextRefusal(body);
      if (notText) return res.status(400).json(notText);

      // Optional email change — only validate when the body carries a value that differs
      // from the current one. Submitting the same email is a no-op (no format check
      // re-runs, no uniqueness ping).
      let emailForModel;
      if (body.email !== undefined && body.email !== null) {
        if (typeof body.email !== 'string') return res.status(400).json({ error: 'INVALID_EMAIL', field: 'email' });
        const trimmed = body.email.trim();
        if (trimmed && trimmed.toLowerCase() !== String(req.user.email || '').toLowerCase()) {
          if (!isValidEmail(trimmed)) return res.status(400).json({ error: 'INVALID_EMAIL', field: 'email' });
          emailForModel = trimmed;
        }
      }

      // Rule 59 — a new address redirects the reset link and the login code: it asks the current
      // password, and a current code when the second step is on.
      if (emailForModel !== undefined) {
        try {
          twoFactor.reauthenticateForChange(req.user, { password: body.currentPassword, code: body.code });
        } catch (err) {
          return sendError(res, err);
        }
      }

      let updated;
      try {
        updated = usersModel.updateUser(req.user.id, {
          firstName,
          lastName,
          companyName: asText(body.companyName).trim(),
          notes: asText(body.notes).trim(),
          // No `roles` key on purpose — the model preserves the existing roles when undefined.
          ...(emailForModel !== undefined ? { email: emailForModel } : {}),
        });
      } catch (err) {
        if (err && err.code === 'EMAIL_ALREADY_EXISTS') {
          return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS', field: 'email' });
        }
        // specs/hosting-h2-account-security.md rule 21 — the support account is never edited.
        if (err && err.code === 'SUPPORT_ACCOUNT_LOCKED') {
          return res.status(403).json({ error: 'SUPPORT_FORBIDDEN', message: 'Action réservée au compte du client.' });
        }
        throw err;
      }
      if (!updated) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Compte introuvable.' });
      // Sync the persisted session so the next /me + every downstream `req.user` read
      // (sidebar greeting, dialogs, future navigation) sees the new values immediately,
      // without waiting for the next /me round-trip to refresh from the DB.
      if (req.session) req.session.user = updated;
      if (emailForModel !== undefined) {
        // Rule 59 — like a password change: the other devices must sign in again with the new address.
        sessionsModel.revokeOtherSessionsForUser(req.user.id, req.sessionID);
        notifyOldAddress(req.user, updated);
      }
      return res.json({ user: updated });
    },

    // GET /api/users/me/email-status — minimal payload the SelfProfileSection polls to know
    // whether the operator is still on the bootstrap admin email. Drives the red highlight
    // + "Change me" hint on the email field. Read-only, gated by requireAuth like the rest of
    // /api/users; admin-only is NOT enforced because any user can want to see their own
    // email's status. The `defaultStillUsed` flag is a system-wide check (looks across all
    // users) so a non-admin's profile UI doesn't have to special-case anything — they just
    // see the warning on their own email if it happens to be the default one too.
    emailStatus(req, res) {
      if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
      // Re-read the user from DB instead of trusting `req.user` (which only refreshes when the
      // session is rewritten) — guarantees lastLoginAt + emailChangedAt are current.
      const fresh = usersModel.findById(req.user.id);
      const lastLoginAt = fresh && fresh.lastLoginAt;
      const emailChangedAt = fresh && fresh.emailChangedAt;
      // Verification banner is active when the email was changed AND the user hasn't logged in
      // afterwards yet. Both timestamps are ISO strings → safe lexicographic comparison.
      const mustVerifyNewEmail = Boolean(
        emailChangedAt && (!lastLoginAt || lastLoginAt <= emailChangedAt)
      );
      return res.json({
        myEmail: (fresh && fresh.email) || req.user.email || '',
        defaultStillUsed: usersModel.isDefaultAdminEmailStillUsed(),
        mustVerifyNewEmail,
        emailChangedAt: emailChangedAt || null,
      });
    },

    // POST /api/users — create + email welcome with temporary password.
    create(req, res) {
      const body = req.body || {};
      const firstName = asText(body.firstName).trim();
      const lastName = asText(body.lastName).trim();
      const email = asText(body.email).trim();
      const companyName = asText(body.companyName).trim();
      const notes = asText(body.notes).trim();
      const roles = Array.isArray(body.roles) ? readRoles(body.roles) : [];

      if (!firstName) return res.status(400).json({ error: 'FIRSTNAME_REQUIRED', field: 'firstName' });
      if (!lastName) return res.status(400).json({ error: 'LASTNAME_REQUIRED', field: 'lastName' });
      if (!isValidEmail(email)) return res.status(400).json({ error: 'INVALID_EMAIL', field: 'email' });
      const notText = notTextRefusal(body);
      if (notText) return res.status(400).json(notText);
      if (roles.length === 0) return res.status(400).json({ error: 'ROLES_REQUIRED', field: 'roles' });
      const unknownRole = unknownRoleRefusal(roles);
      if (unknownRole) return res.status(400).json(unknownRole);
      const withoutPlugin = roleWithoutPlugin(roles);
      if (withoutPlugin) return res.status(400).json(withoutPlugin);
      // Before the welcome email: a refused account must not receive one.
      const refusal = planQuota('users', () => usersModel.countActive());
      if (refusal) return res.status(402).json(refusal);

      if (!settingsModel.smtpConfigured()) {
        return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED', message: 'Envoi d’e-mails non configuré.' });
      }
      const publicUrl = String(settingsModel.publicUrl() || '').trim();
      if (!publicUrl) {
        return res.status(400).json({ error: 'PUBLIC_URL_NOT_CONFIGURED', message: 'Adresse publique non configurée.' });
      }

      // Generate the temp password + prerender the welcome email. We send the email FIRST and only
      // persist the user if delivery succeeds — no half-created accounts. `fromName` is fed into the
      // template so the signature line matches the SMTP "from" display name the recipient sees.
      const temporaryPassword = passwordGenerator();
      const fromName = settingsModel.decryptedSmtpSettings().fromName;
      const { subject, text } = emailTemplates.welcomeEmailBody({
        firstName, lastName, email, temporaryPassword, publicUrl, companyName, fromName,
      });

      return Promise.resolve()
        .then(() => getEmailService().send({ to: email, subject, text }))
        .then(() => {
          try {
            const user = usersModel.createUser({
              email, password: temporaryPassword, firstName, lastName, companyName, notes, roles,
            });
            return res.status(201).json({ user });
          } catch (err) {
            if (err && err.code === 'EMAIL_ALREADY_EXISTS') {
              return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS', field: 'email' });
            }
            throw err;
          }
        })
        .catch((err) => {
          if (err && err.code === 'EMAIL_NOT_CONFIGURED') {
            return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED', message: 'Envoi d’e-mails non configuré.' });
          }
          if (err && err.code === 'EMAIL_ALREADY_EXISTS') {
            return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS', field: 'email' });
          }
          // Any other failure (transport reject, model crash) → 502 EMAIL_SEND_FAILED. The
          // raw error (which may include the SMTP server hostname, library version, etc.)
          // stays in the server log; the client only sees the stable code. The user has NOT
          // been persisted. Spotted in the 2026-06-01 security audit (finding M3).
          console.error('[usersController.create] email send failed:', err);
          return res.status(502).json({ error: 'EMAIL_SEND_FAILED', message: 'Envoi de l’e-mail impossible.' });
        });
    },

    // PUT /api/users/:id — identity + roles update.
    update(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID', message: 'Compte introuvable.' });
      const body = req.body || {};
      const target = usersModel.findById(id);
      if (!target || target.isSupport) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Compte introuvable.' });

      // Rule 68 — as on /me: a name that is sent must be a name; a field left out stays as it is.
      if (body.firstName !== undefined && !asText(body.firstName).trim()) return res.status(400).json({ error: 'FIRSTNAME_REQUIRED', field: 'firstName' });
      if (body.lastName !== undefined && !asText(body.lastName).trim()) return res.status(400).json({ error: 'LASTNAME_REQUIRED', field: 'lastName' });
      const notText = notTextRefusal(body);
      if (notText) return res.status(400).json(notText);

      const nextRoles = Array.isArray(body.roles) ? readRoles(body.roles) : undefined;
      if (nextRoles !== undefined) {
        if (nextRoles.length === 0) return res.status(400).json({ error: 'ROLES_REQUIRED', field: 'roles' });
        const unknownRole = unknownRoleRefusal(nextRoles);
        if (unknownRole) return res.status(400).json(unknownRole);
        const withoutPlugin = roleWithoutPlugin(nextRoles, target.roles);
        if (withoutPlugin) return res.status(400).json(withoutPlugin);
        // Self-protection: an admin cannot strip their own admin role.
        if (isSelf(req, id) && target.roles.includes(ADMIN) && !nextRoles.includes(ADMIN)) {
          return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN', message: 'Rôle admin de son propre compte : retrait impossible.', detail: 'Rôle admin de son propre compte : retrait impossible.' });
        }
        // Last-admin: would removing admin from this active admin leave zero?
        const isLosingAdmin = target.isActive && target.roles.includes(ADMIN) && !nextRoles.includes(ADMIN);
        if (isLosingAdmin && !ensureAdminCountAfter((count) => count - 1 >= 1)) {
          return res.status(400).json({ error: 'LAST_ADMIN', message: 'Au moins un administrateur doit rester actif.' });
        }
      }

      const updated = usersModel.updateUser(id, {
        firstName: body.firstName,
        lastName: body.lastName,
        companyName: body.companyName,
        notes: body.notes,
        roles: nextRoles,
      });
      // Revoke this user's live sessions when their ROLES actually changed, so a demotion takes
      // effect immediately instead of leaving the old permissions on an open session (2026-10-08
      // audit AUTH-1). A plain identity edit (name/company/notes) must NOT log the user out.
      const rolesChanged =
        nextRoles !== undefined &&
        (nextRoles.length !== target.roles.length ||
          [...nextRoles].sort().join('\u0000') !== [...target.roles].sort().join('\u0000'));
      if (rolesChanged) sessionsModel.revokeAllForUser(id);
      return res.json({ user: updated });
    },

    // POST /api/users/:id/reset-password — regenerate + email new temp password, then persist hash.
    resetPassword(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID', message: 'Compte introuvable.' });
      if (isSelf(req, id)) {
        return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN', message: 'Mot de passe personnel : page Mot de passe.', detail: 'Mot de passe personnel : page Mot de passe.' });
      }
      const target = usersModel.findById(id);
      if (!target || target.isSupport) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Compte introuvable.' });
      // A reset reactivates the account, so a disabled one counts against the plan's quota
      // (specs/control-plane-plans-and-access.md rule 13).
      if (!target.isActive) {
        const refusal = planQuota('users', () => usersModel.countActive());
        if (refusal) return res.status(402).json(refusal);
      }
      if (!settingsModel.smtpConfigured()) {
        return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED', message: 'Envoi d’e-mails non configuré.' });
      }
      const publicUrl = String(settingsModel.publicUrl() || '').trim();
      if (!publicUrl) return res.status(400).json({ error: 'PUBLIC_URL_NOT_CONFIGURED', message: 'Adresse publique non configurée.' });

      const temporaryPassword = passwordGenerator();
      const fromName = settingsModel.decryptedSmtpSettings().fromName;
      const { subject, text } = emailTemplates.passwordResetEmailBody({
        firstName: target.firstName,
        lastName: target.lastName,
        email: target.email,
        temporaryPassword,
        publicUrl,
        fromName,
      });

      return Promise.resolve()
        .then(() => getEmailService().send({ to: target.email, subject, text }))
        .then(() => {
          usersModel.resetUserPassword(id, temporaryPassword);
          // An admin reset is the lever used when an account may be compromised: end every live
          // session so the old password's sessions cannot continue (2026-10-08 audit AUTH-1).
          sessionsModel.revokeAllForUser(id);
          return res.status(204).end();
        })
        .catch((err) => {
          if (err && err.code === 'EMAIL_NOT_CONFIGURED') {
            return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED', message: 'Envoi d’e-mails non configuré.' });
          }
          // Same rule as create: keep the raw error server-side, return a stable code.
          // Spotted in the 2026-06-01 security audit (finding M3).
          console.error('[usersController.resetPassword] email send failed:', err);
          return res.status(502).json({ error: 'EMAIL_SEND_FAILED', message: 'Envoi de l’e-mail impossible.' });
        });
    },

    // DELETE /api/users/:id — soft delete by default.
    softDelete(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID', message: 'Compte introuvable.' });
      if (isSelf(req, id)) {
        return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN', message: 'Action impossible sur son propre compte.' });
      }
      const target = usersModel.findById(id);
      if (!target || target.isSupport) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Compte introuvable.' });
      // Last-admin guard: deactivating an active admin must keep ≥1 active admin alive.
      const removesAnAdmin = target.isActive && target.roles.includes(ADMIN);
      if (removesAnAdmin && !ensureAdminCountAfter((count) => count - 1 >= 1)) {
        return res.status(400).json({ error: 'LAST_ADMIN', message: 'Au moins un administrateur doit rester actif.' });
      }
      usersModel.softDelete(id);
      // Deactivation is the control reached for after an employee leaves — it must end the session
      // already open on their device, not only block future logins (2026-10-08 audit AUTH-1).
      sessionsModel.revokeAllForUser(id);
      return res.status(204).end();
    },

    // DELETE /api/users/:id?hard=1 — hard delete (only when the user never logged in).
    hardDelete(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID', message: 'Compte introuvable.' });
      if (isSelf(req, id)) {
        return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN', message: 'Action impossible sur son propre compte.' });
      }
      const target = usersModel.findById(id);
      if (!target || target.isSupport) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Compte introuvable.' });
      // The user is by definition still mustChangePassword=1 + lastLoginAt=null when eligible, so
      // they can't be the active admin holding the fort. But we still guard for safety.
      const removesAnAdmin = target.isActive && target.roles.includes(ADMIN);
      if (removesAnAdmin && !ensureAdminCountAfter((count) => count - 1 >= 1)) {
        return res.status(400).json({ error: 'LAST_ADMIN', message: 'Au moins un administrateur doit rester actif.' });
      }
      try {
        usersModel.hardDelete(id);
      } catch (err) {
        if (err && err.code === 'HARD_DELETE_NOT_ELIGIBLE') {
          return res.status(400).json({ error: 'HARD_DELETE_NOT_ELIGIBLE', message: 'Ce compte ne peut pas être supprimé.' });
        }
        throw err;
      }
      // Belt-and-braces: a hard-deleted user keeps no row for requireAuth to find, but clear any
      // stray session row so the store does not keep dangling state (2026-10-08 audit AUTH-1).
      sessionsModel.revokeAllForUser(id);
      return res.status(204).end();
    },
  };
}

// Backwards-compat shim for the legacy single-user "Accès comptable" UI: the old callsite POSTed
// { email, password, role } and got back the password. The new flow doesn't use either contract —
// the SettingsAccountantAccessSection is being removed in M3. But until that lands, we keep these
// stubbed so module loaders don't blow up; they delegate to the real handlers and only the new
// payload shape is accepted.
const defaultDeps = {
  usersModel: defaultUsersModel,
  settingsModel: defaultSettingsModel,
  emailTemplates: defaultEmailTemplates,
  passwordGenerator: defaultGenerateTemporaryPassword,
  get twoFactor() {
    const { twoFactor, twoFactorModel } = require('../utils/accountSecurityServices');
    return {
      disableFor: twoFactor.disableFor,
      enabledUserIds: twoFactorModel.enabledUserIds,
      reauthenticateForChange: twoFactor.reauthenticateForChange,
    };
  },
};

const defaultController = buildController(defaultDeps);
defaultController.buildController = buildController;
defaultController.__test = { isValidEmail, ROLES, MIN_PASSWORD_LENGTH };

module.exports = defaultController;
