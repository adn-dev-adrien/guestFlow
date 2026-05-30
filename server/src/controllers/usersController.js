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
const defaultSettingsModel = require('../models/settingsModel');
const { createEmailService } = require('../utils/emailService');
const defaultEmailTemplates = require('../utils/emailTemplates');
const { generateTemporaryPassword: defaultGenerateTemporaryPassword } = require('../utils/passwordGenerator');
const { ROLES, ADMIN, isKnownRole } = require('../constants/roles');
const { MIN_PASSWORD_LENGTH } = require('../constants/authDefaults');

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
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
}) {
  // emailService can be passed in pre-built (test isolation). Otherwise we lazily build it from
  // the live SMTP settings on each call — that way settings changes are honoured without restart.
  function getEmailService() {
    if (emailService) return emailService;
    const smtp = settingsModel.decryptedSmtpSettings();
    return buildEmailService(smtp);
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

  return {
    // GET /api/users — admin only (the route group is admin-gated by enforceRoleAccess).
    list(req, res) {
      return res.json({ users: usersModel.list() });
    },

    // GET /api/users/me — any authenticated user reads their own profile.
    getMe(req, res) {
      if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
      const fresh = usersModel.findById(req.user.id);
      if (!fresh) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      return res.json({ user: fresh });
    },

    // POST /api/users — create + email welcome with temporary password.
    create(req, res) {
      const body = req.body || {};
      const firstName = String(body.firstName || '').trim();
      const lastName = String(body.lastName || '').trim();
      const email = String(body.email || '').trim();
      const companyName = String(body.companyName || '').trim();
      const notes = String(body.notes || '').trim();
      const roles = Array.isArray(body.roles) ? body.roles.map((r) => String(r || '').trim()).filter(Boolean) : [];

      if (!firstName) return res.status(400).json({ error: 'FIRSTNAME_REQUIRED', field: 'firstName' });
      if (!lastName) return res.status(400).json({ error: 'LASTNAME_REQUIRED', field: 'lastName' });
      if (!isValidEmail(email)) return res.status(400).json({ error: 'INVALID_EMAIL', field: 'email' });
      if (roles.length === 0) return res.status(400).json({ error: 'ROLES_REQUIRED', field: 'roles' });
      for (const role of roles) {
        if (!isKnownRole(role)) return res.status(400).json({ error: 'UNKNOWN_ROLE', field: 'roles', role });
      }

      if (!settingsModel.smtpConfigured()) {
        return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED' });
      }
      const publicUrl = String(settingsModel.publicUrl() || '').trim();
      if (!publicUrl) {
        return res.status(400).json({ error: 'PUBLIC_URL_NOT_CONFIGURED' });
      }

      // Generate the temp password + prerender the welcome email. We send the email FIRST and only
      // persist the user if delivery succeeds — no half-created accounts.
      const temporaryPassword = passwordGenerator();
      const { subject, text } = emailTemplates.welcomeEmailBody({
        firstName, lastName, email, temporaryPassword, publicUrl, companyName,
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
            return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED' });
          }
          if (err && err.code === 'EMAIL_ALREADY_EXISTS') {
            return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS', field: 'email' });
          }
          // Any other failure (transport reject, model crash) → 502 EMAIL_SEND_FAILED with the
          // transport message so the admin can diagnose. The user has NOT been persisted.
          return res.status(502).json({
            error: 'EMAIL_SEND_FAILED',
            detail: String(err && err.message || err),
          });
        });
    },

    // PUT /api/users/:id — identity + roles update.
    update(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID' });
      const body = req.body || {};
      const target = usersModel.findById(id);
      if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });

      const nextRoles = Array.isArray(body.roles)
        ? body.roles.map((r) => String(r || '').trim()).filter(Boolean)
        : undefined;
      if (nextRoles !== undefined) {
        if (nextRoles.length === 0) return res.status(400).json({ error: 'ROLES_REQUIRED', field: 'roles' });
        for (const role of nextRoles) {
          if (!isKnownRole(role)) return res.status(400).json({ error: 'UNKNOWN_ROLE', field: 'roles', role });
        }
        // Self-protection: an admin cannot strip their own admin role.
        if (isSelf(req, id) && target.roles.includes(ADMIN) && !nextRoles.includes(ADMIN)) {
          return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN', detail: 'Vous ne pouvez pas retirer votre propre rôle admin.' });
        }
        // Last-admin: would removing admin from this active admin leave zero?
        const isLosingAdmin = target.isActive && target.roles.includes(ADMIN) && !nextRoles.includes(ADMIN);
        if (isLosingAdmin && !ensureAdminCountAfter((count) => count - 1 >= 1)) {
          return res.status(400).json({ error: 'LAST_ADMIN' });
        }
      }

      const updated = usersModel.updateUser(id, {
        firstName: body.firstName,
        lastName: body.lastName,
        companyName: body.companyName,
        notes: body.notes,
        roles: nextRoles,
      });
      return res.json({ user: updated });
    },

    // POST /api/users/:id/reset-password — regenerate + email new temp password, then persist hash.
    resetPassword(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID' });
      if (isSelf(req, id)) {
        return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN', detail: 'Utilisez la page Mot de passe pour modifier le vôtre.' });
      }
      const target = usersModel.findById(id);
      if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      if (!settingsModel.smtpConfigured()) {
        return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED' });
      }
      const publicUrl = String(settingsModel.publicUrl() || '').trim();
      if (!publicUrl) return res.status(400).json({ error: 'PUBLIC_URL_NOT_CONFIGURED' });

      const temporaryPassword = passwordGenerator();
      const { subject, text } = emailTemplates.passwordResetEmailBody({
        firstName: target.firstName,
        lastName: target.lastName,
        email: target.email,
        temporaryPassword,
        publicUrl,
      });

      return Promise.resolve()
        .then(() => getEmailService().send({ to: target.email, subject, text }))
        .then(() => {
          usersModel.resetUserPassword(id, temporaryPassword);
          return res.status(204).end();
        })
        .catch((err) => {
          if (err && err.code === 'EMAIL_NOT_CONFIGURED') {
            return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED' });
          }
          return res.status(502).json({ error: 'EMAIL_SEND_FAILED', detail: String(err && err.message || err) });
        });
    },

    // DELETE /api/users/:id — soft delete by default.
    softDelete(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID' });
      if (isSelf(req, id)) {
        return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN' });
      }
      const target = usersModel.findById(id);
      if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      // Last-admin guard: deactivating an active admin must keep ≥1 active admin alive.
      const removesAnAdmin = target.isActive && target.roles.includes(ADMIN);
      if (removesAnAdmin && !ensureAdminCountAfter((count) => count - 1 >= 1)) {
        return res.status(400).json({ error: 'LAST_ADMIN' });
      }
      usersModel.softDelete(id);
      return res.status(204).end();
    },

    // DELETE /api/users/:id?hard=1 — hard delete (only when the user never logged in).
    hardDelete(req, res) {
      const id = asInt(req.params.id);
      if (id == null) return res.status(400).json({ error: 'INVALID_ID' });
      if (isSelf(req, id)) {
        return res.status(403).json({ error: 'SELF_ACTION_FORBIDDEN' });
      }
      const target = usersModel.findById(id);
      if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      // The user is by definition still mustChangePassword=1 + lastLoginAt=null when eligible, so
      // they can't be the active admin holding the fort. But we still guard for safety.
      const removesAnAdmin = target.isActive && target.roles.includes(ADMIN);
      if (removesAnAdmin && !ensureAdminCountAfter((count) => count - 1 >= 1)) {
        return res.status(400).json({ error: 'LAST_ADMIN' });
      }
      try {
        usersModel.hardDelete(id);
      } catch (err) {
        if (err && err.code === 'HARD_DELETE_NOT_ELIGIBLE') {
          return res.status(400).json({ error: 'HARD_DELETE_NOT_ELIGIBLE' });
        }
        throw err;
      }
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
};

const defaultController = buildController(defaultDeps);
defaultController.buildController = buildController;
defaultController.__test = { isValidEmail, ROLES, MIN_PASSWORD_LENGTH };

module.exports = defaultController;
