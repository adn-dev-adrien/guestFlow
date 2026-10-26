/**
 * SettingsSection — the « Saisie Airbnb » card of Paramètres › Intégrations (specs/airbnb-mail-intake.md
 * §4.3). The mailbox is the one GuestFlow sends from (same account as the SMTP settings): only the IMAP
 * server, the sender and the frequency are set here. The listing of each property comes from its Airbnb
 * iCal feed (rule 11); the field per property only overrides it. No Save of its own: the page's bar
 * saves it through the ref.
 *
 * Props:
 *   onDirtyChange  (dirty: boolean) => void
 * Ref:
 *   save()   writes the draft;  reset()  drops it
 */
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { api, displayDate } from '../sdk';

const PLUGIN = 'airbnb-intake';

// The pass summary the server returns: { skipped } or { read, applied, proposed, pending, error, ignored }.
function describePass(r) {
  if (r.skipped) return r.skipped;
  const parts = [`${r.read || 0} nouveau(x) mail(s)`];
  if (r.applied) parts.push(`${r.applied} fiche(s) remplie(s)`);
  if (r.proposed) parts.push(`${r.proposed} proposition(s) sur une fiche déjà modifiée`);
  if (r.pending) parts.push(`${r.pending} en attente de la fiche iCal`);
  if (r.error) parts.push(`${r.error} à vérifier`);
  return `${parts.join(', ')}.`;
}
const FIELDS = ['senderAddress', 'imapHost', 'imapPort', 'pollEveryHours', 'listings', 'autoApply'];

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
    api.getAirbnbIntakeMailbox().then(setMailbox).catch(() => {});
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
  const listingMap = (() => { try { return JSON.parse(draft.listings || '{}'); } catch { return {}; } })();
  const setListing = (propertyId, value) => setDraft((d) => {
    const next = { ...listingMap, [propertyId]: value.trim() };
    if (!next[propertyId]) delete next[propertyId];
    return { ...d, listings: JSON.stringify(next) };
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
            <Typography variant="sectionHeader">Saisie Airbnb</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Les mails « Réservation confirmée » d’Airbnb remplissent la fiche iCal correspondante.
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
              label="Serveur IMAP"
              value={draft.imapHost || ''}
              onChange={set('imapHost')}
              helperText={`Vide : déduit du serveur d’envoi${mailbox && mailbox.defaultHost ? ` (${mailbox.defaultHost})` : ''}.`}
              fullWidth
            />
            <TextField label="Port IMAP" type="number" value={draft.imapPort || ''} onChange={set('imapPort')} helperText=" " sx={{ minWidth: { sm: 140 } }} />
          </Stack>

          <Box>
            <Typography variant="subtitle2">Annonce Airbnb de chaque logement</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Reconnue d’après le flux iCal Airbnb du logement : rien à saisir. Ce champ ne sert qu’à la corriger.
            </Typography>
            <Stack spacing={1}>
              {properties.map((p) => (
                <TextField
                  key={p.id}
                  size="small"
                  label={p.name}
                  value={listingMap[p.id] || ''}
                  onChange={(e) => setListing(p.id, e.target.value)}
                  placeholder={mailbox && mailbox.detected && mailbox.detected[p.id] ? `Reconnue : ${mailbox.detected[p.id]}` : 'Aucun flux iCal Airbnb — coller le lien de l’annonce'}
                  sx={{ maxWidth: { sm: 480 } }}
                />
              ))}
            </Stack>
            {errors.listings && <Typography variant="body2" color="error">{errors.listings}</Typography>}
          </Box>

          <FormControlLabel
            control={<Switch checked={String(draft.autoApply) !== '0'} onChange={(e) => setDraft((d) => ({ ...d, autoApply: e.target.checked ? '1' : '0' }))} />}
            label="Remplir seul une fiche iCal encore intacte"
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Button variant="outlined" sx={{ minHeight: 44 }} onClick={() => act('Connexion', api.testAirbnbIntakeMailbox, (r) => (r.ok ? 'Connexion réussie.' : `Échec : ${r.error}`))}>
              Tester la connexion
            </Button>
            <Button variant="outlined" sx={{ minHeight: 44 }} onClick={() => act('Relève', api.runAirbnbIntake, describePass)}>
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
