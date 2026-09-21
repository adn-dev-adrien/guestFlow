/**
 * useSettingsForm — load / edit / save a subset of `GET|PUT /api/settings`.
 *
 * Each settings page owns a few groups of the settings payload (specs/settings-rationalization.md
 * rule 4: one Save per page, touching only its own fields). This hook holds the draft of those
 * groups, sends only the fields that changed, and wires the shared dirty-form guard.
 *
 * Params:
 *   groups:   string[]  — the payload groups the page edits (e.g. ['company', 'quote'])
 *   navigate: function  — react-router navigate, for the dirty-form guard
 *
 * Returns:
 *   loading, loadError, saving, errors, updatedAtLabel, draft, saved
 *   isDirty, guardDialogOpen, dismissGuard, confirmLeave  — from useDirtyFormGuard
 *   setField(group, key, value)  — edits the draft and clears the field's server error
 *   save({ afterSettings })      — PUT the changed fields; `afterSettings` runs extra writes (cards
 *                                   with their own endpoint) and can make the page dirty-free
 *   cancel()                     — back to the saved values
 *   replaceSaved(group, key, value) — records a value written by another endpoint (the logo)
 *
 * Secret fields use a draft key whose `undefined` means « keep the stored secret »:
 *   smtp.passwordDraft → smtp.password, weather.apiKeyDraft → weather.apiKey.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { useToast } from '../components/DialogProvider';
import useDirtyFormGuard from './useDirtyFormGuard';

// Fields the server computes or writes through another endpoint: never sent back.
const READ_ONLY = {
  company: ['logoPath'],
  smtp: ['passwordSet', 'derived', 'passwordDraft'],
  notifications: ['derivedRecipient'],
  emails: ['sequenceStartDate'],
  weather: ['apiKeySet', 'apiKeyDraft'],
};

// Secret drafts → the payload key the server expects.
const SECRET_DRAFTS = {
  smtp: { draft: 'passwordDraft', payload: 'password' },
  weather: { draft: 'apiKeyDraft', payload: 'apiKey' },
};

// Client field → server error key (the server validates by column name).
const ERROR_KEYS = {
  company: {
    name: 'companyName', address: 'companyAddress', email: 'companyEmail', phone: 'companyPhone',
    siret: 'companySiret', tva: 'companyTva', iban: 'companyIban', bic: 'companyBic', bankName: 'companyBankName',
  },
  quote: { footerText: 'quoteFooterText', footerTextEn: 'quoteFooterTextEn', validityDays: 'quoteValidityDays' },
  vat: { rate: 'vatRate' },
  accounting: { fiscalYearEndMonth: 'fiscalYearEndMonth' },
  smtp: { host: 'smtpHost', fromEmail: 'smtpFromEmail', fromName: 'smtpFromName', publicUrl: 'publicUrl' },
  notifications: { recipientEmail: 'notificationRecipientEmail' },
  emails: {
    googleReviewUrl: 'googleReviewUrl', instagramUrl: 'instagramUrl',
    poolSeasonStart: 'poolSeasonStart', poolSeasonEnd: 'poolSeasonEnd',
  },
};

function pickGroups(settings, groups) {
  const out = {};
  for (const group of groups) {
    const value = { ...((settings && settings[group]) || {}) };
    const secret = SECRET_DRAFTS[group];
    if (secret) value[secret.draft] = undefined;
    out[group] = value;
  }
  return out;
}

function buildPayload(draft, saved, groups) {
  const payload = {};
  for (const group of groups) {
    const readOnly = READ_ONLY[group] || [];
    const changed = {};
    for (const key of Object.keys(draft[group] || {})) {
      if (readOnly.includes(key)) continue;
      if (JSON.stringify(draft[group][key]) !== JSON.stringify((saved[group] || {})[key])) {
        changed[key] = draft[group][key];
      }
    }
    const secret = SECRET_DRAFTS[group];
    if (secret && draft[group][secret.draft] !== undefined) changed[secret.payload] = draft[group][secret.draft];
    if (Object.keys(changed).length > 0) payload[group] = changed;
  }
  return payload;
}

export default function useSettingsForm({ groups, navigate }) {
  const { showSuccess, showError } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(() => pickGroups(null, groups));
  const [draft, setDraft] = useState(() => pickGroups(null, groups));
  const [updatedAtLabel, setUpdatedAtLabel] = useState(null);
  // Extra dirtiness reported by a card that saves through its own endpoint (Neat).
  const [externalDirty, setExternalDirty] = useState(false);

  const groupsKey = groups.join(',');
  useEffect(() => {
    let mounted = true;
    api.getSettings()
      .then((data) => {
        if (!mounted) return;
        const shaped = pickGroups(data, groupsKey.split(','));
        setSaved(shaped);
        setDraft(shaped);
        setUpdatedAtLabel(data && data.updatedAtLabel);
      })
      .catch(() => { if (mounted) setLoadError(true); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [groupsKey]);

  const guard = useDirtyFormGuard({
    draft: { ...draft, externalDirty },
    saved: { ...saved, externalDirty: false },
    navigate,
  });

  const setField = useCallback((group, key, value) => {
    setDraft((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }));
    const errorKey = (ERROR_KEYS[group] || {})[key];
    if (errorKey) {
      setErrors((prev) => {
        if (!prev[errorKey]) return prev;
        const next = { ...prev };
        delete next[errorKey];
        return next;
      });
    }
  }, []);

  const save = useCallback(async ({ afterSettings } = {}) => {
    setSaving(true);
    setErrors({});
    const payload = buildPayload(draft, saved, groups);
    try {
      if (Object.keys(payload).length > 0) {
        const updated = await api.updateSettings(payload);
        const shaped = pickGroups(updated, groups);
        setSaved(shaped);
        setDraft(shaped);
        setUpdatedAtLabel(updated && updated.updatedAtLabel);
      }
      if (afterSettings) await afterSettings();
      showSuccess('Paramètres enregistrés.');
      return true;
    } catch (err) {
      if (err && err.errors) {
        setErrors(err.errors);
        showError('Enregistrement refusé : corrigez les champs en rouge.');
      } else {
        showError((err && err.message) || "Impossible d'enregistrer les paramètres.");
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, saved, groups, showSuccess, showError]);

  const cancel = useCallback(() => {
    setDraft(saved);
    setErrors({});
  }, [saved]);

  const replaceSaved = useCallback((group, key, value) => {
    setSaved((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }));
    setDraft((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }));
  }, []);

  return {
    loading, loadError, saving, errors, updatedAtLabel, draft, saved,
    isDirty: guard.isDirty,
    guardDialogOpen: guard.guardDialogOpen,
    dismissGuard: guard.dismissGuard,
    confirmLeave: guard.confirmLeave,
    setField, save, cancel, replaceSaved, setExternalDirty,
  };
}

export const __test = { buildPayload, pickGroups };
