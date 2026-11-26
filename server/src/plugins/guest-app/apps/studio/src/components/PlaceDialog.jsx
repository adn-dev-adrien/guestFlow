/**
 * PlaceDialog — add or edit one « Pratique » place (specs/guest-app/guest-app-local-amenities.md rule 16). The dialog only collects: every
 * refusal (position not recognised, more than 15 km away, drive time, what is dropped, energies, hours…) comes from
 * the server as `{ field: message }` and is shown under its field.
 *
 * Props: `open`, `onClose`, `place` (the stored shape to edit, or null to add), `categories` ([{ key, label }]),
 *        `communes` (the three names), `onSave(body)` → resolves with the saved place or rejects with `err.fields`.
 */
import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, FormControl, FormControlLabel, FormGroup, FormHelperText, FormLabel, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import FormDialog from '@guestflow/components/FormDialog';
import RangesEditor from './RangesEditor';
import { WEEKDAYS } from '../constants/studio';

const OTHER = '__other__';
const ACCEPTS = [
  { key: 'om', label: 'Ordures ménagères' }, { key: 'emballages', label: 'Emballages' }, { key: 'verre', label: 'Verre' }, { key: 'papier', label: 'Papier' },
  { key: 'textile', label: 'Textile' }, { key: 'vegetaux', label: 'Végétaux' }, { key: 'encombrants', label: 'Encombrants' },
];
const ENERGIES = [{ key: 'essence', label: 'Essence' }, { key: 'gazole', label: 'Gazole' }, { key: 'recharge', label: 'Recharge électrique' }];

const pad = (n) => String(n).padStart(2, '0');
const toTime = (minutes) => (minutes >= 1440 ? '23:59' : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
const toMinutes = (hhmm) => (hhmm === '23:59' ? 1440 : Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));

/** The editor keeps a week as `{ '0'…'6': [{ from, to }] }` (Sunday = 0), the stored shape being minutes. */
const weekOf = (hours) => Object.fromEntries(WEEKDAYS.map((d) => [d.key, ((hours && hours[Number(d.key)]) || []).map(([from, to]) => ({ from: toTime(from), to: toTime(to) }))]));
const hoursOf = (week) => (Object.values(week).some((ranges) => ranges.length)
  ? Array.from({ length: 7 }, (_, day) => week[String(day)].map(({ from, to }) => [toMinutes(from), toMinutes(to)]))
  : null);

const blankDraft = (communes, category) => ({
  category, nameFr: '', nameEn: '', commune: communes[0], communeOther: '', position: '', driveMinutes: '', wasteKind: 'point', accepts: [], energies: [], phone: '', noteFr: '', noteEn: '', week: weekOf(null), published: true,
});

function draftOf(place, communes) {
  const known = communes.includes(place.commune);
  return {
    category: place.category,
    nameFr: place.nameFr,
    nameEn: place.nameEn || '',
    commune: known ? place.commune : OTHER,
    communeOther: known ? '' : place.commune,
    position: place.position,
    driveMinutes: String(place.driveMinutes),
    wasteKind: place.wasteKind || 'point',
    accepts: place.accepts || [],
    energies: place.energies || [],
    phone: place.phone || '',
    noteFr: place.noteFr || '',
    noteEn: place.noteEn || '',
    week: weekOf(place.hours),
    published: place.published,
  };
}

function bodyOf(d) {
  const waste = d.category === 'dechets';
  const fuel = d.category === 'carburant';
  const drive = d.driveMinutes.trim();
  return {
    category: d.category,
    nameFr: d.nameFr,
    nameEn: d.nameEn || null,
    commune: d.commune === OTHER ? d.communeOther : d.commune,
    position: d.position,
    driveMinutes: drive === '' ? null : Number(drive),
    ...(waste ? { wasteKind: d.wasteKind, accepts: d.accepts } : {}),
    ...(fuel ? { energies: d.energies } : {}),
    phone: d.phone || null,
    noteFr: d.noteFr || null,
    noteEn: d.noteEn || null,
    hours: hoursOf(d.week),
    published: d.published,
  };
}

export default function PlaceDialog({
  open, onClose, place, categories, communes, onSave,
}) {
  const [draft, setDraft] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDraft(place ? draftOf(place, communes) : blankDraft(communes, categories[0].key));
      setFields({});
    }
  }, [open, place]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft) return null;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const err = (name) => ({ error: Boolean(fields[name]), helperText: fields[name] || undefined });
  const toggle = (name, key) => set({ [name]: draft[name].includes(key) ? draft[name].filter((k) => k !== key) : [...draft[name], key] });

  const submit = async () => {
    setBusy(true);
    setFields({});
    try {
      await onSave(bodyOf(draft));
    } catch (e) {
      setFields(e.fields || { _: e.message });
    } finally {
      setBusy(false);
    }
  };

  const copyMonday = () => setDraft((d) => ({ ...d, week: Object.fromEntries(WEEKDAYS.map((w) => [w.key, d.week['1'].map((r) => ({ ...r }))])) }));

  return (
    <FormDialog open={open} onClose={onClose} title={place ? 'Modifier le lieu' : 'Ajouter un lieu'} onSubmit={submit} submitBusy={busy} maxWidth="md" sheet>
      <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
        {fields._ ? <Alert severity="error">{fields._}</Alert> : null}
        <TextField select label="Catégorie" value={draft.category} onChange={(e) => set({ category: e.target.value })} {...err('category')}>
          {categories.map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
        </TextField>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField label="Nom" required value={draft.nameFr} onChange={(e) => set({ nameFr: e.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} {...err('nameFr')} />
          <TextField label="Nom en anglais" value={draft.nameEn} onChange={(e) => set({ nameEn: e.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} {...(fields.nameEn ? err('nameEn') : { helperText: 'Sans nom anglais, le nom français est affiché.' })} />
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField select label="Commune" value={draft.commune} onChange={(e) => set({ commune: e.target.value })} {...err('commune')}>
            {communes.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            <MenuItem value={OTHER}>Autre</MenuItem>
          </TextField>
          {draft.commune === OTHER ? <TextField label="Nom de la commune" required value={draft.communeOther} onChange={(e) => set({ communeOther: e.target.value })} slotProps={{ htmlInput: { maxLength: 60 } }} /> : null}
        </Box>
        <TextField
          label="Position"
          required
          value={draft.position}
          onChange={(e) => set({ position: e.target.value })}
          placeholder="45.1502, 4.6151"
          {...(fields.position ? err('position') : { helperText: 'Collez « 45.1502, 4.6151 » ou un lien Google Maps qui contient les coordonnées.' })}
        />
        <TextField
          label="Temps en voiture depuis le domaine (minutes)"
          required
          type="number"
          value={draft.driveMinutes}
          onChange={(e) => set({ driveMinutes: e.target.value })}
          slotProps={{ htmlInput: { min: 1, max: 60, inputMode: 'numeric' } }}
          {...err('driveMinutes')}
        />

        {draft.category === 'dechets' ? (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <ToggleButtonGroup exclusive fullWidth value={draft.wasteKind} onChange={(e, next) => next && set({ wasteKind: next })} aria-label="Type de lieu de dépôt">
              <ToggleButton value="point" sx={{ minHeight: 44, textTransform: 'none' }}>Point de collecte</ToggleButton>
              <ToggleButton value="decheterie" sx={{ minHeight: 44, textTransform: 'none' }}>Déchèterie</ToggleButton>
            </ToggleButtonGroup>
            <FormControl error={Boolean(fields.accepts)}>
              <FormLabel>Ce qu’on peut y déposer</FormLabel>
              <FormGroup row>
                {ACCEPTS.map((a) => <FormControlLabel key={a.key} control={<Checkbox checked={draft.accepts.includes(a.key)} onChange={() => toggle('accepts', a.key)} />} label={a.label} />)}
              </FormGroup>
              {fields.accepts ? <FormHelperText>{fields.accepts}</FormHelperText> : null}
            </FormControl>
          </Box>
        ) : null}
        {draft.category === 'carburant' ? (
          <FormControl error={Boolean(fields.energies)}>
            <FormLabel>Énergies proposées</FormLabel>
            <FormGroup row>
              {ENERGIES.map((a) => <FormControlLabel key={a.key} control={<Checkbox checked={draft.energies.includes(a.key)} onChange={() => toggle('energies', a.key)} />} label={a.label} />)}
            </FormGroup>
            {fields.energies ? <FormHelperText>{fields.energies}</FormHelperText> : null}
          </FormControl>
        ) : null}

        <TextField label="Téléphone" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="04 75 12 34 56" slotProps={{ htmlInput: { inputMode: 'tel' } }} {...err('phone')} />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField label="Note" multiline minRows={2} value={draft.noteFr} onChange={(e) => set({ noteFr: e.target.value })} slotProps={{ htmlInput: { maxLength: 280 } }} {...err('noteFr')} />
          <TextField label="Note en anglais" multiline minRows={2} value={draft.noteEn} onChange={(e) => set({ noteEn: e.target.value })} slotProps={{ htmlInput: { maxLength: 280 } }} {...err('noteEn')} />
        </Box>

        <Box role="group" aria-label="Horaires" sx={{ display: 'grid', gap: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 600 }}>Horaires</Typography>
            <Button onClick={copyMonday} sx={{ minHeight: 44 }}>Copier le lundi sur la semaine</Button>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Deux plages au plus par jour. Sans horaires, la fiche dit « Horaires non renseignés » et n’affirme jamais que le lieu est ouvert.</Typography>
          {fields.hours ? <Alert severity="error">{fields.hours}</Alert> : null}
          {WEEKDAYS.map((d) => (
            <Box key={d.key} role="group" aria-label={d.label} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '110px 1fr' }, gap: 1, py: 1, borderBottom: 1, borderColor: 'divider', alignItems: 'start' }}>
              <Typography sx={{ fontWeight: 600, pt: { sm: 1.25 } }}>{d.label}</Typography>
              <Box>
                <RangesEditor ranges={draft.week[d.key]} label={d.label} max={2} onChange={(ranges) => set({ week: { ...draft.week, [d.key]: ranges } })} />
                {!draft.week[d.key].length ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>Fermé.</Typography> : null}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </FormDialog>
  );
}
