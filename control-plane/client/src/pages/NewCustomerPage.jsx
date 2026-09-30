/**
 * A new customer (specs/control-plane-plans-and-access.md rules 7 and 21): identity, billing identity
 * (the address Qonto needs to invoice), subscription. The server checks the form as it is typed and
 * computes the end date and the price; saving opens the customer's page on its creation steps.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Card, CardContent, Checkbox, FormControlLabel, Grid, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import PageActionBar from '@gf/components/PageActionBar';
import { useToast } from '@gf/components/DialogProvider';
import api from '../api';

const EMPTY = {
  companyName: '', contactName: '', contactEmail: '', slug: '',
  planCode: 'pro', billing: 'monthly', length: 12, startsAt: '', endsAt: '', trial: true, addons: [],
  billingStreet: '', billingPostcode: '', billingCity: '', billingCountry: 'FR', vatNumber: '',
};
// Checked as typed once filled in; the others once a save was attempted.
const LIVE = ['slug', 'billingPostcode', 'vatNumber'];

function Toggle({ value, onChange, options, label }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <ToggleButtonGroup exclusive size="small" value={value} onChange={(e, v) => v !== null && onChange(v)} sx={{ flexWrap: 'wrap' }}>
        {options.map((o) => <ToggleButton key={o.value} value={o.value} sx={{ minHeight: 44 }}>{o.label}</ToggleButton>)}
      </ToggleButtonGroup>
    </Stack>
  );
}

export default function NewCustomerPage() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [catalogue, setCatalogue] = useState(null);
  const [preview, setPreview] = useState({ errors: {}, summary: null });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.catalogue().then(setCatalogue).catch((err) => showError(err.message)); }, [showError]);
  useEffect(() => {
    const t = setTimeout(() => api.previewCustomer(form).then((p) => {
      setPreview(p);
      if (!form.startsAt) setForm((f) => (f.startsAt ? f : { ...f, startsAt: p.defaults.startsAt }));
    }).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [form]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const field = (key) => (e) => set(key)(e.target.value);
  // The slug is checked as it is typed; the other fields once a save was attempted.
  const errorOf = (key) => ((submitted || (LIVE.includes(key) && form[key])) ? preview.errors[key] : undefined);

  async function save() {
    setSubmitted(true);
    setBusy(true);
    try {
      const created = await api.createCustomer(form);
      navigate(`/clients/${created.id}`);
    } catch (err) {
      if (err.errors) setPreview((p) => ({ ...p, errors: err.errors }));
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const toggleAddon = (id) => set('addons')(form.addons.includes(id) ? form.addons.filter((a) => a !== id) : [...form.addons, id]);

  return (
    <>
      <PageActionBar title="Nouveau client" titleOnXs backTo="/" onSave={save} saveBusy={busy} saveTooltip="Créer le client" />
      <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 900 }}>
        <Card>
          <CardContent>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Société" value={form.companyName} onChange={field('companyName')} fullWidth required
                  error={Boolean(errorOf('companyName'))} helperText={errorOf('companyName')} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Adresse (slug)" value={form.slug} onChange={(e) => set('slug')(e.target.value.trim())} fullWidth required
                  error={Boolean(errorOf('slug'))} helperText={errorOf('slug') || (preview.summary && preview.summary.url) || 'Minuscules, chiffres et tirets.'} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Contact" value={form.contactName} onChange={field('contactName')} fullWidth />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Email du contact (premier administrateur)" type="email" value={form.contactEmail} onChange={field('contactEmail')} fullWidth required
                  error={Boolean(errorOf('contactEmail'))} helperText={errorOf('contactEmail')} />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="sectionHeader" component="h2" sx={{ mb: 1.5 }}>Facturation</Typography>
            <Grid container spacing={2}>
              <Grid size={12}>
                <TextField label="Adresse" value={form.billingStreet} onChange={field('billingStreet')} fullWidth required
                  error={Boolean(errorOf('billingStreet'))} helperText={errorOf('billingStreet')} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Code postal" value={form.billingPostcode} onChange={field('billingPostcode')} fullWidth required
                  error={Boolean(errorOf('billingPostcode'))} helperText={errorOf('billingPostcode')} />
              </Grid>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField label="Ville" value={form.billingCity} onChange={field('billingCity')} fullWidth required
                  error={Boolean(errorOf('billingCity'))} helperText={errorOf('billingCity')} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField select label="Pays" value={form.billingCountry} onChange={field('billingCountry')} fullWidth>
                  {(preview.countries || [{ code: 'FR', name: 'France' }]).map((x) => <MenuItem key={x.code} value={x.code}>{x.name}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="N° de TVA (facultatif)" value={form.vatNumber} onChange={field('vatNumber')} fullWidth
                  error={Boolean(errorOf('vatNumber'))} helperText={errorOf('vatNumber')} />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Stack spacing={2}>
              {catalogue && (
                <Toggle label="Forfait" value={form.planCode} onChange={set('planCode')}
                  options={catalogue.plans.map((p) => ({ value: p.code, label: p.name }))} />
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Toggle label="Facturation" value={form.billing} onChange={set('billing')}
                  options={[{ value: 'monthly', label: 'Mensuelle' }, { value: 'yearly', label: 'Annuelle' }]} />
                <Toggle label="Durée" value={form.length} onChange={set('length')}
                  options={[{ value: 1, label: '1 mois' }, { value: 12, label: '12 mois' }, { value: 'custom', label: 'Date de fin' }]} />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Début" type="date" value={form.startsAt} onChange={field('startsAt')} slotProps={{ inputLabel: { shrink: true } }}
                  error={Boolean(errorOf('startsAt'))} helperText={errorOf('startsAt')} />
                {form.length === 'custom' && (
                  <TextField label="Fin" type="date" value={form.endsAt} onChange={field('endsAt')} slotProps={{ inputLabel: { shrink: true } }}
                    error={Boolean(errorOf('endsAt'))} helperText={errorOf('endsAt')} />
                )}
              </Stack>
              <FormControlLabel control={<Checkbox checked={form.trial} onChange={(e) => set('trial')(e.target.checked)} />}
                label="Période d’essai de 30 jours, sans paiement" sx={{ minHeight: 44 }} />
              {preview.addonChoices && preview.addonChoices.length > 0 && (
                <Stack>
                  <Typography variant="caption" color="text.secondary">Options à la carte</Typography>
                  {preview.addonChoices.map((a) => (
                    <FormControlLabel key={a.pluginId} sx={{ minHeight: 44 }} disabled={a.included}
                      control={<Checkbox checked={a.included || form.addons.includes(a.pluginId)} onChange={() => toggleAddon(a.pluginId)} />}
                      label={a.included ? `${a.name} — inclus dans le forfait` : `${a.name} — ${a.priceLabel}`} />
                  ))}
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
        {preview.summary && (
          <Card sx={{ borderLeft: 4, borderColor: 'secondary.main' }}>
            <CardContent>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{preview.summary.price}</Typography>
              <Typography variant="body2">{preview.summary.period}</Typography>
              <Typography variant="caption" color="text.secondary">{preview.summary.catalogue}</Typography>
            </CardContent>
          </Card>
        )}
      </Stack>
    </>
  );
}
