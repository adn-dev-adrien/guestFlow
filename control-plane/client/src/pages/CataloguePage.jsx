/**
 * The catalogue editor (specs/control-plane-plans-and-access.md rules 1–6, §6): the plan × plugin
 * matrix, the prices and quotas, the add-ons, and the versions. Each click goes through the server,
 * which applies the nesting or refuses it; saving first shows whom the change affects, and asks for
 * a reason.
 */
import React, { useEffect, useState } from 'react';
import {
  Box, Button, Card, CardContent, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PageActionBar from '@gf/components/PageActionBar';
import FormDialog from '@gf/components/FormDialog';
import LoadingState from '@gf/components/LoadingState';
import ErrorAlert from '@gf/components/ErrorAlert';
import { useToast } from '@gf/components/DialogProvider';
import PlanMatrix from '../components/PlanMatrix';
import api from '../api';

export default function CataloguePage() {
  const { showError, showSuccess } = useToast();
  const [cat, setCat] = useState(null);
  const [error, setError] = useState(null);
  const [lowest, setLowest] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [plans, setPlans] = useState([]);
  const [addons, setAddons] = useState([]);
  const [newAddon, setNewAddon] = useState('');
  const [saving, setSaving] = useState(null);

  function reset(view) {
    setCat(view);
    setLowest(view.lowest);
    setMatrix(view.matrix);
    setPlans(view.plans.map((p) => ({ code: p.code, name: p.name, monthly: p.monthly, yearly: p.yearly, units: p.units, users: p.users })));
    setAddons(view.addons.map((a) => ({ pluginId: a.pluginId, name: a.name, price: a.price })));
  }
  const load = () => { setError(null); api.catalogue().then(reset).catch((err) => setError(err.message)); };
  useEffect(load, []);

  async function toggle(pluginId, planCode) {
    try {
      const r = await api.toggleCell(lowest, pluginId, planCode);
      setLowest(r.lowest);
      setMatrix(r.matrix);
      showSuccess(r.message);
    } catch (err) {
      showError(err.message);
    }
  }

  const body = () => ({
    lowest,
    plans: plans.map((p) => ({ code: p.code, monthly: p.monthly, yearly: p.yearly, units: p.units, users: p.users })),
    addons: addons.map((a) => ({ pluginId: a.pluginId, price: a.price })),
  });

  async function askSave() {
    try {
      const { lines } = await api.catalogueImpact(body());
      setSaving({ lines, reason: '' });
    } catch (err) {
      showError(err.message);
    }
  }

  async function save() {
    try {
      const saved = await api.saveCatalogue({ ...body(), reason: saving.reason });
      reset(saved);
      setSaving(null);
      showSuccess(`Catalogue v${saved.version} enregistré ; licences réémises.`);
    } catch (err) {
      showError(err.message);
    }
  }

  const setPlan = (code, key) => (e) => setPlans((ps) => ps.map((p) => (p.code === code ? { ...p, [key]: e.target.value } : p)));
  const bar = <PageActionBar title="Catalogue" titleOnXs onSave={cat ? askSave : undefined} onCancel={cat ? () => reset(cat) : undefined} cancelTooltip="Revenir au catalogue enregistré" />;
  if (error) return <>{bar}<Box sx={{ p: 2 }}><ErrorAlert message={error} onRetry={load} /></Box></>;
  if (!cat) return <>{bar}<LoadingState /></>;

  const free = cat.addonChoices.filter((c) => !addons.some((a) => a.pluginId === c.pluginId));

  return (
    <>
      {bar}
      <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Typography variant="body2" color="text.secondary">
          Les forfaits sont emboîtés : un plugin ajouté à un forfait est inclus dans ceux du dessus. Cliquez une case pour la modifier ; rien n’est enregistré avant « Enregistrer ».
        </Typography>
        <PlanMatrix plans={cat.plans} matrix={matrix} onToggle={toggle} />

        <Card>
          <CardContent>
            <Typography variant="sectionHeader" component="h2" sx={{ mb: 1 }}>Prix et quotas (HT)</Typography>
            <Stack spacing={2}>
              {plans.map((p) => (
                <Box key={p.code} sx={{ display: 'grid', gap: 1.5, alignItems: 'center', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', md: '120px repeat(4, minmax(0,1fr))' } }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, gridColumn: { xs: '1 / -1', md: 'auto' } }}>{p.name}</Typography>
                  <TextField size="small" label="€ / mois" value={p.monthly} onChange={setPlan(p.code, 'monthly')} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
                  <TextField size="small" label="€ / mois à l’année" value={p.yearly} onChange={setPlan(p.code, 'yearly')} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
                  <TextField size="small" label="Logements" value={p.units} onChange={setPlan(p.code, 'units')} placeholder="illimité" slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
                  <TextField size="small" label="Comptes" value={p.users} onChange={setPlan(p.code, 'users')} placeholder="illimité" slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="sectionHeader" component="h2" sx={{ mb: 1 }}>Options à la carte</Typography>
            <Stack spacing={1.5}>
              {addons.map((a) => (
                <Box key={a.pluginId} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{a.name}</Typography>
                  <TextField size="small" label="€ / mois" value={a.price} sx={{ width: 110 }}
                    onChange={(e) => setAddons((xs) => xs.map((x) => (x.pluginId === a.pluginId ? { ...x, price: e.target.value } : x)))} />
                  <Tooltip title="Retirer l’option">
                    <IconButton aria-label={`Retirer ${a.name}`} onClick={() => setAddons((xs) => xs.filter((x) => x.pluginId !== a.pluginId))} sx={{ width: 44, height: 44 }}>
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))}
              {free.length > 0 && (
                <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField select size="small" label="Ajouter une option" value={newAddon} onChange={(e) => setNewAddon(e.target.value)} sx={{ minWidth: 240 }}>
                    {free.map((c) => <MenuItem key={c.pluginId} value={c.pluginId}>{c.name}</MenuItem>)}
                  </TextField>
                  <Button variant="outlined" disabled={!newAddon} sx={{ minHeight: 40 }}
                    onClick={() => { setAddons((xs) => [...xs, { pluginId: newAddon, name: free.find((c) => c.pluginId === newAddon).name, price: '0' }]); setNewAddon(''); }}>
                    Ajouter
                  </Button>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="sectionHeader" component="h2" sx={{ mb: 1 }}>Versions</Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
              {cat.versions.map((v) => (
                <Typography key={v.version} component="li" variant="body2">v{v.version} — {v.day} — {v.reason} <Typography component="span" variant="caption" color="text.secondary">({v.changedBy})</Typography></Typography>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <FormDialog open={Boolean(saving)} onClose={() => setSaving(null)} title="Enregistrer le catalogue" onSubmit={save}>
        {saving && (
          <Stack spacing={2}>
            {saving.lines.length > 0 ? (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {saving.lines.map((l) => <Typography key={l} component="li" variant="body2" sx={{ mb: 0.5 }}>{l}</Typography>)}
              </Box>
            ) : <Typography variant="body2">Aucun impact sur les clients.</Typography>}
            <TextField label="Motif (obligatoire)" value={saving.reason} onChange={(e) => setSaving((s) => ({ ...s, reason: e.target.value }))} multiline minRows={2} />
          </Stack>
        )}
      </FormDialog>
    </>
  );
}
