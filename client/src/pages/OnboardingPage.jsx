/**
 * OnboardingPage — `/demarrage`, the start assistant (specs/plugins-phase-p-productisation.md §3.D
 * rules 20–23). Four steps: Entreprise, Premier logement, Plugins, C'est prêt. Every step is
 * validated and saved by the server when « Suivant » is pressed; an error keeps the step open.
 * « Plus tard » closes the assistant and keeps what was saved.
 */
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Alert, Box, Checkbox, Chip, FormControlLabel, Link, Stack, TextField, Typography,
} from '@mui/material';
import api from '../api';
import { useAuth } from '../hooks/useAuth';
import StepperPage from '../components/StepperPage';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';

const TITLES = ['Entreprise', 'Premier logement', 'Plugins', 'C’est prêt'];
const EMPTY_PROPERTY = { name: '', doubleBeds: '1', singleBeds: '0', maxGuests: '2', checkIn: '16:00', checkOut: '10:00', pricePerNight: '' };

const Brand = () => (
  <Typography sx={{ fontFamily: 'Georgia, serif', fontWeight: 600, color: 'primary.main' }}>GuestFlow</Typography>
);

export default function OnboardingPage() {
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
  const [plugins, setPlugins] = useState([]);
  const [picked, setPicked] = useState({});

  useEffect(() => {
    if (location.pathname !== '/demarrage') navigate('/demarrage', { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => {
    api.getOnboarding()
      .then((data) => {
        setCompany((c) => ({ ...c, ...data.company }));
        setPlugins(data.plugins || []);
        setPicked(Object.fromEntries((data.plugins || []).map((p) => [p.id, p.allowed && (p.recommended || p.state === 'active')])));
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
    helperText: errors[key] || ' ',
  });

  // Capacity follows the sleeping places until it is typed by hand.
  const setBeds = (key) => (e) => {
    const next = { ...property, [key]: e.target.value };
    if (!capacityTouched) next.maxGuests = String(2 * (Number(next.doubleBeds) || 0) + (Number(next.singleBeds) || 0));
    setProperty(next);
    setErrors({});
  };

  // « Plus tard », « Ouvrir le tableau de bord » and the links of the last step all close it.
  async function leave(to = '/') {
    setBusy(true);
    try {
      await api.completeOnboarding();
      await refresh();
      navigate(to, { replace: true });
    } catch (err) {
      setFailure(err?.message || 'Échec de l’enregistrement.');
      setBusy(false);
    }
  }

  async function next() {
    setBusy(true);
    setFailure('');
    try {
      if (step === 1) await api.saveOnboardingCompany(company);
      if (step === 2) await api.saveOnboardingProperty(property);
      if (step === 3) {
        const ids = Object.keys(picked).filter((id) => picked[id]);
        const { results } = await api.saveOnboardingPlugins(ids);
        const failed = results.filter((r) => !r.ok).map((r) => (plugins.find((p) => p.id === r.id) || {}).label || r.id);
        await refresh();
        if (failed.length) {
          setFailure(`Non activé : ${failed.join(', ')}`);
          setBusy(false);
          return;
        }
      }
      if (step === 4) { await leave(); return; }
      setErrors({});
      setStep(step + 1);
    } catch (err) {
      if (err?.errors) setErrors(err.errors);
      else setFailure(err?.message || 'Échec de l’enregistrement.');
    }
    setBusy(false);
  }

  if (loading) return <LoadingState />;
  if (loadError) return <Box sx={{ p: 3 }}><ErrorAlert message="Impossible de charger l’assistant." onRetry={() => window.location.reload()} /></Box>;

  const active = plugins.filter((p) => picked[p.id] && p.allowed);

  return (
    <StepperPage
      brand={<Brand />}
      step={step}
      total={4}
      title={TITLES[step - 1]}
      onNext={next}
      nextLabel={step === 4 ? 'Ouvrir le tableau de bord' : 'Suivant'}
      onBack={step > 1 && step < 4 ? () => { setErrors({}); setFailure(''); setStep(step - 1); } : undefined}
      onLater={step < 4 ? () => leave() : undefined}
      busy={busy}
    >
      {failure && <Alert severity="error" sx={{ mb: 2 }}>{failure}</Alert>}

      {step === 1 && (
        <Stack spacing={1}>
          <TextField label="Nom de l’entreprise" required {...field(company, setCompany, 'name')} />
          <TextField label="Email" type="email" required {...field(company, setCompany, 'email')} />
          <TextField label="Téléphone" {...field(company, setCompany, 'phone')} />
          <TextField label="Adresse" {...field(company, setCompany, 'address')} />
          <TextField label="SIRET" {...field(company, setCompany, 'siret')} helperText={errors.siret || '14 chiffres'} />
        </Stack>
      )}

      {step === 2 && (
        <Stack spacing={1}>
          <TextField label="Nom du logement" required {...field(property, setProperty, 'name')} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
            <TextField label="Lits doubles" type="number" value={property.doubleBeds} onChange={setBeds('doubleBeds')} error={Boolean(errors.doubleBeds)} helperText={errors.doubleBeds || ' '} />
            <TextField label="Lits simples" type="number" value={property.singleBeds} onChange={setBeds('singleBeds')} error={Boolean(errors.singleBeds)} helperText={errors.singleBeds || ' '} />
            <TextField
              label="Capacité"
              type="number"
              {...field(property, setProperty, 'maxGuests')}
              onChange={(e) => { setCapacityTouched(true); setProperty((p) => ({ ...p, maxGuests: e.target.value })); setErrors((prev) => ({ ...prev, maxGuests: undefined })); }}
            />
            <TextField label="Prix par nuit (€)" type="number" {...field(property, setProperty, 'pricePerNight')} />
            <TextField label="Arrivée à partir de" type="time" {...field(property, setProperty, 'checkIn')} error={Boolean(errors.defaultCheckIn)} helperText={errors.defaultCheckIn || ' '} />
            <TextField label="Départ avant" type="time" {...field(property, setProperty, 'checkOut')} error={Boolean(errors.defaultCheckOut)} helperText={errors.defaultCheckOut || ' '} />
          </Box>
        </Stack>
      )}

      {step === 3 && (
        <Stack spacing={1}>
          {plugins.map((p) => (
            <Box key={p.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1, opacity: p.allowed ? 1 : 0.6 }}>
              <FormControlLabel
                control={<Checkbox checked={Boolean(picked[p.id]) && p.allowed} disabled={!p.allowed} onChange={(e) => setPicked((prev) => ({ ...prev, [p.id]: e.target.checked }))} />}
                label={(
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.description}</Typography>
                    {!p.allowed && p.plan && <Box><Chip size="small" label={p.plan} sx={{ mt: 0.5 }} /></Box>}
                  </Box>
                )}
              />
            </Box>
          ))}
        </Stack>
      )}

      {step === 4 && (
        <Stack spacing={1.5}>
          <Typography>{`${company.name || 'L’établissement'} est prêt.`}</Typography>
          <Link component="button" type="button" onClick={() => leave('/settings/emails/textes')} sx={{ textAlign: 'left' }}>Réglages › Emails : les textes des mails</Link>
          <Link component="button" type="button" onClick={() => leave('/properties')} sx={{ textAlign: 'left' }}>Tarifs : saisons et prix des logements</Link>
          <Link component="button" type="button" onClick={() => leave('/parametres/plugins')} sx={{ textAlign: 'left' }}>{`Plugins : ${active.length} actif(s)`}</Link>
        </Stack>
      )}
    </StepperPage>
  );
}
