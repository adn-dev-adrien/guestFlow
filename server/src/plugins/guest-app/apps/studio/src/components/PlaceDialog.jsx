/**
 * PlaceDialog — add or edit one « Pratique » place (specs/guest-app/guest-app-local-amenities.md rule 16). The dialog only collects: every
 * refusal (position not recognised, more than 15 km away, drive time, what is dropped, energies, hours…) comes from
 * the server as `{ field: message }` and is shown under its field.
 *
 * Props: `open`, `onClose`, `place` (the stored shape to edit, or null to add), `categories`, `wasteKinds`, `accepts`,
 *        `energies` (the closed sets as the server lists them, [{ key, label }]), `communes` (the three names), `onSave(body)` → resolves with the saved place or rejects with `err.fields`.
 */
import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, FormControl, FormControlLabel, FormGroup, FormHelperText, FormLabel, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import FormDialog from '@guestflow/components/FormDialog';
import RangesEditor from './RangesEditor';
import { WEEKDAYS } from '../constants/studio';

const OTHER = '__other__';

const pad = (n) => String(n).padStart(2, '0');
// 1440 is midnight and is written « 24:00 »; 23:59 is an ordinary minute and stays 1439.
const END_OF_DAY = '24:00';
const toTime = (minutes) => (minutes >= 1440 ? END_OF_DAY : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
const toMinutes = (hhmm) => (hhmm === END_OF_DAY ? 1440 : Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));

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
  open, onClose, place, categories, wasteKinds, accepts, energies, communes, onSave,
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

  // Sunday (key 0) is its own day, often closed: the copy goes from Tuesday to Saturday.
  const copyMonday = () => setDraft((d) => ({
    ...d,
    week: Object.fromEntries(WEEKDAYS.map((w) => [w.key, w.key === '0' ? d.week[w.key] : d.week['1'].map((r) => ({ ...r }))])),
  }));

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
              {wasteKinds.map((k) => <ToggleButton key={k.key} value={k.key} sx={{ minHeight: 44, textTransform: 'none' }}>{k.label}</ToggleButton>)}
            </ToggleButtonGroup>
            <FormControl error={Boolean(fields.accepts)}>
              <FormLabel>Ce qu’on peut y déposer</FormLabel>
              <FormGroup row>
                {accepts.map((a) => <FormControlLabel key={a.key} control={<Checkbox checked={draft.accepts.includes(a.key)} onChange={() => toggle('accepts', a.key)} />} label={a.label} />)}
              </FormGroup>
              {fields.accepts ? <FormHelperText>{fields.accepts}</FormHelperText> : null}
            </FormControl>
          </Box>
        ) : null}
        {draft.category === 'carburant' ? (
          <FormControl error={Boolean(fields.energies)}>
            <FormLabel>Énergies proposées</FormLabel>
            <FormGroup row>
              {energies.map((a) => <FormControlLabel key={a.key} control={<Checkbox checked={draft.energies.includes(a.key)} onChange={() => toggle('energies', a.key)} />} label={a.label} />)}
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
            <Button onClick={copyMonday} sx={{ minHeight: 44 }}>Copier le lundi du mardi au samedi</Button>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Deux plages au plus par jour. Sans horaires, la fiche dit « Horaires non renseignés » et n’affirme jamais que le lieu est ouvert.</Typography>
          {fields.hours ? <Alert severity="error">{fields.hours}</Alert> : null}
          {WEEKDAYS.map((d) => (
            <Box key={d.key} role="group" aria-label={d.label} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '110px 1fr' }, gap: 1, py: 1, borderBottom: 1, borderColor: 'divider', alignItems: 'start' }}>
              <Typography sx={{ fontWeight: 600, pt: { sm: 1.25 } }}>{d.label}</Typography>
              <Box>
                <RangesEditor ranges={draft.week[d.key]} label={d.label} max={2} endOfDay={END_OF_DAY} onChange={(ranges) => set({ week: { ...draft.week, [d.key]: ranges } })} />
                {!draft.week[d.key].length ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>Fermé.</Typography> : null}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </FormDialog>
  );
}
