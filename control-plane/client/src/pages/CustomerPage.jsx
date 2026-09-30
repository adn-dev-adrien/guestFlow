/**
 * One customer (specs/control-plane-plans-and-access.md rules 7, 15, 17, 19, 20, 33, 34): the
 * subscription, the creation steps, the billing identity, the actions — record a payment, check the
 * payment in Qonto, send a reminder now, extend, put back to active, change plan, download the
 * licence, deprovision, reactivate, erase — the invoices, the emails and the history. Every rule is
 * the server's; a refused action shows its message as a toast and keeps the dialog open.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Box, Button, Card, CardContent, Checkbox, Chip, FormControlLabel, Link, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SyncIcon from '@mui/icons-material/Sync';
import PaymentsIcon from '@mui/icons-material/Payments';
import EventIcon from '@mui/icons-material/Event';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RestoreIcon from '@mui/icons-material/Restore';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import PageActionBar from '@gf/components/PageActionBar';
import FormDialog from '@gf/components/FormDialog';
import LoadingState from '@gf/components/LoadingState';
import ErrorAlert from '@gf/components/ErrorAlert';
import { useToast } from '@gf/components/DialogProvider';
import LifecycleChip from '../components/LifecycleChip';
import ProvisioningSteps from '../components/ProvisioningSteps';
import KeyValues from '../components/KeyValues';
import EmailQueue from '../components/EmailQueue';
import MailPreview from '../components/MailPreview';
import api from '../api';

const DEPROVISION_ORDER = [
  'L’export complet est produit : copie de la base, photos, CSV des réservations et des clients.',
  'Son lien part par email au contact, valable 30 jours.',
  'Le processus et la route sont arrêtés ; l’adresse affiche « Cet espace a été fermé » (à la main jusqu’à la phase H).',
  'L’état devient « Archivé ».',
  'Dans 90 jours, le dossier et ses sauvegardes sont effacés.',
];

const INVOICE_COLORS = { pending: 'warning', open: 'info', paid: 'success', cancelled: 'default' };
const EMAIL_COLORS = { pending: 'warning', sent: 'success', failed: 'error', ignored: 'default', dropped: 'default' };

function Section({ title, action, children }) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
          <Typography variant="sectionHeader" component="h2">{title}</Typography>
          {action}
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}

export default function CustomerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState({});
  const [busyStep, setBusyStep] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.customer(id).then(setC).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  const openDialog = (name, initial = {}) => { setDraft(initial); setDialog(name); };
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  async function act(fn, success) {
    try {
      const next = await fn();
      if (next && next.erased) {
        showSuccess(success);
        navigate('/');
        return;
      }
      setC(next);
      setDialog(null);
      if (success) showSuccess(success);
    } catch (err) {
      showError(err.message);
    }
  }

  async function stepAction(step, action) {
    setBusyStep(step);
    try {
      setC(await api.stepAction(id, step, action));
    } catch (err) {
      showError(err.message);
    } finally {
      setBusyStep(null);
    }
  }

  if (error) return <><PageActionBar title="Client" backTo="/" /><Box sx={{ p: 2 }}><ErrorAlert message={error} onRetry={load} /></Box></>;
  if (!c) return <><PageActionBar title="Client" backTo="/" /><LoadingState /></>;

  const a = c.actions;
  const openRemind = async () => {
    try {
      const { preview } = await api.remindPreview(c.id);
      openDialog('remind', { preview });
    } catch (err) {
      showError(err.message);
    }
  };
  const checkPayment = async () => {
    try {
      const next = await api.checkPayment(c.id);
      setC(next);
      showSuccess(next.notice);
    } catch (err) {
      showError(err.message);
    }
  };
  const queueAction = (fn, done) => async (emailId) => {
    try {
      await fn(emailId);
      showSuccess(done);
      load();
    } catch (err) {
      showError(err.message);
    }
  };
  const pendingEmails = c.emails.filter((e) => e.status === 'pending')
    .map((e) => ({ id: e.id, name: e.name, preparedOn: e.at, recipient: e.recipient, subject: e.subject, body: e.body }));

  const before = [
    a.pay && { icon: <PaymentsIcon />, tooltip: 'Enregistrer un paiement', color: 'success', onClick: () => openDialog('pay', { months: c.defaults.paymentMonths, reference: '' }) },
    a.checkPayment && { icon: <SyncIcon />, tooltip: 'Vérifier le paiement', color: 'info', onClick: checkPayment },
    !c.archivedAt && { icon: <SendIcon />, tooltip: a.remind ? 'Relancer maintenant' : a.remindHint, color: 'info', disabled: !a.remind, ariaLabel: 'Relancer maintenant', onClick: openRemind },
    a.extend && { icon: <EventIcon />, tooltip: 'Prolonger', color: 'info', onClick: () => openDialog('extend', { endsAt: c.defaults.extendTo, reason: '' }) },
    a.forceActive && { icon: <LockOpenIcon />, tooltip: 'Remettre en actif', color: 'info', onClick: () => openDialog('force', { until: c.defaults.forceActiveUntil, reason: '' }) },
    a.changePlan && { icon: <SwapHorizIcon />, tooltip: 'Changer de forfait', color: 'info', onClick: () => openDialog('plan', { planCode: c.planCode, billing: c.billing, addons: c.addons.map((x) => x.id) }) },
    { icon: <DownloadIcon />, tooltip: 'Télécharger la licence', onClick: () => { window.location.href = api.licenceUrl(c.id); } },
  ].filter(Boolean);
  const after = [
    a.deprovision && { icon: <DeleteForeverIcon />, tooltip: 'Déprovisionner', color: 'error', onClick: () => openDialog('deprovision', { confirmSlug: '' }) },
    a.reactivate && { icon: <RestoreIcon />, tooltip: 'Réactiver', color: 'success', onClick: () => act(() => api.reactivate(c.id), 'Client réactivé.') },
    a.cancelErase && { icon: <EventBusyIcon />, tooltip: 'Annuler l’effacement', color: 'info', onClick: () => act(() => api.cancelErase(c.id), 'Effacement annulé.') },
    a.eraseNow && { icon: <DeleteForeverIcon />, tooltip: 'Effacer maintenant', color: 'error', onClick: () => openDialog('erase', { confirmSlug: '' }) },
  ].filter(Boolean);

  const preview = c.paymentPreview.find((p) => p.months === draft.months);

  return (
    <>
      <PageActionBar title={c.companyName} titleOnXs backTo="/" subtitle={<LifecycleChip state={c.state} label={c.stateLabel} />}
        actionsBefore={before} actionsAfter={after} />
      <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) minmax(0,1fr)' } }}>
          <Section title="Abonnement">
            <KeyValues items={[
              { label: 'État', value: <><LifecycleChip state={c.state} label={c.stateLabel} />{c.stateNote ? ` ${c.stateNote}` : ''}</> },
              { label: 'Adresse', value: <a href={c.url} target="_blank" rel="noopener noreferrer">{c.url.replace('https://', '')}</a> },
              { label: 'Contact', value: [c.contactName, c.contactEmail].filter(Boolean).join(' · ') },
              { label: 'Forfait', value: `${c.planName} · ${c.billingLabel}${c.addons.length ? ` + ${c.addons.map((x) => x.name).join(', ')}` : ''}` },
              { label: 'Prix', value: `${c.priceLabel} (catalogue v${c.catalogueVersion})` },
              { label: 'Hors forfait conservés', value: c.grandfathered.map((x) => x.name).join(', ') },
              { label: 'Essai jusqu’au', value: c.trialEndsAtLabel },
              { label: 'Échéance', value: `${c.endsAtLabel}${c.daysLeft !== null ? ` (${c.daysLeft} j)` : ''}` },
              { label: 'Effacement prévu', value: c.eraseAtLabel },
            ]} />
          </Section>
          <Section title="Création">
            <ProvisioningSteps steps={c.steps} onAction={stepAction} busy={busyStep} />
          </Section>
        </Box>
        {c.deprovisionSteps.length > 0 && (
          <Section title="Déprovisionnement">
            <ProvisioningSteps steps={c.deprovisionSteps} onAction={stepAction} busy={busyStep} />
          </Section>
        )}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) minmax(0,1fr)' } }}>
          <Section title="Factures">
            {c.invoices.length === 0 ? <Typography variant="body2" color="text.secondary">Aucune facture.</Typography> : (
              <Stack spacing={1} component="ul" sx={{ m: 0, p: 0 }} aria-label="Factures">
                {c.invoices.map((i) => (
                  <Box component="li" key={i.id} sx={{ listStyle: 'none' }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{i.number}</Typography>
                      <Chip size="small" label={i.statusLabel} color={INVOICE_COLORS[i.status] || 'default'} />
                      <Typography variant="body2">{i.period}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {i.amount} HT{i.total !== '—' ? ` · ${i.total} TTC` : ''}
                      {i.invoiceUrl && <> · <Link href={i.invoiceUrl} target="_blank" rel="noopener noreferrer">Facture</Link></>}
                      {i.payUrl && <> · <Link href={i.payUrl} target="_blank" rel="noopener noreferrer">Lien de paiement</Link></>}
                    </Typography>
                    {i.detail && <Typography variant="caption" color={i.status === 'pending' ? 'warning.main' : 'text.secondary'} component="div">{i.detail}</Typography>}
                  </Box>
                ))}
              </Stack>
            )}
          </Section>
          <Section title="Facturation" action={a.editBilling && (
            <Button size="small" sx={{ minHeight: 44 }} onClick={() => openDialog('billing', {
              billingStreet: c.billingIdentity.street, billingPostcode: c.billingIdentity.postcode, billingCity: c.billingIdentity.city, billingCountry: c.billingIdentity.country, vatNumber: c.billingIdentity.vatNumber,
            })}>Modifier</Button>
          )}>
            <KeyValues items={c.billingIdentity.lines} />
          </Section>
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) minmax(0,1fr)' } }}>
          <Section title="Emails">
            {pendingEmails.length > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600 }}>À valider</Typography>
                <EmailQueue items={pendingEmails} showCustomer={false} onSend={queueAction(api.sendEmail, 'Email envoyé.')} onIgnore={queueAction(api.ignoreEmail, 'Email ignoré.')} />
              </Box>
            )}
            {c.emails.length === 0 ? <Typography variant="body2" color="text.secondary">Aucun email de facturation.</Typography> : (
              <Stack spacing={0.75} component="ul" sx={{ m: 0, pl: 0 }} aria-label="Emails envoyés">
                {c.emails.filter((e) => e.status !== 'pending').map((e) => (
                  <Box component="li" key={e.id} sx={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                    <Typography variant="body2">{e.at} — {e.name}</Typography>
                    <Chip size="small" label={e.statusLabel} color={EMAIL_COLORS[e.status] || 'default'} />
                    {e.operator && <Typography variant="caption" color="text.secondary">({e.operator})</Typography>}
                    {e.error && <Typography variant="caption" color="text.secondary">{e.error}</Typography>}
                  </Box>
                ))}
              </Stack>
            )}
          </Section>
          <Section title="Historique">
            <Stack spacing={0.75} component="ul" sx={{ m: 0, pl: 2.5 }}>
              {c.history.map((h, i) => (
                <Typography key={i} component="li" variant="body2">{h.day} — {h.text} <Typography component="span" variant="caption" color="text.secondary">({h.operator})</Typography></Typography>
              ))}
            </Stack>
          </Section>
        </Box>
      </Stack>

      <FormDialog open={dialog === 'pay'} onClose={() => setDialog(null)} title="Enregistrer un paiement reçu"
        onSubmit={() => act(() => api.recordPayment(c.id, draft), 'Paiement enregistré.')}>
        <Stack spacing={2}>
          <Typography variant="body2">Un virement ou un paiement hors lien. La fin recule de la durée payée et l’état redevient actif, quel qu’il soit.</Typography>
          <ToggleButtonGroup exclusive value={draft.months} onChange={(e, v) => v && set('months')(v)}>
            {c.paymentPreview.map((p) => <ToggleButton key={p.months} value={p.months} sx={{ minHeight: 44 }}>{p.months} mois · {p.amount}</ToggleButton>)}
          </ToggleButtonGroup>
          {preview && <Typography variant="body2">{preview.text}</Typography>}
          <TextField label="Référence" value={draft.reference || ''} onChange={(e) => set('reference')(e.target.value)} placeholder="Virement du 28/09" />
        </Stack>
      </FormDialog>

      <FormDialog open={dialog === 'remind'} onClose={() => setDialog(null)} title="Relancer maintenant" submitLabel="Envoyer"
        onSubmit={() => act(() => api.remind(c.id), 'Relance envoyée.')}>
        {draft.preview && <MailPreview to={draft.preview.to} subject={draft.preview.subject} body={draft.preview.body} />}
      </FormDialog>

      <FormDialog open={dialog === 'billing'} onClose={() => setDialog(null)} title="Facturation"
        onSubmit={() => act(() => api.setBilling(c.id, draft), 'Facturation enregistrée.')}>
        <Stack spacing={2}>
          <Typography variant="body2">La prochaine facture part vers un client Qonto créé avec cette adresse ; une facture déjà émise garde l’ancienne.</Typography>
          <TextField label="Adresse" value={draft.billingStreet || ''} onChange={(e) => set('billingStreet')(e.target.value)} />
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: '160px minmax(0,1fr)' } }}>
            <TextField label="Code postal" value={draft.billingPostcode || ''} onChange={(e) => set('billingPostcode')(e.target.value)} />
            <TextField label="Ville" value={draft.billingCity || ''} onChange={(e) => set('billingCity')(e.target.value)} />
          </Box>
          <TextField select label="Pays" value={draft.billingCountry || 'FR'} onChange={(e) => set('billingCountry')(e.target.value)}>
            {c.countries.map((x) => <MenuItem key={x.code} value={x.code}>{x.name}</MenuItem>)}
          </TextField>
          <TextField label="N° de TVA (facultatif)" value={draft.vatNumber || ''} onChange={(e) => set('vatNumber')(e.target.value)} />
        </Stack>
      </FormDialog>

      <FormDialog open={dialog === 'extend'} onClose={() => setDialog(null)} title="Prolonger l’abonnement (geste commercial)" submitLabel="Prolonger"
        onSubmit={() => act(() => api.extend(c.id, draft), 'Abonnement prolongé.')}>
        <Stack spacing={2}>
          <TextField label="Nouvelle date de fin" type="date" value={draft.endsAt || ''} onChange={(e) => set('endsAt')(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Motif (obligatoire)" value={draft.reason || ''} onChange={(e) => set('reason')(e.target.value)} multiline minRows={2} />
        </Stack>
      </FormDialog>

      <FormDialog open={dialog === 'force'} onClose={() => setDialog(null)} title="Remettre en actif" submitLabel="Remettre en actif"
        onSubmit={() => act(() => api.forceActive(c.id, draft), 'Client remis en actif.')}>
        <Stack spacing={2}>
          <Typography variant="body2">L’état reste « Actif » jusqu’à la date choisie, puis le calendrier reprend la main.</Typography>
          <TextField label="Jusqu’au" type="date" value={draft.until || ''} onChange={(e) => set('until')(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Motif (obligatoire)" value={draft.reason || ''} onChange={(e) => set('reason')(e.target.value)} multiline minRows={2} />
        </Stack>
      </FormDialog>

      <FormDialog open={dialog === 'plan'} onClose={() => setDialog(null)} title="Changer de forfait"
        onSubmit={() => act(() => api.changePlan(c.id, draft), 'Forfait changé ; licence réémise.')}>
        {dialog === 'plan' && (
          <Stack spacing={2}>
            <ToggleButtonGroup exclusive value={draft.planCode} onChange={(e, v) => v && set('planCode')(v)} sx={{ flexWrap: 'wrap' }}>
              {c.plans.map((p) => <ToggleButton key={p.code} value={p.code} sx={{ minHeight: 44 }}>{p.name}</ToggleButton>)}
            </ToggleButtonGroup>
            <ToggleButtonGroup exclusive value={draft.billing} onChange={(e, v) => v && set('billing')(v)}>
              <ToggleButton value="monthly" sx={{ minHeight: 44 }}>Mensuelle</ToggleButton>
              <ToggleButton value="yearly" sx={{ minHeight: 44 }}>Annuelle</ToggleButton>
            </ToggleButtonGroup>
            {c.plans.find((p) => p.code === draft.planCode).addonChoices.map((x) => (
              <FormControlLabel key={x.pluginId} sx={{ minHeight: 44 }} disabled={x.included}
                label={x.included ? `${x.name} — inclus dans le forfait` : `${x.name} — ${x.priceLabel}`}
                control={<Checkbox checked={x.included || (draft.addons || []).includes(x.pluginId)}
                  onChange={() => set('addons')((draft.addons || []).includes(x.pluginId) ? draft.addons.filter((y) => y !== x.pluginId) : [...(draft.addons || []), x.pluginId])} />} />
            ))}
            {c.grandfathered.length > 0 && (
              <Typography variant="body2" color="warning.main">
                Changer de forfait retire ce qui était conservé hors forfait : {c.grandfathered.map((x) => x.name).join(', ')}.
              </Typography>
            )}
          </Stack>
        )}
      </FormDialog>

      <FormDialog open={dialog === 'deprovision'} onClose={() => setDialog(null)} title={`Déprovisionner ${c.companyName} ?`}
        submitLabel="Déprovisionner" submitColor="error" submitDisabled={draft.confirmSlug !== c.slug}
        onSubmit={() => act(() => api.deprovision(c.id, draft.confirmSlug), 'Client déprovisionné.')}>
        <Stack spacing={2}>
          <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
            {DEPROVISION_ORDER.map((line) => <Typography key={line} component="li" variant="body2" sx={{ mb: 0.5 }}>{line}</Typography>)}
          </Box>
          <TextField label={`Pour confirmer, tapez « ${c.slug} »`} value={draft.confirmSlug || ''} onChange={(e) => set('confirmSlug')(e.target.value)} autoComplete="off" />
        </Stack>
      </FormDialog>

      <FormDialog open={dialog === 'erase'} onClose={() => setDialog(null)} title="Effacer maintenant ?"
        submitLabel="Effacer définitivement" submitColor="error" submitDisabled={draft.confirmSlug !== c.slug}
        onSubmit={() => act(() => api.eraseNow(c.id, draft.confirmSlug), 'Données effacées ; l’adresse est de nouveau libre.')}>
        <Stack spacing={2}>
          <Typography variant="body2">Le dossier de l’instance et ses sauvegardes sont effacés sans retour possible, avant la date prévue.</Typography>
          <TextField label={`Seconde confirmation : tapez « ${c.slug} »`} value={draft.confirmSlug || ''} onChange={(e) => set('confirmSlug')(e.target.value)} autoComplete="off" />
        </Stack>
      </FormDialog>
    </>
  );
}
