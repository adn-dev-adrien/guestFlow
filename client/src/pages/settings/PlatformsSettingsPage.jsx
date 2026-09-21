/**
 * PlatformsSettingsPage — Paramètres → Plateformes (specs/settings-rationalization.md rule 17).
 *
 * Every per-platform commercial setting in one place: colour, commission %, « takes an acompte »,
 * who collects the tourist tax, payout delay. They apply to every property, so the property page
 * only shows them read-only. The accounting columns stay on Plan comptable (rule 20).
 *
 * A value that does not apply to a channel arrives as null from the server (`direct` has no
 * deposit / tax / payout notion, an own channel no payout) and is shown as « — ».
 * Desktop: one table. Mobile: one card per platform.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import {
  Alert, Box, Card, CardContent, Link, MenuItem, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import api from '../../api';
import PageActionBar from '../../components/PageActionBar';
import ErrorAlert from '../../components/ErrorAlert';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingState from '../../components/LoadingState';
import PlatformColorPicker from '../../components/PlatformColorPicker';
import { useToast } from '../../components/DialogProvider';
import useDirtyFormGuard from '../../hooks/useDirtyFormGuard';
import { formatPlatformLabel } from '../../constants/platforms';

const TAX_OPTIONS = [
  { value: 'platform', label: 'Plateforme → commune' },
  { value: 'platform_reversed', label: 'Plateforme → vous' },
  { value: 'owner', label: "À l'arrivée" },
];
const EDITABLE = ['color', 'commissionPercent', 'takesDeposit', 'touristTaxCollection', 'payoutDueDays'];

// The rows as the form edits them: numbers become strings so a half-typed value stays as typed.
function toDraft(platforms) {
  return platforms.map((p) => ({
    ...p,
    commissionPercent: String(p.commissionPercent ?? ''),
    payoutDueDays: p.payoutDueDays == null ? null : String(p.payoutDueDays),
  }));
}

// Only the fields that changed, per row that changed — the server validates everything.
function changedRows(draft, saved) {
  const byId = new Map(saved.map((p) => [p.id, p]));
  return draft.map((row) => {
    const before = byId.get(row.id) || {};
    const change = { id: row.id };
    for (const key of EDITABLE) {
      if (row[key] !== null && row[key] !== before[key]) change[key] = row[key];
    }
    return change;
  }).filter((change) => Object.keys(change).length > 1);
}

export default function PlatformsSettingsPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { showSuccess, showError } = useToast();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const { platforms } = await api.getPlatformSettings();
      const rows = toDraft(platforms || []);
      setSaved(rows);
      setDraft(rows);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { isDirty, guardDialogOpen, dismissGuard, confirmLeave } = useDirtyFormGuard({
    draft: draft || [], saved: saved || [], navigate,
  });

  const setField = (id, key, value) => {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    setErrors((prev) => {
      if (!prev[id] || !prev[id][key]) return prev;
      const next = { ...prev, [id]: { ...prev[id] } };
      delete next[id][key];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setErrors({});
    try {
      const { platforms } = await api.savePlatformSettings(changedRows(draft, saved));
      const rows = toDraft(platforms || []);
      setSaved(rows);
      setDraft(rows);
      showSuccess('Plateformes enregistrées.');
    } catch (err) {
      if (err && err.errors) {
        setErrors(err.errors);
        showError('Enregistrement refusé : corrigez les champs en rouge.');
      } else {
        showError((err && err.message) || "Impossible d'enregistrer les plateformes.");
      }
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => draft || [], [draft]);
  const fieldError = (id, key) => (errors[String(id)] || {})[key];

  const colorCell = (p) => (
    <PlatformColorPicker color={p.color} onChange={(hex) => setField(p.id, 'color', hex)} disabled={saving} />
  );
  const commissionCell = (p) => (
    <TextField
      value={p.commissionPercent}
      onChange={(e) => setField(p.id, 'commissionPercent', e.target.value)}
      size="small"
      disabled={saving}
      error={Boolean(fieldError(p.id, 'commissionPercent'))}
      helperText={fieldError(p.id, 'commissionPercent') || ''}
      slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': `Commission ${formatPlatformLabel(p.name)}` } }}
      sx={{ width: { xs: '100%', md: 110 } }}
    />
  );
  const depositCell = (p) => (p.takesDeposit === null ? '—' : (
    <TextField
      select
      value={p.takesDeposit ? 1 : 0}
      onChange={(e) => setField(p.id, 'takesDeposit', Number(e.target.value) === 1)}
      size="small"
      disabled={saving}
      slotProps={{ htmlInput: { 'aria-label': `Acompte ${formatPlatformLabel(p.name)}` } }}
      sx={{ minWidth: 90 }}
    >
      <MenuItem value={0}>Non</MenuItem>
      <MenuItem value={1}>Oui</MenuItem>
    </TextField>
  ));
  const taxCell = (p) => (p.touristTaxCollection === null ? '—' : (
    <TextField
      select
      value={p.touristTaxCollection}
      onChange={(e) => setField(p.id, 'touristTaxCollection', e.target.value)}
      size="small"
      disabled={saving}
      fullWidth
      slotProps={{ htmlInput: { 'aria-label': `Taxe de séjour ${formatPlatformLabel(p.name)}` } }}
    >
      {TAX_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
    </TextField>
  ));
  const payoutCell = (p) => (p.payoutDueDays === null ? '—' : (
    <TextField
      value={p.payoutDueDays}
      onChange={(e) => setField(p.id, 'payoutDueDays', e.target.value)}
      size="small"
      disabled={saving}
      error={Boolean(fieldError(p.id, 'payoutDueDays'))}
      helperText={fieldError(p.id, 'payoutDueDays') || ''}
      slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `Virement ${formatPlatformLabel(p.name)}` } }}
      sx={{ width: { xs: '100%', md: 90 } }}
    />
  ));

  return (
    <Box>
      <PageActionBar
        title="Plateformes"
        titleOnXs
        onSave={handleSave}
        saveDisabled={!isDirty || saving || !draft}
        saveBusy={saving}
        onCancel={() => { setDraft(saved); setErrors({}); }}
        cancelDisabled={!isDirty || saving}
      />
      <Box sx={{ maxWidth: 1040, mx: 'auto', p: { xs: 1.5, sm: 3 } }}>
        {loadError && <ErrorAlert message="Impossible de charger les plateformes." onRetry={load} sx={{ mb: 2 }} />}
        <Alert severity="info" sx={{ mb: 2 }}>
          Ces réglages valent pour <strong>tous</strong> les logements : chaque fiche logement ne garde
          que ses calendriers. Les comptes comptables se règlent dans le{' '}
          <Link component={RouterLink} to="/comptabilite/plateformes">Plan comptable</Link>.
        </Alert>
        {!draft && !loadError && <LoadingState label="Chargement des plateformes…" />}
        {draft && !isMobile && (
          <Card variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Plateforme</TableCell>
                  <TableCell>Couleur</TableCell>
                  <TableCell>Commission (%)</TableCell>
                  <TableCell>Acompte</TableCell>
                  <TableCell sx={{ minWidth: 200 }}>Taxe de séjour</TableCell>
                  <TableCell>Virement (jours)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{formatPlatformLabel(p.name)}</TableCell>
                    <TableCell>{colorCell(p)}</TableCell>
                    <TableCell>{commissionCell(p)}</TableCell>
                    <TableCell>{depositCell(p)}</TableCell>
                    <TableCell>{taxCell(p)}</TableCell>
                    <TableCell>{payoutCell(p)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        {draft && isMobile && rows.map((p) => (
          <Card key={p.id} variant="outlined" sx={{ mb: 1.5 }}>
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {colorCell(p)}
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{formatPlatformLabel(p.name)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Commission (%)</Typography>
                  {commissionCell(p)}
                </Box>
                {p.takesDeposit !== null && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Acompte</Typography>
                    {depositCell(p)}
                  </Box>
                )}
                {p.touristTaxCollection !== null && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Taxe de séjour</Typography>
                    {taxCell(p)}
                  </Box>
                )}
                {p.payoutDueDays !== null && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Virement (jours après le départ)</Typography>
                    {payoutCell(p)}
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Box>
      <ConfirmDialog
        open={guardDialogOpen}
        onClose={dismissGuard}
        onConfirm={confirmLeave}
        title="Modifications non enregistrées"
        message="Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="error"
      />
    </Box>
  );
}

export const __test = { changedRows, toDraft };
