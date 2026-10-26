/**
 * SettingsGoogleVrSection — the « Google Vacation Rentals » tab of Paramètres › Intégrations
 * (specs/google-vacation-rentals-feed.md §4.2, §6; mock docs/specs/2026-10-26-google-vacation-rentals-feed.html).
 *
 * Left: the partner id, the mode (Simulation / Envoi — Envoi refused without a partner id or an enabled
 * property, then confirmed), each property's switch, Google code and website page. Right: the state the
 * server reports, the three actions (Pousser, Tout renvoyer, Vérifier les prix), the last check's
 * mismatches and the push log. No Save of its own: the page's bar saves it through the ref. Every
 * count, label and mismatch comes from /api/google-vacation-rentals — nothing is computed here.
 *
 * Props:
 *   onDirtyChange  (dirty: boolean) => void
 * Ref:
 *   save()   writes the draft;  reset()  drops it
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Divider, FormControlLabel, Grid, List, ListItem, Stack, Switch, TextField, Typography,
} from '@mui/material';
import {
  api, ConfirmDialog, StatusBadge, SummaryItem, displayDate, formatCurrency,
} from '../sdk';

const PLUGIN = 'google-vacation-rentals';
const FIELDS = ['partnerId', 'mode', 'horizonDays', 'maxLos', 'properties'];
const HOTEL_CODE_RE = /^[a-z0-9-]{3,40}$/;

const parseProperties = (raw) => { try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } };
const when = (iso) => (iso ? `${displayDate(iso.slice(0, 10))} à ${new Date(iso).toTimeString().slice(0, 5)}` : '');

function ModeButton({ selected, onClick, children }) {
  return (
    <Button
      variant={selected ? 'contained' : 'outlined'}
      aria-pressed={selected}
      onClick={onClick}
      sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }}
    >
      {children}
    </Button>
  );
}

function PropertyRow({ property, entry, onChange, error }) {
  const enabled = Boolean(entry.enabled);
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle2">{property.name}</Typography>
        <FormControlLabel
          sx={{ mr: 0 }}
          labelPlacement="start"
          label="Sur Google"
          control={<Switch checked={enabled} onChange={(e) => onChange({ enabled: e.target.checked })} slotProps={{ input: { 'aria-label': `Publier ${property.name} sur Google` } }} />}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1.5 }}>
        <TextField
          size="small"
          label="Code Google"
          value={entry.hotelCode ?? property.hotelCode}
          onChange={(e) => onChange({ hotelCode: e.target.value.trim() })}
          disabled={!enabled}
          error={Boolean(error)}
          helperText={error || ' '}
          fullWidth
        />
        <TextField
          size="small"
          label="Page du site"
          value={entry.slug ?? property.slug}
          onChange={(e) => onChange({ slug: e.target.value.trim() })}
          disabled={!enabled}
          helperText=" "
          fullWidth
        />
      </Stack>
      {enabled && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {property.itineraries.toLocaleString('fr-FR')} séjours tarifés
          {property.lastRunAt ? ` · ${property.lastResultLabel} le ${when(property.lastRunAt)}` : ' · jamais poussé'}
          {property.pendingDiff ? ` · ${property.pendingDiff} changements à renvoyer` : ''}
        </Typography>
      )}
      {enabled && property.landingUrl && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" component="p">Lien d’arrivée à déclarer dans Hotel Center</Typography>
          <Typography variant="caption" component="p" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{property.landingUrl}</Typography>
        </Box>
      )}
    </Box>
  );
}

function SettingsGoogleVrSection({ onDirtyChange }, ref) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  const [errors, setErrors] = useState({});
  const [modeRefusal, setModeRefusal] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const reload = useCallback(() => Promise.all([
    api.getGoogleVrStatus().then(setStatus),
    api.getGoogleVrLog(20).then((r) => setLog(r.runs || [])),
  ]).catch(() => {}), []);

  useEffect(() => {
    api.getPluginSettings(PLUGIN).then((s) => { setSaved(s); setDraft(s); }).catch(() => {});
    reload();
  }, [reload]);

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
        reload();
      } catch (err) {
        setErrors(err.errors || {});
        throw err;
      }
    },
    reset: () => { setDraft(saved); setErrors({}); setModeRefusal(''); },
  }));

  if (!draft || !status) return null;

  const entries = parseProperties(draft.properties);
  const entryOf = (p) => entries[p.id] || {};
  const setEntry = (id, patch) => setDraft((d) => {
    const current = parseProperties(d.properties);
    return { ...d, properties: JSON.stringify({ ...current, [id]: { ...(current[id] || {}), ...patch } }) };
  });
  const enabledInDraft = status.properties.some((p) => (entryOf(p).enabled ?? p.enabled));
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  // Rule 16 — the refusal shows at once; the server refuses the same write anyway.
  const askEnvoi = () => {
    if (!String(draft.partnerId || '').trim()) { setModeRefusal('Envoi impossible : identifiant partenaire manquant.'); return; }
    if (!enabledInDraft) { setModeRefusal('Envoi impossible : aucun logement activé.'); return; }
    setConfirm('envoi');
  };
  const setMode = (mode) => { setModeRefusal(''); setDraft((d) => ({ ...d, mode })); };

  const act = async (label, call) => {
    setBusy(label);
    setMessage(null);
    try {
      const result = await call();
      setMessage(result);
    } catch (err) {
      setMessage({ severity: 'error', text: err.message || 'Échec' });
    } finally {
      setBusy('');
      reload();
    }
  };
  const push = (full) => act(full ? 'full' : 'push', async () => {
    const r = await api.pushGoogleVr({ full });
    const lines = r.runs.map((run) => {
      const name = (status.properties.find((p) => p.id === run.propertyId) || {}).name || run.propertyId;
      return `${name} : ${run.resultLabel}${run.rates || run.days ? ` (${run.rates} prix, ${run.days} jours)` : ''}`;
    });
    const failed = r.runs.some((run) => run.result === 'error');
    return { severity: failed ? 'error' : 'success', text: lines.join(' · ') };
  });
  const check = () => act('check', async () => { await api.checkGoogleVr({ samples: 200 }); return null; });

  const live = saved.mode === 'envoi';
  const badge = status.enabledCount === 0
    ? <StatusBadge status="neutral" label="Aucun logement" />
    : <StatusBadge status={live ? 'success' : 'info'} label={live ? 'Envoi' : 'Simulation'} />;
  const lastCheck = status.lastCheck;
  const actionsDisabled = Boolean(busy) || dirty || status.enabledCount === 0;

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="sectionHeader">Google Vacation Rentals</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          Les prix du site, taxe de séjour comprise, et les disponibilités de chaque logement envoyés à Google.
          En simulation, rien ne quitte le serveur.
        </Typography>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2">Connexion</Typography>
              <TextField
                label="Identifiant partenaire Google"
                placeholder="Fourni par Google après acceptation"
                value={draft.partnerId || ''}
                onChange={(e) => { setModeRefusal(''); set('partnerId')(e); }}
                error={Boolean(errors.partnerId || modeRefusal.includes('identifiant'))}
                helperText={errors.partnerId || ' '}
                fullWidth
              />
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }} id="gvr-mode">Mode</Typography>
                <Stack direction="row" spacing={1} role="group" aria-labelledby="gvr-mode">
                  <ModeButton selected={draft.mode !== 'envoi'} onClick={() => setMode('simulation')}>Simulation</ModeButton>
                  <ModeButton selected={draft.mode === 'envoi'} onClick={() => (draft.mode === 'envoi' ? null : askEnvoi())}>Envoi</ModeButton>
                </Stack>
                {(modeRefusal || errors.mode) && (
                  <Typography variant="body2" color="error" role="alert" sx={{ mt: 1 }}>{modeRefusal || errors.mode}</Typography>
                )}
              </Box>

              <Typography variant="subtitle2" sx={{ pt: 1 }}>Logements</Typography>
              {status.properties.map((p) => {
                const entry = entryOf(p);
                const code = entry.hotelCode ?? p.hotelCode;
                const enabled = entry.enabled ?? p.enabled;
                const codeError = enabled && code && !HOTEL_CODE_RE.test(code)
                  ? 'Lettres minuscules, chiffres et tirets, 3 à 40 caractères.'
                  : '';
                return (
                  <PropertyRow
                    key={p.id}
                    property={p}
                    entry={{ ...entry, enabled }}
                    error={codeError}
                    onChange={(patch) => { setModeRefusal(''); setEntry(p.id, { hotelCode: code, slug: entry.slug ?? p.slug, ...entry, enabled, ...patch }); }}
                  />
                );
              })}
              {errors.properties && <Typography variant="body2" color="error">{errors.properties}</Typography>}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Horizon (jours)"
                  type="number"
                  value={draft.horizonDays || ''}
                  onChange={set('horizonDays')}
                  error={Boolean(errors.horizonDays)}
                  helperText={errors.horizonDays || ' '}
                  slotProps={{ htmlInput: { min: 30, max: 500, inputMode: 'numeric' } }}
                  fullWidth
                />
                <TextField
                  label="Séjour le plus long (nuits)"
                  type="number"
                  value={draft.maxLos || ''}
                  onChange={set('maxLos')}
                  error={Boolean(errors.maxLos)}
                  helperText={errors.maxLos || ' '}
                  slotProps={{ htmlInput: { min: 1, max: 30, inputMode: 'numeric' } }}
                  fullWidth
                />
              </Stack>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="subtitle2">État</Typography>
                {badge}
              </Stack>
              <Box>
                <SummaryItem label="Identifiant partenaire" value={status.configured ? 'renseigné' : ''} valuePlaceholder="manquant" />
                <SummaryItem
                  label="Dernière erreur Google"
                  value={status.lastError ? `${when(status.lastError.at)} — ${status.lastError.text}` : ''}
                  valuePlaceholder="aucune"
                />
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap', '& .MuiButton-root': { minHeight: 44, whiteSpace: 'nowrap' } }}>
                <Button variant="outlined" sx={{ minHeight: 44 }} disabled={actionsDisabled} onClick={() => push(false)}>
                  {busy === 'push' ? 'Envoi…' : 'Pousser maintenant'}
                </Button>
                <Button variant="outlined" sx={{ minHeight: 44 }} disabled={actionsDisabled} onClick={() => setConfirm('full')}>
                  {busy === 'full' ? 'Renvoi…' : 'Tout renvoyer'}
                </Button>
                <Button variant="outlined" sx={{ minHeight: 44 }} disabled={actionsDisabled} onClick={check}>
                  {busy === 'check' ? 'Vérification…' : 'Vérifier les prix'}
                </Button>
              </Stack>
              {dirty && <Typography variant="body2" color="text.secondary">Enregistrer les réglages avant de pousser ou de vérifier.</Typography>}
              {message && <Alert severity={message.severity}>{message.text}</Alert>}

              {lastCheck && (
                lastCheck.mismatches.length === 0 ? (
                  <Alert severity="success">
                    {`${lastCheck.checked} séjours vérifiés le ${when(lastCheck.checkedAt)} : aucun écart avec le devis du site.`}
                  </Alert>
                ) : (
                  <Alert severity="error">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {`${lastCheck.mismatches.length} écart${lastCheck.mismatches.length > 1 ? 's' : ''} sur ${lastCheck.checked} séjours`}
                    </Typography>
                    <List dense disablePadding aria-label="Écarts de prix">
                      {lastCheck.mismatches.map((m) => (
                        <ListItem key={`${m.propertyId}-${m.checkin}-${m.nights}-${m.guests}`} disableGutters sx={{ display: 'block' }}>
                          {`${m.propertyName}, arrivée ${displayDate(m.checkin)}, ${m.nights} nuit${m.nights > 1 ? 's' : ''}, ${m.guests} voyageur${m.guests > 1 ? 's' : ''} — envoyé ${m.sent == null ? 'rien' : formatCurrency(m.sent)}, site ${m.website == null ? 'non vendu' : formatCurrency(m.website)}`}
                        </ListItem>
                      ))}
                    </List>
                  </Alert>
                )
              )}

              <Divider />
              <Typography variant="subtitle2">Journal</Typography>
              {log.length === 0 ? (
                <Typography variant="body2" color="text.secondary">Aucun passage pour l’instant.</Typography>
              ) : (
                <List dense disablePadding aria-label="Journal des envois">
                  {log.map((run) => (
                    <ListItem key={run.id} disableGutters sx={{ display: 'block', py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                      <Typography variant="body2">
                        {`${when(run.startedAt)} · ${run.propertyName || '—'} · ${run.resultLabel}`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {`${run.full ? 'Renvoi complet' : 'Différence'} · ${run.rates} prix · ${run.days} jours${run.failed ? ` · ${run.failed} en échec` : ''}${run.httpStatus ? ` · HTTP ${run.httpStatus}` : ''}`}
                      </Typography>
                      {run.googleBody && (
                        <Typography variant="caption" color={run.result === 'error' ? 'error' : 'text.secondary'} component="p" sx={{ wordBreak: 'break-word' }}>
                          {run.googleBody}
                        </Typography>
                      )}
                    </ListItem>
                  ))}
                </List>
              )}
            </Stack>
          </Grid>
        </Grid>
      </CardContent>

      <ConfirmDialog
        open={confirm === 'envoi'}
        onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); setMode('envoi'); }}
        title="Passer en Envoi ?"
        message="Une fois enregistré, les prix et disponibilités partent réellement chez Google."
        confirmLabel="Passer en Envoi"
        confirmColor="primary"
      />
      <ConfirmDialog
        open={confirm === 'full'}
        onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); push(true); }}
        title="Tout renvoyer ?"
        message="Tous les prix et disponibilités de l’horizon sont recalculés et renvoyés, même inchangés. Compter une minute par logement."
        confirmLabel="Tout renvoyer"
        confirmColor="primary"
      />
    </Card>
  );
}

export default forwardRef(SettingsGoogleVrSection);
