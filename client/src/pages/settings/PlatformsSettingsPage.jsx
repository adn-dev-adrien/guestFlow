/**
 * PlatformsSettingsPage — Paramètres → Plateformes (specs/settings-rationalization.md rule 17).
 *
 * Every per-platform commercial setting in one place: colour, commission %, « takes an acompte »,
 * who collects the tourist tax, payout delay. They apply to every property, so the property page
 * only shows them read-only. The accounting columns stay on Plan comptable (rule 20).
 *
 * The second table, « E-mails aux voyageurs », holds what the guest e-mails need to know of a platform:
 * whether it relays the guest's address, and where its guests leave a review
 * (specs/platform-settings-relay-and-review.md rules 1-5). An own channel has neither.
 *
 * A value that does not apply to a channel arrives as null from the server (`direct` has no
 * deposit / tax / payout notion, an own channel no payout) and is shown as « — ».
 * Desktop: one table. Mobile: one card per platform.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert, Box, Card, CardContent, FormControlLabel, MenuItem, Stack, Switch, Table, TableContainer, TableBody, TableCell, TableHead,
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
import Slot from '../../plugins/sdk/Slot';

// How long a refused colour's message stays under its swatch once the swatch is back to the saved colour.
const COLOR_REFUSAL_MS = 6000;

const TAX_OPTIONS = [
  { value: 'platform', label: 'Plateforme → commune' },
  { value: 'platform_reversed', label: 'Plateforme → établissement' },
  { value: 'owner', label: "À l'arrivée" },
];
const EDITABLE = [
  'color', 'commissionPercent', 'takesDeposit', 'touristTaxCollection', 'payoutDueDays', 'countsAsDirect', 'forbidsGuestChores',
  'relaysGuestEmail', 'reviewWhereFr', 'reviewWhereEn',
];

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
  // Cards below 1280 px: with the side menu open the seven columns need ~915 px of content, which a
  // 1200 px window does not leave (2026-10-27 spec review). From 1280 px the table shows every column.
  const isMobile = useMediaQuery(theme.breakpoints.down(1280));
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
        // A refused colour goes back to the saved one (specs/calendar-property-parity.md rule 7).
        setDraft((rows) => rows.map((row) => {
          if (!(err.errors[String(row.id)] || {}).color) return row;
          const previous = saved.find((p) => p.id === row.id);
          return previous ? { ...row, color: previous.color } : row;
        }));
        // The message stays long enough to be read, then goes with the colour it was about.
        window.setTimeout(() => setErrors((prev) => Object.fromEntries(Object.entries(prev).map(([id, fields]) => {
          const { color: _gone, ...rest } = fields;
          return [id, rest];
        }))), COLOR_REFUSAL_MS);
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
    <PlatformColorPicker color={p.color} onChange={(hex) => setField(p.id, 'color', hex)} disabled={saving} error={fieldError(p.id, 'color')} />
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
      sx={{ width: { xs: '100%', lg: 76 } }}
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
      sx={{ minWidth: 84 }}
    >
      <MenuItem value={0}>Non</MenuItem>
      <MenuItem value={1}>Oui</MenuItem>
    </TextField>
  ));
  // specs/plugins-phase-p-productisation.md rule 19 — always on, and locked, for `direct`.
  const directCell = (p) => (
    <Switch
      checked={Boolean(p.countsAsDirect)}
      onChange={(e) => setField(p.id, 'countsAsDirect', e.target.checked)}
      disabled={saving || p.isDirect}
      slotProps={{ input: { 'aria-label': `Compté comme vente directe ${formatPlatformLabel(p.name)}` } }}
    />
  );
  // specs/airbnb-no-checkout-chores.md rule 8 — a platform rule, so an own channel has none.
  const choresCell = (p) => (p.forbidsGuestChores === null ? '—' : (
    <Switch
      checked={Boolean(p.forbidsGuestChores)}
      onChange={(e) => setField(p.id, 'forbidsGuestChores', e.target.checked)}
      disabled={saving}
      slotProps={{ input: { 'aria-label': `Sans corvées de départ ${formatPlatformLabel(p.name)}` } }}
    />
  ));
  // specs/platform-settings-relay-and-review.md rules 1-5 — what the guest e-mails need to know.
  const relayCell = (p) => (p.relaysGuestEmail === null ? '—' : (
    <Switch
      checked={Boolean(p.relaysGuestEmail)}
      onChange={(e) => setField(p.id, 'relaysGuestEmail', e.target.checked)}
      disabled={saving}
      slotProps={{ input: { 'aria-label': `Adresse e-mail relais ${formatPlatformLabel(p.name)}` } }}
    />
  ));
  const reviewCell = (p, lang) => {
    const key = lang === 'en' ? 'reviewWhereEn' : 'reviewWhereFr';
    if (p[key] === null) return '—';
    return (
      <TextField
        value={p[key]}
        onChange={(e) => setField(p.id, key, e.target.value)}
        size="small"
        fullWidth
        disabled={saving}
        placeholder={lang === 'en' ? (p.reviewWhereFr || formatPlatformLabel(p.name)) : formatPlatformLabel(p.name)}
        error={Boolean(fieldError(p.id, key))}
        helperText={fieldError(p.id, key) || ''}
        slotProps={{ htmlInput: { maxLength: 80, 'aria-label': `Où laisser un avis${lang === 'en' ? ' (anglais)' : ''} ${formatPlatformLabel(p.name)}` } }}
      />
    );
  };
  const contactRows = rows.filter((p) => p.relaysGuestEmail != null);

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
      sx={{ width: { xs: '100%', lg: 68 } }}
    />
  ));

  return (
    <Box>
      <PageActionBar
        title="Plateformes"
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
          que ses calendriers.
          <Slot name="settings.platforms.links" page="platforms" />
        </Alert>
        {!draft && !loadError && <LoadingState label="Chargement des plateformes…" />}
        {draft && !isMobile && (
          <Card variant="outlined">
            {/* Every column fits from 1200 px with the side menu open (2026-10-27 spec review): the colour
                sits beside the name, headers never wrap, cells are compact. Scroll-contained all the same. */}
            <TableContainer>
              <Table
                size="small"
                sx={{
                  '& .MuiTableCell-root': { px: 0.75 },
                  '& .MuiTableCell-root:first-of-type': { pl: 2 },
                  '& .MuiTableCell-root:last-of-type': { pr: 2 },
                  '& .MuiTableCell-head': { whiteSpace: 'nowrap' },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Plateforme</TableCell>
                    <TableCell>Commission %</TableCell>
                    <TableCell>Acompte</TableCell>
                    <TableCell sx={{ width: 220 }}>Taxe de séjour</TableCell>
                    <TableCell>Virement (j)</TableCell>
                    <TableCell>Vente directe</TableCell>
                    <TableCell>Sans corvées</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {colorCell(p)}
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatPlatformLabel(p.name)}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>{commissionCell(p)}</TableCell>
                      <TableCell>{depositCell(p)}</TableCell>
                      <TableCell>{taxCell(p)}</TableCell>
                      <TableCell>{payoutCell(p)}</TableCell>
                      <TableCell>{directCell(p)}</TableCell>
                      <TableCell>{choresCell(p)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        )}
        {draft && !isMobile && contactRows.length > 0 && (
          <Card variant="outlined" sx={{ mt: 3 }}>
            <CardContent sx={{ pb: 0 }}>
              <Typography variant="sectionHeader" component="h2">E-mails aux voyageurs</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Adresse relais : aucun mail après le séjour. Avis : la fin de « quelques mots sur … » dans le
                mail du lendemain du départ ; vide, le nom de la plateforme.
              </Typography>
            </CardContent>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Plateforme</TableCell>
                    <TableCell>Adresse e-mail relais</TableCell>
                    <TableCell sx={{ minWidth: 240 }}>Où laisser un avis</TableCell>
                    <TableCell sx={{ minWidth: 240 }}>En anglais</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {contactRows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell sx={{ fontWeight: 600 }}>{formatPlatformLabel(p.name)}</TableCell>
                      <TableCell>{relayCell(p)}</TableCell>
                      <TableCell>{reviewCell(p, 'fr')}</TableCell>
                      <TableCell>{reviewCell(p, 'en')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Commission (%)</Typography>
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
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Taxe de séjour</Typography>
                    {taxCell(p)}
                  </Box>
                )}
                {p.payoutDueDays !== null && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Virement (jours après le départ)</Typography>
                    {payoutCell(p)}
                  </Box>
                )}
                <FormControlLabel control={directCell(p)} label="Compté comme vente directe" sx={{ minHeight: 44 }} />
                {p.forbidsGuestChores !== null && (
                  <FormControlLabel control={choresCell(p)} label="Sans corvées de départ" sx={{ minHeight: 44 }} />
                )}
                {p.relaysGuestEmail != null && (
                  <>
                    <FormControlLabel control={relayCell(p)} label="Adresse e-mail relais" sx={{ minHeight: 44 }} />
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Où laisser un avis</Typography>
                      {reviewCell(p, 'fr')}
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Où laisser un avis, en anglais</Typography>
                      {reviewCell(p, 'en')}
                    </Box>
                  </>
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
        message="Des modifications ne sont pas enregistrées. Quitter sans enregistrer ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="error"
      />
    </Box>
  );
}

export const __test = { changedRows, toDraft };
