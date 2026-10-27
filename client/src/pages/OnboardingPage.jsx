/**
 * OnboardingPage — `/demarrage`, the start assistant (specs/plugins-phase-p-productisation.md §3.D
 * rules 20–23). Five steps: Entreprise, Premier logement, Plugins (three yes/no questions the server
 * maps to plugins — rule 43), Emails
 * (specs/guest-email-texts-made-simple.md rule 21), C'est prêt. Every step is
 * validated and saved by the server when « Suivant » is pressed; an error keeps the step open.
 * « Plus tard » closes the assistant and keeps what was saved.
 *
 * Props (tests only): onFullLoad(to) — what loading the app again at `to` means once a plugin was
 * installed from a package (rule 42; default: window.location.assign).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Alert, Box, Chip, Link, Stack, Switch, TextField, Typography,
} from '@mui/material';
import api from '../api';
import { useAuth } from '../hooks/useAuth';
import StepperPage from '../components/StepperPage';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import OnboardingEmailsStep from '../components/OnboardingEmailsStep';
import ReadinessList, { targetUrl } from '../components/ReadinessList';

const TITLES = ['Entreprise', 'Premier logement', 'Plugins', 'Emails', 'C’est prêt'];
const STEPS = TITLES.length;
const EMAILS_STEP = 4;
// A link of the last step: a full-height touch target, its text at the top-left.
const LAST_STEP_LINK = { textAlign: 'left', minHeight: 44, display: 'flex', alignItems: 'center' };
const ONBOARDING_PLUGINS_FOOTNOTE = 'Le reste se règle plus tard dans Paramètres › Plugins.';
// Rule 21 — the capacity is asked of the server once the beds stop changing for this long.
const CAPACITY_DEBOUNCE_MS = 250;
const EMPTY_PROPERTY = { name: '', doubleBeds: '1', singleBeds: '0', maxGuests: '2', checkIn: '16:00', checkOut: '10:00', pricePerNight: '' };

const Brand = () => (
  <Typography sx={{ fontFamily: 'Georgia, serif', fontWeight: 600, color: 'primary.main' }}>GuestFlow</Typography>
);

const loadPage = (to) => window.location.assign(to);

export default function OnboardingPage({ onFullLoad = loadPage }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState('');
  const [company, setCompany] = useState({ name: '', email: '', phone: '', address: '', siret: '' });
  const [property, setProperty] = useState(EMPTY_PROPERTY);
  const [capacityTouched, setCapacityTouched] = useState(false);
  // Rule 21 — the last capacity request asked; an older answer arriving late is dropped.
  const capacityRequest = useRef(0);
  const capacityTimer = useRef(null);
  const [plugins, setPlugins] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [emails, setEmails] = useState(null);
  const [emailDraft, setEmailDraft] = useState({});
  const [readiness, setReadiness] = useState([]);
  // Rule 28 — the properties the instance already has, when the assistant did not create them.
  const [existingProperties, setExistingProperties] = useState(0);
  const [loginEmail, setLoginEmail] = useState('');
  const [pluginsSummary, setPluginsSummary] = useState('');
  // Rule 42 — a plugin installed from a package is not in the open bundle: leaving loads the app again.
  const [needsLoad, setNeedsLoad] = useState(false);

  useEffect(() => {
    if (location.pathname !== '/demarrage') navigate('/demarrage', { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => () => clearTimeout(capacityTimer.current), []);

  useEffect(() => {
    api.getOnboarding()
      .then((data) => {
        setCompany((c) => ({ ...c, ...data.company }));
        // Rule 28 — the property the assistant created comes back to be edited, never doubled.
        if (data.property && data.property.draft) {
          setProperty({ ...EMPTY_PROPERTY, ...data.property.draft });
          setCapacityTouched(true);
        } else if (data.property && data.property.existing > 0) {
          setExistingProperties(data.property.existing);
        }
        setPlugins(data.plugins || []);
        setPluginsSummary(data.pluginsSummary || '');
        setQuestions(data.questions || []);
        setAnswers(Object.fromEntries((data.questions || []).map((q) => [q.id, Boolean(q.answer)])));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const field = (obj, setObj, key) => ({
    value: obj[key],
    onChange: (e) => {
      setObj((prev) => ({ ...prev, [key]: e.target.value }));
      if (errors[key]) setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
    },
    error: Boolean(errors[key]),
    // No reserved blank line under each field: it made the gaps uneven (a reserved line + the stack's
    // gap, a hint, or the grid's own gap). The message appears when there is one (2026-10-27 audit).
    helperText: errors[key] || undefined,
  });

  // Rule 21 — the capacity follows what the server proposes for the beds until it is typed by hand.
  // A failed request leaves the field as it is: the server fills a missing capacity on save.
  const setBeds = (key) => (e) => {
    const next = { ...property, [key]: e.target.value };
    setProperty(next);
    setErrors({});
    if (capacityTouched) return;
    const asked = ++capacityRequest.current;
    clearTimeout(capacityTimer.current);
    capacityTimer.current = setTimeout(() => {
      Promise.resolve()
        .then(() => api.getOnboardingDefaultCapacity(next.doubleBeds, next.singleBeds))
        .then(({ maxGuests }) => {
          if (asked !== capacityRequest.current || maxGuests == null) return;
          setProperty((p) => ({ ...p, maxGuests: String(maxGuests) }));
        })
        .catch(() => {});
    }, CAPACITY_DEBOUNCE_MS);
  };

  const typeCapacity = (e) => {
    capacityRequest.current += 1;
    clearTimeout(capacityTimer.current);
    setCapacityTouched(true);
    setProperty((p) => ({ ...p, maxGuests: e.target.value }));
    setErrors((prev) => ({ ...prev, maxGuests: undefined }));
  };

  // « Plus tard », « Ouvrir le tableau de bord » and the links of the last step all close it.
  async function leave(to = '/') {
    setBusy(true);
    try {
      await api.completeOnboarding();
      if (needsLoad) { onFullLoad(to); return; }
      await refresh();
      navigate(to, { replace: true });
    } catch (err) {
      setFailure(err?.message || 'Échec de l’enregistrement.');
      setBusy(false);
    }
  }

  // « Emails » opens pre-filled from what the earlier steps saved; « C'est prêt » lists what is missing.
  async function enter(target) {
    if (target === EMAILS_STEP) {
      const data = await api.getOnboarding();
      const e = data.emails;
      setEmails(e);
      setEmailDraft({
        phone: e.phone,
        senderName: e.senderName,
        properties: Object.fromEntries(e.properties.map((p) => [p.id, {
          nameArticle: p.nameArticle, address: p.address, access: p.access, accessCode: '', wifiName: p.wifiName, wifiPassword: '',
          caution: p.caution == null ? '' : String(p.caution), cleaningIncluded: p.cleaningIncluded, towelsProvided: p.towelsProvided,
          bedLinenProvided: p.bedLinenProvided,
        }])),
      });
    }
    if (target === STEPS) setReadiness((await api.getEmailReadiness()).items || []);
    setStep(target);
  }

  async function next() {
    setBusy(true);
    setFailure('');
    try {
      if (step === 1) {
        // specs/hosting-h2-account-security.md rule 27 — the company email becomes the login of the
        // bootstrap account; the step says so once.
        const saved = await api.saveOnboardingCompany(company);
        if (saved && saved.loginChanged) {
          setLoginEmail(saved.loginEmail);
          await refresh();
        }
      }
      if (step === 2 && !existingProperties) await api.saveOnboardingProperty(property);
      if (step === 3) {
        // Rule 43 — only the questions still open to an answer: a settled one changes nothing.
        const open = questions.filter((q) => q.allowed && !q.settled);
        const saved = await api.saveOnboardingPlugins(Object.fromEntries(open.map((q) => [q.id, Boolean(answers[q.id])])));
        setPluginsSummary(saved.pluginsSummary || '');
        if (saved.reload) setNeedsLoad(true);
        // Rule 37 — each plugin left out is named with the server's reason.
        const failed = saved.results.filter((r) => !r.ok).map((r) => {
          const label = (plugins.find((p) => p.id === r.id) || {}).label || r.id;
          return r.reason ? `${label} (${r.reason})` : label;
        });
        await refresh();
        if (failed.length) {
          setFailure(`Non activé : ${failed.join(', ')}`);
          setBusy(false);
          return;
        }
      }
      if (step === EMAILS_STEP) {
        await api.saveOnboardingEmails({
          phone: emailDraft.phone,
          senderName: emailDraft.senderName,
          // An unanswered article, deposit, cleaning, towels or bed linen is not sent: it stays unsaid (rules 27, 29).
          properties: Object.entries(emailDraft.properties || {}).map(([id, p]) => {
            const { nameArticle, caution, cleaningIncluded, towelsProvided, bedLinenProvided, accessCode, ...rest } = p;
            return {
              id: Number(id),
              ...rest,
              ...(nameArticle ? { nameArticle } : {}),
              ...(caution !== '' && caution != null ? { caution } : {}),
              ...(cleaningIncluded != null ? { cleaningIncluded } : {}),
              ...(towelsProvided != null ? { towelsProvided } : {}),
              ...(bedLinenProvided != null ? { bedLinenProvided } : {}),
              ...(accessCode ? { accessCode } : {}),
            };
          }),
        });
      }
      if (step === STEPS) { await leave(); return; }
      setErrors({});
      await enter(step + 1);
    } catch (err) {
      if (err?.errors) setErrors(err.errors);
      else setFailure(err?.message || 'Échec de l’enregistrement.');
    }
    setBusy(false);
  }

  if (loading) return <LoadingState />;
  if (loadError) return <Box sx={{ p: 3 }}><ErrorAlert message="Impossible de charger l’assistant." onRetry={() => window.location.reload()} /></Box>;

  return (
    <StepperPage
      brand={<Brand />}
      step={step}
      total={STEPS}
      title={TITLES[step - 1]}
      onNext={next}
      nextLabel={step === STEPS ? 'Ouvrir le tableau de bord' : 'Suivant'}
      onBack={step > 1 && step < STEPS ? () => { setErrors({}); setFailure(''); setStep(step - 1); } : undefined}
      onLater={step < STEPS ? () => leave() : undefined}
      busy={busy}
    >
      {failure && <Alert severity="error" sx={{ mb: 2 }}>{failure}</Alert>}

      {step === 1 && (
        <Stack spacing={2}>
          <TextField label="Nom de l’entreprise" required {...field(company, setCompany, 'name')} />
          <TextField label="Email" type="email" required {...field(company, setCompany, 'email')} />
          <TextField label="Téléphone" {...field(company, setCompany, 'phone')} />
          <TextField label="Adresse" {...field(company, setCompany, 'address')} />
          <TextField label="SIRET" {...field(company, setCompany, 'siret')} helperText={errors.siret || '14 chiffres'} />
        </Stack>
      )}

      {step === 2 && loginEmail && (
        <Alert severity="info" sx={{ mb: 2 }}>{`Connexion désormais avec ${loginEmail}.`}</Alert>
      )}

      {step === 2 && existingProperties > 0 && (
        <Stack spacing={1}>
          <Typography>{`Logements : ${existingProperties}`}</Typography>
          <Link component="button" type="button" onClick={() => leave('/properties')} sx={{ textAlign: 'left' }}>Modifier dans Logements</Link>
        </Stack>
      )}

      {step === 2 && !existingProperties && (
        <Stack spacing={2}>
          <TextField label="Nom du logement" required {...field(property, setProperty, 'name')} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2, rowGap: 2 }}>
            <TextField label="Lits doubles" type="number" value={property.doubleBeds} onChange={setBeds('doubleBeds')} error={Boolean(errors.doubleBeds)} helperText={errors.doubleBeds || undefined} />
            <TextField label="Lits simples" type="number" value={property.singleBeds} onChange={setBeds('singleBeds')} error={Boolean(errors.singleBeds)} helperText={errors.singleBeds || undefined} />
            <TextField
              label="Capacité"
              type="number"
              {...field(property, setProperty, 'maxGuests')}
              onChange={typeCapacity}
            />
            <TextField label="Prix par nuit (€)" type="number" required {...field(property, setProperty, 'pricePerNight')} />
            <TextField label="Arrivée à partir de" type="time" {...field(property, setProperty, 'checkIn')} error={Boolean(errors.defaultCheckIn)} helperText={errors.defaultCheckIn || undefined} />
            <TextField label="Départ avant" type="time" {...field(property, setProperty, 'checkOut')} error={Boolean(errors.defaultCheckOut)} helperText={errors.defaultCheckOut || undefined} />
          </Box>
        </Stack>
      )}

      {step === 3 && (
        <Stack spacing={1.5}>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {questions.map((q, i) => (
              <Box
                key={q.id}
                component="label"
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, minHeight: 56,
                  borderTop: i ? 1 : 0, borderColor: 'divider', cursor: q.allowed && !q.settled ? 'pointer' : 'default',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: q.allowed ? 'text.primary' : 'text.secondary' }}>{q.label}</Typography>
                  {q.hint && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{q.hint}</Typography>}
                  {!q.allowed && q.plan && <Chip size="small" label={q.plan} sx={{ mt: 0.5 }} />}
                </Box>
                <Switch
                  checked={Boolean(answers[q.id]) && q.allowed}
                  disabled={!q.allowed || Boolean(q.settled)}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.checked }))}
                  slotProps={{ input: { 'aria-label': q.label } }}
                />
              </Box>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary">{ONBOARDING_PLUGINS_FOOTNOTE}</Typography>
        </Stack>
      )}

      {step === EMAILS_STEP && emails && (
        <OnboardingEmailsStep
          emails={emails}
          value={emailDraft}
          onChange={({ property, patch, ...rest }) => {
            setEmailDraft((d) => (property
              ? { ...d, properties: { ...d.properties, [property]: { ...d.properties[property], ...patch } } }
              : { ...d, ...rest }));
            setErrors({});
          }}
          errors={errors}
        />
      )}

      {step === STEPS && (
        <Stack spacing={1.5}>
          <Typography>{`${company.name || 'L’établissement'} est prêt.`}</Typography>
          <ReadinessList items={readiness} title="Emails à compléter" onOpen={(target) => leave(targetUrl(target))} />
          <Stack spacing={0}>
            <Link component="button" type="button" onClick={() => leave('/settings/emails/textes')} sx={LAST_STEP_LINK}>Réglages › Emails : les textes des emails</Link>
            <Link component="button" type="button" onClick={() => leave('/properties')} sx={LAST_STEP_LINK}>Tarifs : saisons et prix des logements</Link>
            <Link component="button" type="button" onClick={() => leave('/parametres/plugins')} sx={LAST_STEP_LINK}>{`Plugins : ${pluginsSummary}`}</Link>
          </Stack>
        </Stack>
      )}
    </StepperPage>
  );
}
