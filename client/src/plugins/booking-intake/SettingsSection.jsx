/**
 * SettingsSection — the « Saisie Booking » card of Paramètres › Intégrations
 * (specs/booking-extranet-intake.md §4.3): install link of the userscript, secret regeneration, the
 * property → Booking establishment id map, the iCal sources counted as Booking, and the last intakes.
 * No Save of its own: the page's bar saves the map and the sources through the ref.
 *
 * Props:
 *   onDirtyChange  (dirty: boolean) => void
 * Ref:
 *   save()   writes the draft;  reset()  drops it
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { api, displayDate, useAppDialogs } from '../sdk';

const PLUGIN = 'booking-intake';
const FIELDS = ['hotelIds', 'sourceKeys'];
const SCRIPT_URL = '/api/booking-intake/userscript.user.js';

const STATUS_LABELS = {
  applied: 'rempli',
  same: 'déjà à jour',
  proposed: 'proposition',
  refused: 'refusé',
  ignored: 'ignoré',
};

const parse = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };

function SettingsSection({ onDirtyChange }, ref) {
  const { confirm } = useAppDialogs();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [properties, setProperties] = useState([]);
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState({});

  const loadLog = useCallback(() => {
    api.getBookingIntakeLog(10).then((r) => setLog(Array.isArray(r) ? r : [])).catch(() => setLog([]));
  }, []);

  useEffect(() => {
    api.getPluginSettings(PLUGIN).then((s) => { setSaved(s); setDraft(s); }).catch(() => {});
    api.getProperties().then(setProperties).catch(() => {});
    loadLog();
  }, [loadLog]);

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

  const hotelMap = parse(draft.hotelIds || '{}', {});
  const setHotel = (propertyId, value) => setDraft((d) => {
    const next = { ...hotelMap, [propertyId]: value.replace(/\D/g, '') };
    if (!next[propertyId]) delete next[propertyId];
    return { ...d, hotelIds: JSON.stringify(next) };
  });
  const sources = parse(draft.sourceKeys || '[]', []).join(', ');
  const setSources = (value) => setDraft((d) => ({
    ...d,
    sourceKeys: JSON.stringify(value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
  }));

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Régénérer le secret',
      message: 'Les scripts déjà installés cesseront de fonctionner : il faudra réinstaller le nouveau.',
      confirmLabel: 'Régénérer',
      confirmColor: 'primary',
    });
    if (!ok) return;
    try {
      await api.regenerateBookingIntakeSecret();
      setStatus('Secret régénéré. Réinstaller le script.');
    } catch (err) {
      setStatus(err.message || 'Échec');
    }
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">Saisie Booking</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Un script installé dans le navigateur envoie à GuestFlow la réservation ouverte dans l’extranet Booking,
              et la fiche iCal correspondante est remplie. GuestFlow ne connaît aucun identifiant Booking.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Button variant="contained" component="a" href={SCRIPT_URL} target="_blank" rel="noopener noreferrer" sx={{ minHeight: 44 }}>
              Installer le script
            </Button>
            <Button variant="outlined" onClick={regenerate} sx={{ minHeight: 44 }}>
              Régénérer le secret
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {status || 'Nécessite Tampermonkey, Violentmonkey ou Userscripts (Safari).'}
            </Typography>
          </Stack>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>N° d’établissement Booking de chaque logement</Typography>
            <Stack spacing={1}>
              {properties.map((p) => (
                <TextField
                  key={p.id}
                  size="small"
                  label={p.name}
                  value={hotelMap[p.id] || ''}
                  onChange={(e) => setHotel(p.id, e.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                  sx={{ maxWidth: { sm: 320 } }}
                />
              ))}
            </Stack>
            {errors.hotelIds && <Typography variant="body2" color="error">{errors.hotelIds}</Typography>}
          </Box>

          <TextField
            label="Sources iCal comptées comme Booking"
            value={sources}
            onChange={(e) => setSources(e.target.value)}
            helperText={errors.sourceKeys || 'Séparées par des virgules. « lodgify » tant que Lodgify transmet les réservations Booking.'}
            error={Boolean(errors.sourceKeys)}
          />

          {log.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Dernières pages reçues</Typography>
              <Stack spacing={0.25}>
                {log.map((row) => (
                  <Typography key={row.id} variant="body2" color="text.secondary">
                    {displayDate(String(row.createdAt).slice(0, 10))} · {row.resId} · {STATUS_LABELS[row.status] || row.status}
                    {row.status === 'refused' && row.error ? ` (${row.error})` : ''}
                  </Typography>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default forwardRef(SettingsSection);
