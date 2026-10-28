/**
 * ReauthDialog — asks the credentials again before a sensitive change (specs/hosting-h2-account-security.md
 * rule 47): « Mot de passe (confirmation) », and when `needsCode` a current one-time code — the
 * authenticator app's or a backup code (`OneTimeCodeField` with `allowBackup`), or, with `onSendCode`,
 * a code sent by email on « Recevoir un code ». Generic: any action that must re-ask the credentials.
 *
 * `onSubmit({ password, code })` is async and throws the API error on a refusal; the dialog shows it
 * where it belongs — a wrong or locked password under the password, a wrong code under the cells.
 * The code is sent as soon as its 6th digit arrives when the password is filled; « Vérification… » shows
 * while it is checked. A lock (`retryInSeconds` served with a REAUTH_LOCKED or LOCKED refusal) disables
 * the submit until it passes, counting down the served seconds. For an email-method account the field is
 * « Code reçu par email » and the switch link reads « Utiliser le code reçu par email » (as at login).
 * Built on FormDialog (full screen on a phone). `onSendCode()` resolves `{ sentTo, resendInSeconds }`
 * and throws the API error (`retryInSeconds` on a too-early resend).
 *
 * Props: open, onClose, title, text (a sentence under the title), submitLabel, submitColor,
 *        needsCode (false), onSendCode, onSubmit({ password, code }).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import PasswordField from './PasswordField';
import OneTimeCodeField, { isCompleteCode } from './OneTimeCodeField';

const PASSWORD_ERRORS = ['BAD_PASSWORD', 'REAUTH_LOCKED'];
const LOCK_ERRORS = ['REAUTH_LOCKED', 'LOCKED'];

export default function ReauthDialog({
  open, onClose, title, text, submitLabel, submitColor, needsCode = false, onSendCode, onSubmit,
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [wait, setWait] = useState(0);
  const [sendError, setSendError] = useState('');
  const [lockLeft, setLockLeft] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    setPassword(''); setCode(''); setError(null); setSent(null); setWait(0); setSendError(''); setLockLeft(0);
  }, [open]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (lockLeft <= 0) return undefined;
    const t = setTimeout(() => {
      setLockLeft((n) => n - 1);
      if (lockLeft === 1) setError(null);
    }, 1000);
    return () => clearTimeout(t);
  }, [lockLeft]);

  const locked = lockLeft > 0;
  const ready = Boolean(password) && !locked && (!needsCode || isCompleteCode(code, true));

  const submit = async (sentCode = code) => {
    if (!password || locked || (needsCode && !isCompleteCode(sentCode, true)) || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ password, code: needsCode ? sentCode : undefined });
    } catch (err) {
      setError(err);
      if (err && LOCK_ERRORS.includes(err.error) && err.retryInSeconds) setLockLeft(err.retryInSeconds);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const send = async () => {
    setSendError('');
    try {
      const out = await onSendCode();
      setSent(out.sentTo);
      setWait(out.resendInSeconds || 60);
    } catch (err) {
      if (err && err.retryInSeconds) setWait(err.retryInSeconds);
      setSendError(err && err.message ? err.message : 'Envoi impossible.');
    }
  };

  const passwordError = error && PASSWORD_ERRORS.includes(error.error) ? error.message : '';
  const codeError = error && !PASSWORD_ERRORS.includes(error.error) ? (error.message || 'Opération impossible.') : '';

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="xs"
      submitLabel={submitLabel}
      submitColor={submitColor}
      submitDisabled={!ready}
      submitBusy={busy}
      onSubmit={() => submit()}
    >
      <Stack spacing={2} sx={{ pt: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}>
        {text && <Typography variant="body2" color="text.secondary">{text}</Typography>}
        <PasswordField
          label="Mot de passe (confirmation)"
          value={password}
          onChange={(e) => { setPassword(e.target.value); if (!locked) setError(null); }}
          autoComplete="current-password"
          autoFocus
          fullWidth
          error={Boolean(passwordError)}
          helperText={passwordError || undefined}
        />
        {needsCode && (
          <Stack spacing={1}>
            <Typography variant="body2">Code actuel</Typography>
            <OneTimeCodeField
              value={code}
              onChange={(v) => { setCode(v); if (!locked) setError(null); }}
              onComplete={(c) => submit(c)}
              allowBackup
              error={codeError}
              helperText={busy ? 'Vérification…' : (onSendCode && sent ? `Code envoyé à ${sent}.` : undefined)}
              readOnly={busy}
              label={onSendCode ? 'Code reçu par email' : 'Code à 6 chiffres'}
              primaryLinkLabel={onSendCode ? 'Utiliser le code reçu par email' : 'Utiliser le code de l’application'}
            />
            {onSendCode && (
              <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                <Button variant="text" onClick={send} disabled={wait > 0} sx={{ minHeight: 44 }}>
                  {sent ? (wait > 0 ? `Renvoyer le code (${wait} s)` : 'Renvoyer le code') : (wait > 0 ? `Recevoir un code (${wait} s)` : 'Recevoir un code')}
                </Button>
                {sendError && <Typography variant="body2" color="error" role="alert">{sendError}</Typography>}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </FormDialog>
  );
}
