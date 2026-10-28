/**
 * SettingsSection — the « Saisie Gîtes de France » card of Paramètres › Intégrations
 * (specs/gites-de-france-mail-intake.md §4.3). The mailbox is the one GuestFlow sends from (same account
 * as the SMTP settings): only the IMAP server, the sender, the frequency and the property → gîte number
 * map are set here. No Save of its own: the page's bar saves it through the ref.
 *
 * Props:
 *   onDirtyChange  (dirty: boolean) => void
 * Ref:
 *   save()   writes the draft;  reset()  drops it
 */
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { api, displayDate } from '../sdk';

const PLUGIN = 'gites-de-france-intake';

// The pass summary the server returns: { skipped } or { read, applied, needs_rent, proposed, pending, error }.
function describePass(r) {
  if (r.skipped) return r.skipped;
  const parts = [`${r.read || 0} nouveau(x) mail(s)`];
  const filled = (r.applied || 0) + (r.needs_rent || 0);
  if (filled) parts.push(`${filled} fiche(s) remplie(s)${r.needs_rent ? ` dont ${r.needs_rent} avec le loyer à choisir` : ''}`);
  if (r.proposed) parts.push(`${r.proposed} proposition(s) sur une fiche déjà modifiée`);
  if (r.pending) parts.push(`${r.pending} en attente de la fiche iCal`);
  if (r.error) parts.push(`${r.error} à vérifier`);
  return `${parts.join(', ')}.`;
}
const FIELDS = ['senderAddress', 'imapHost', 'imapPort', 'pollEveryHours', 'giteNumbers', 'autoApply', 'senderDomains', 'trustedAuthservId'];

function SettingsSection({ onDirtyChange }, ref) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [properties, setProperties] = useState([]);
  const [mailbox, setMailbox] = useState(null);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    api.getPluginSettings(PLUGIN).then((s) => { setSaved(s); setDraft(s); }).catch(() => {});
    api.getProperties().then(setProperties).catch(() => {});
    api.getGdfIntakeMailbox().then(setMailbox).catch(() => {});
  }, []);

  const dirty = useMemo(() => Boolean(saved && draft && FIELDS.some((k) => String(saved[k] ?? '') !== String(draft[k] ?? ''))), [saved, draft]);
  useEffect(() => { if (onDirtyChange) onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    async save() {
      if (!dirty) return;
      try {
        const next = await api.savePluginSettings(PLUGIN, Object.fromEntries(FIELDS.map((k) => [k, draft[k]])));
        setSaved(next);
        setDraft(next);
        setErrors({});
      } catch (err) {
        setErrors(err.errors || {});
        throw err;
      }
    },
    reset: () => { setDraft(saved); setErrors({}); },
  }));

  if (!draft) return null;
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const giteMap = (() => { try { return JSON.parse(draft.giteNumbers || '{}'); } catch { return {}; } })();
  const setGite = (propertyId, value) => setDraft((d) => {
    const next = { ...giteMap, [propertyId]: value.replace(/\D/g, '') };
    if (!next[propertyId]) delete next[propertyId];
    return { ...d, giteNumbers: JSON.stringify(next) };
  });

  const act = async (label, call, describe) => {
    setStatus(`${label}…`);
    try { setStatus(describe(await call())); } catch (err) { setStatus(err.message || 'Échec'); }
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">Saisie Gîtes de France</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Les mails « nouvelle réservation » de la centrale remplissent la fiche iCal correspondante.
              Boîte lue : {mailbox ? `${mailbox.user || '—'}` : '…'} (celle de l’envoi des mails), en lecture seule.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Expéditeur des mails" value={draft.senderAddress || ''} onChange={set('senderAddress')} fullWidth />
            <TextField
              label="Relève toutes les (heures)"
              type="number"
              slotProps={{ htmlInput: { min: 1, max: 24 } }}
              value={draft.pollEveryHours || ''}
              onChange={set('pollEveryHours')}
              error={Boolean(errors.pollEveryHours)}
              helperText={errors.pollEveryHours || ' '}
              sx={{ minWidth: { sm: 200 } }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Domaines de signature acceptés"
              value={draft.senderDomains || ''}
              onChange={set('senderDomains')}
              helperText="Vide : le domaine de l’expéditeur."
              fullWidth
            />
            <TextField
              label="Serveur de la boîte (authserv-id)"
              value={draft.trustedAuthservId || ''}
              onChange={set('trustedAuthservId')}
              helperText="Vide : premier en-tête d’authentification."
              fullWidth
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Serveur IMAP"
              value={draft.imapHost || ''}
              onChange={set('imapHost')}
              error={Boolean(errors.imapHost)}
              helperText={errors.imapHost || `Vide : déduit du serveur d’envoi${mailbox && mailbox.defaultHost ? ` (${mailbox.defaultHost})` : ''}.`}
              fullWidth
            />
            <TextField label="Port IMAP" type="number" value={draft.imapPort || ''} onChange={set('imapPort')} helperText=" " sx={{ minWidth: { sm: 140 } }} />
          </Stack>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>N° de gîte de chaque logement</Typography>
            <Stack spacing={1}>
              {properties.map((p) => (
                <TextField
                  key={p.id}
                  size="small"
                  label={p.name}
                  value={giteMap[p.id] || ''}
                  onChange={(e) => setGite(p.id, e.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                  sx={{ maxWidth: { sm: 320 } }}
                />
              ))}
            </Stack>
            {errors.giteNumbers && <Typography variant="body2" color="error">{errors.giteNumbers}</Typography>}
          </Box>

          <FormControlLabel
            control={<Switch checked={String(draft.autoApply) !== '0'} onChange={(e) => setDraft((d) => ({ ...d, autoApply: e.target.checked ? '1' : '0' }))} />}
            label="Remplir seul une fiche iCal encore intacte"
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Button variant="outlined" sx={{ minHeight: 44 }} onClick={() => act('Connexion', api.testGdfIntakeMailbox, (r) => (r.ok ? 'Connexion réussie.' : `Échec : ${r.error}`))}>
              Tester la connexion
            </Button>
            <Button variant="outlined" sx={{ minHeight: 44 }} onClick={() => act('Relève', api.runGdfIntake, describePass)}>
              Relever maintenant
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {status || (mailbox && mailbox.lastRunAt ? `Dernière relève le ${displayDate(mailbox.lastRunAt.slice(0, 10))} à ${new Date(mailbox.lastRunAt).toTimeString().slice(0, 5)}.` : '')}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default forwardRef(SettingsSection);
