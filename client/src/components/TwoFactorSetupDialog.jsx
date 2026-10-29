/**
 * TwoFactorSetupDialog — the activation of the « Validation en deux étapes » in three steps:
 * « Mot de passe » → « Appli » (or « Email ») → « Codes de secours »
 * (specs/hosting-h2-account-security.md rules 40–45, 48, 52). Used for the first activation and, with
 * `initialEnrolment`, for « Changer d’appli » (the password and the current code were asked by the
 * ReauthDialog before: the dialog opens at step 2).
 *
 * Step 2 is built for the device it runs on, chosen by `(pointer: coarse)` (rule 41): a computer shows
 * the QR code with the key folded; a phone first offers « Ouvrir dans l’appli d’authentification » (the
 * `otpauth://` link) and the key to copy, with the QR code folded. The code field sends at the 6th
 * digit; a refusal says the tries left (worded by the server). Leaving steps 1–2 cancels the enrolment
 * in progress. Step 3 closes on « Terminé » only, once the codes are saved.
 *
 * Specific to this feature: it orchestrates the 2FA endpoints.
 *
 * A replacement has two steps (« n sur 2 »), says the current app stays valid until the new code is
 * validated, and offers « Oublier les appareils de confiance » (ticked): the trusted devices are asked for
 * a code again once the new app is confirmed (rule 48). The email link is offered on a first activation
 * only: a replacement is never switched without the password and a current code (rules 44, 54).
 *
 * Props: open, onClose(), onDone(status) (after « Terminé »), onRestart() (replacement only: the
 * enrolment ended, the parent asks again), account, emailAvailable, initialEnrolment (the answer of
 * POST /2fa/start, to open at step 2).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Link, Stack,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import api from '../api';
import PasswordField from './PasswordField';
import OneTimeCodeField from './OneTimeCodeField';
import BackupCodesPanel from './BackupCodesPanel';
import { ENROLMENT_ENDED, SETUP_STEPS, TWO_FACTOR_EXPLAINER } from '../constants/twoFactor';
import { visuallyHidden } from '../utils/visuallyHidden';

const ENDING_ERRORS = Object.keys(ENROLMENT_ENDED);
const messageOf = (err, fallback) => (err && err.message && err.message !== err.error ? err.message : fallback);
const compactKey = (secret) => String(secret || '').replace(/\s/g, '');

function KeyGroups({ secret }) {
  return (
    <Typography
      data-testid="setup-key"
      sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 17, letterSpacing: '0.04em', textAlign: 'center', userSelect: 'all' }}
    >
      {String(secret).split(' ').map((group, i) => (
        <React.Fragment key={i}>
          {i > 0 && ' '}
          <Box component="span" sx={{ display: 'inline-block', whiteSpace: 'nowrap' }}>{group}</Box>
        </React.Fragment>
      ))}
    </Typography>
  );
}

function Fold({ label, children, reduceMotion }) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Link component="button" type="button" variant="body2" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
        {label}
      </Link>
      <Collapse in={open} unmountOnExit timeout={reduceMotion ? 0 : 'auto'}>{children}</Collapse>
    </Box>
  );
}

function QrImage({ src }) {
  return (
    <Box
      component="img"
      src={src}
      alt="QR code de l’appli d’authentification"
      sx={{ width: 200, height: 200, bgcolor: '#fff', borderRadius: 1, border: '1px solid', borderColor: 'divider', alignSelf: 'center' }}
    />
  );
}

export default function TwoFactorSetupDialog({
  open, onClose, onDone, onRestart, account = '', emailAvailable = false, initialEnrolment = null,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const touch = useMediaQuery('(pointer: coarse)');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const replacing = Boolean(initialEnrolment);
  const totalSteps = replacing ? 2 : 3;

  const [step, setStep] = useState(replacing ? 2 : 1);
  const [enrolment, setEnrolment] = useState(initialEnrolment);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [ended, setEnded] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [wait, setWait] = useState(0);
  const [resendError, setResendError] = useState('');
  const [copied, setCopied] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [forgetDevices, setForgetDevices] = useState(true);
  const inFlight = useRef(false);
  const body = useRef(null);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (enrolment && enrolment.method === 'email') setWait(enrolment.resendInSeconds || 60);
  }, [enrolment]);

  useEffect(() => {
    if (!open || step !== 2) return undefined;
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      const input = body.current && body.current.querySelector('input[name="one-time-code"]');
      if (input) input.focus();
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [open, step]);

  const guard = async (fn) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await fn(); } finally { inFlight.current = false; setBusy(false); }
  };

  const leave = () => {
    if (step === 3) return;
    if (enrolment && !ended && step === 2) api.cancelTwoFactor().catch(() => {});
    onClose();
  };

  const submitPassword = () => guard(async () => {
    setPasswordError('');
    try {
      setEnrolment(await api.startTwoFactor('totp', password));
      setPassword('');
      setStep(2);
    } catch (err) {
      setPasswordError(messageOf(err, 'Activation impossible.'));
    }
  });

  const restart = () => {
    setEnded(''); setCode(''); setCodeError(''); setEnrolment(null); setPassword('');
    if (replacing) { onClose(); if (onRestart) onRestart(); } else setStep(1);
  };

  const confirm = (value) => guard(async () => {
    setCodeError('');
    try {
      const out = replacing ? await api.confirmTwoFactor(value, { forgetTrustedDevices: forgetDevices }) : await api.confirmTwoFactor(value);
      setResult(out);
      setSaved(false);
      setStep(3);
    } catch (err) {
      if (ENDING_ERRORS.includes(err && err.error)) setEnded(ENROLMENT_ENDED[err.error]);
      else setCodeError(messageOf(err, 'Code incorrect.'));
    }
  });

  const switchMethod = (method) => guard(async () => {
    setResendError(''); setCode(''); setCodeError(''); setLinkError('');
    try {
      setEnrolment(await api.startTwoFactor(method, undefined, undefined, enrolment.enrolmentToken));
    } catch (err) {
      // The window is over (the switch then asks the password again): the enrolment has ended.
      if (err && ['BAD_PASSWORD', 'ENROLMENT_EXPIRED'].includes(err.error)) setEnded(ENROLMENT_ENDED.ENROLMENT_EXPIRED);
      else setLinkError(messageOf(err, 'Changement impossible.'));
    }
  });

  const resend = async () => {
    setResendError('');
    try {
      const out = await api.sendTwoFactorActionCode();
      setWait(out.resendInSeconds || 60);
      setCode(''); setCodeError('');
    } catch (err) {
      if (err && err.retryInSeconds) setWait(err.retryInSeconds);
      setResendError(messageOf(err, 'Envoi impossible.'));
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(compactKey(enrolment.secret));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const finish = () => {
    onDone(result.status);
  };

  const codeField = (
    <Stack spacing={0.5}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {enrolment && enrolment.method === 'email' ? 'Code reçu par email' : 'Code affiché par l’appli'}
      </Typography>
      <OneTimeCodeField
        value={code}
        onChange={(v) => { setCode(v); setCodeError(''); }}
        onComplete={confirm}
        error={codeError}
        helperText={busy ? 'Vérification…' : undefined}
        readOnly={busy}
        autoFocus
      />
    </Stack>
  );

  const keyBlock = enrolment && enrolment.method === 'totp' && (
    <Stack spacing={1}>
      <KeyGroups secret={enrolment.secret} />
      <Button variant="outlined" onClick={copyKey} sx={{ minHeight: 44 }}>{copied ? 'Clé copiée' : 'Copier la clé'}</Button>
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>Basé sur l’heure · 6 chiffres · 30 s</Typography>
    </Stack>
  );

  const appStep = enrolment && enrolment.method === 'totp' && (
    <Stack spacing={2}>
      {touch ? (
        <>
          <Typography variant="body2">Ajouter ce compte dans l’appli d’authentification, puis revenir saisir le code qu’elle affiche.</Typography>
          <Button component="a" href={enrolment.otpauthUri} variant="contained" size="large" sx={{ minHeight: 48 }}>
            Ouvrir dans l’appli d’authentification
          </Button>
          {keyBlock}
          <Fold label="Afficher le QR code (à scanner depuis un autre appareil)" reduceMotion={reduceMotion}>
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}><QrImage src={enrolment.qrDataUrl} /></Box>
          </Fold>
        </>
      ) : (
        <>
          <Typography variant="body2">Scanner ce QR code avec l’appli d’authentification, puis saisir le code qu’elle affiche.</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}><QrImage src={enrolment.qrDataUrl} /></Box>
          <Fold label="Saisie manuelle de la clé" reduceMotion={reduceMotion}>
            <Box sx={{ pt: 1 }}>{keyBlock}</Box>
          </Fold>
        </>
      )}
      <Typography variant="caption" color="text.secondary">
        {`Nom dans l’appli : GuestFlow — ${enrolment.accountLabel}`}
      </Typography>
      {replacing && (
        <Typography variant="body2" color="text.secondary">L’appli actuelle reste valable jusqu’à la validation du nouveau code.</Typography>
      )}
      {codeField}
      {replacing && (
        <FormControlLabel
          control={<Checkbox checked={forgetDevices} onChange={(e) => setForgetDevices(e.target.checked)} />}
          label="Oublier les appareils de confiance"
          sx={{ minHeight: 44 }}
        />
      )}
      {emailAvailable && !replacing && (
        <Link component="button" type="button" variant="body2" onClick={() => switchMethod('email')} disabled={busy}
          sx={{ alignSelf: 'flex-start', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
          Pas d’appli ? Recevoir le code par email
        </Link>
      )}
      {linkError && <Typography variant="body2" color="error" role="alert">{linkError}</Typography>}
    </Stack>
  );

  const emailStep = enrolment && enrolment.method === 'email' && (
    <Stack spacing={2}>
      <Typography variant="body2">{`Code envoyé à ${enrolment.sentTo}, valable 10 minutes.`}</Typography>
      {codeField}
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="text" onClick={resend} disabled={wait > 0 || busy} sx={{ minHeight: 44 }}>
          {wait > 0 ? `Renvoyer le code (${wait} s)` : 'Renvoyer le code'}
        </Button>
        <Link component="button" type="button" variant="body2" onClick={() => switchMethod('totp')} disabled={busy}
          sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
          Utiliser plutôt une appli
        </Link>
      </Stack>
      {(resendError || linkError) && <Typography variant="body2" color="error" role="alert">{resendError || linkError}</Typography>}
    </Stack>
  );

  const stepTitle = step === 2 && enrolment && enrolment.method === 'email' ? 'Email' : SETUP_STEPS[step - 1];
  const stepNumber = replacing ? step - 1 : step;
  const stepLabel = `Étape ${stepNumber} sur ${totalSteps}`;

  return (
    <Dialog
      open={open}
      onClose={(e, reason) => { if (reason !== 'backdropClick') leave(); }}
      fullScreen={fullScreen}
      maxWidth={false}
      fullWidth
      transitionDuration={reduceMotion ? 0 : undefined}
      slotProps={{ paper: { sx: fullScreen ? undefined : { maxWidth: 480 } } }}
    >
      <DialogTitle sx={{ pr: 7 }}>
        <Typography component="span" variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
          {stepLabel}
        </Typography>
        {stepTitle}
        {step < 3 && (
          <IconButton aria-label="Fermer" onClick={leave} sx={{ position: 'absolute', right: 8, top: 8, width: 44, height: 44 }}>
            <CloseIcon />
          </IconButton>
        )}
      </DialogTitle>
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {`${stepLabel} : ${stepTitle}`}
      </Box>
      <DialogContent ref={body}>
        {step === 1 && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{TWO_FACTOR_EXPLAINER}</Typography>
            <PasswordField
              label="Mot de passe (confirmation)"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && password) { e.preventDefault(); submitPassword(); } }}
              autoComplete="current-password"
              autoFocus
              fullWidth
              error={Boolean(passwordError)}
              helperText={passwordError || undefined}
            />
          </Stack>
        )}
        {step === 2 && (ended ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="error">{ended}</Alert>
          </Stack>
        ) : (appStep || emailStep))}
        {step === 3 && result && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              {replacing ? 'Nouvelle appli active. Nouveaux codes de secours :' : 'Validation en deux étapes activée. Conserver ces codes de secours :'}
            </Typography>
            <BackupCodesPanel codes={result.backupCodes} account={account} onSavedChange={setSaved} autoFocus />
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 'max(16px, env(safe-area-inset-bottom))' }}>
        {step === 1 && (
          <>
            <Button onClick={leave} sx={{ minHeight: 44 }}>Annuler</Button>
            <Button variant="contained" onClick={submitPassword} disabled={!password || busy} sx={{ minHeight: 44 }}>Continuer</Button>
          </>
        )}
        {step === 2 && (ended ? (
          <>
            <Button onClick={leave} sx={{ minHeight: 44 }}>Fermer</Button>
            <Button variant="contained" onClick={restart} autoFocus sx={{ minHeight: 44 }}>Recommencer</Button>
          </>
        ) : (
          <Button onClick={leave} sx={{ minHeight: 44 }}>Annuler</Button>
        ))}
        {step === 3 && <Button variant="contained" onClick={finish} disabled={!saved} sx={{ minHeight: 44 }}>Terminé</Button>}
      </DialogActions>
    </Dialog>
  );
}
