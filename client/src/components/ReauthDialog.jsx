/**
 * ReauthDialog — asks the credentials again before a sensitive change (specs/hosting-h2-account-security.md
 * rule 47): « Mot de passe (confirmation) », and when `needsCode` a current one-time code — the
 * authenticator app's or a backup code (`OneTimeCodeField` with `allowBackup`), or, with `onSendCode`,
 * a code sent by email on « Recevoir un code ». Generic: any action that must re-ask the credentials.
 *
 * `onSubmit({ password, code })` is async and throws the API error on a refusal; the dialog shows it
 * where it belongs — a wrong or locked password under the password, a wrong code under the cells.
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
  const submitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    setPassword(''); setCode(''); setError(null); setSent(null); setWait(0); setSendError('');
  }, [open]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const ready = Boolean(password) && (!needsCode || isCompleteCode(code, true));

  const submit = async () => {
    if (!ready || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ password, code: needsCode ? code : undefined });
    } catch (err) {
      setError(err);
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
      onSubmit={submit}
    >
      <Stack spacing={2} sx={{ pt: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}>
        {text && <Typography variant="body2" color="text.secondary">{text}</Typography>}
        <PasswordField
          label="Mot de passe (confirmation)"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
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
              onChange={(v) => { setCode(v); setError(null); }}
              allowBackup
              error={codeError}
              helperText={onSendCode && sent ? `Code envoyé à ${sent}.` : undefined}
              label="Code à 6 chiffres"
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
