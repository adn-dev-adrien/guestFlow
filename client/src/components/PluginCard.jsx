/**
 * PluginCard — one plugin on the Plugins page (specs/plugins-phase-0-foundation.md rules 22–23;
 * specs/plugins-phase-1-sdk.md rules 4 and 21–22; specs/control-plane-plans-and-access.md rules 11–12).
 * Feature-specific: only the Plugins page lists plugins.
 *
 * Props:
 *   plugin    { id, name, description, icon, surfaces, state, blocker, erasable, data, outOfPlan,
 *             planChip, planHint } as GET /api/plugins returns it — `data` lists what an erasure
 *             would take, a line with `warning: true` being shown apart, before the choice; `outOfPlan` marks a plugin the subscription does not include, `planChip`
 *             names the plan that does and `planHint` says how to get it
 *             — and since specs/plugins-phase-4-registry.md: `version`, `update` ({ version,
 *             changelog, refusal } | null), `offer` ({ version, requirements, refusal } for an available
 *             plugin), `incompatible` ({ message, compatibleVersion } | null), `rollback` ({ version,
 *             label } | null)
 *   busy      boolean   an action on this card is running
 *   error     string?   refusal or failure message, shown in red under the card
 *   bundleFailed boolean the browser could not load this plugin's bundle (rule 18)
 *   onAction  (action: 'install'|'activate'|'deactivate'|'uninstall'|'update'|'rollback',
 *             options?: { purge, withRequirements, version }) => void
 *   onOpenUpdate () => void  the « Mise à jour x.y.z » chip: opens the update dialog (rule 20)
 *   onOpenSettings (path) => void  the « Configurer » / « Réglages » button: opens the place the
 *             server names in `plugin.setup` ({ needed, label, path, action }) —
 *             specs/plugins-phase-0-foundation.md rule 25. « Désactiver » lives in the ⋯ menu, with
 *             a confirmation; when the server refuses it (`blocker`) the menu item says why.
 */
import React, { useState } from 'react';
import {
  Box, Button, Card, CardActionArea, Checkbox, Chip, Collapse, FormControlLabel, IconButton, ListItemText, Menu, MenuItem, Stack, Typography,
} from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import HotTubIcon from '@mui/icons-material/HotTub';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import LanguageIcon from '@mui/icons-material/Language';
import KeyIcon from '@mui/icons-material/Key';
import UmbrellaIcon from '@mui/icons-material/Umbrella';
import PaymentsIcon from '@mui/icons-material/Payments';
import EventIcon from '@mui/icons-material/Event';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SchoolIcon from '@mui/icons-material/School';
import ThunderstormIcon from '@mui/icons-material/Thunderstorm';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import ExtensionIcon from '@mui/icons-material/Extension';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import StatusBadge from './StatusBadge';
import ConfirmDialog from './ConfirmDialog';

const ICONS = {
  'hot-tub': HotTubIcon,
  laundry: LocalLaundryServiceIcon,
  language: LanguageIcon,
  key: KeyIcon,
  umbrella: UmbrellaIcon,
  payments: PaymentsIcon,
  event: EventIcon,
  book: MenuBookIcon,
  door: MeetingRoomIcon,
  'trending-up': TrendingUpIcon,
  school: SchoolIcon,
  thunderstorm: ThunderstormIcon,
  mail: MarkEmailReadIcon,
  bookmark: BookmarkIcon,
};

export default function PluginCard({
  plugin, busy = false, error = null, bundleFailed = false, onAction, onOpenUpdate, onOpenSettings = () => {},
}) {
  const [open, setOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [armed, setArmed] = useState(false);
  const [erase, setErase] = useState(false);
  const [confirmRequirements, setConfirmRequirements] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const Icon = ICONS[plugin.icon] || ExtensionIcon;
  const installed = plugin.state !== 'available';
  const failed = plugin.state === 'failed' || (installed && bundleFailed);
  const incompatible = plugin.state === 'incompatible';
  const offer = plugin.offer || null;
  const requirements = (offer && offer.requirements) || [];
  const offerRefusal = !installed && offer && offer.refusal ? offer.refusal.message : null;
  const update = plugin.update && !incompatible ? plugin.update : null;
  const outOfPlan = Boolean(plugin.outOfPlan);
  const eraseLines = (plugin.data || []).filter((line) => !line.warning).map((line) => line.label).join(' · ');
  // specs/plugins-phase-3b-neat.md rule 18 — what an erasure cannot undo elsewhere (Neat: subscriptions
  // that stay in force at Neat), said before the operator chooses.
  const eraseWarnings = (plugin.data || []).filter((line) => line.warning);

  // Rule 8: a refusal is said before the click, and the buttons it would refuse are disabled.
  const blocked = Boolean(plugin.blocker);
  const active = plugin.state === 'active' && !failed && !incompatible;
  const setup = plugin.setup || {};
  // Rule 25 — an active plugin's useful action is its settings; switching it off waits in ⋯.
  const primary = failed || incompatible || plugin.state === 'active' ? null : plugin.state === 'available'
    ? { action: 'install', label: 'Installer', variant: 'contained' }
    : { action: 'activate', label: 'Activer', variant: 'contained' };

  const act = (action, options) => {
    setArmed(false);
    setErase(false);
    onAction(action, options);
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ p: 1.5, alignItems: { sm: 'center' } }}>
        <CardActionArea
          onClick={() => { setOpen((v) => !v); setArmed(false); }}
          aria-expanded={open}
          sx={{ flex: 1, minWidth: 0, borderRadius: 1, p: 0.5, display: 'flex', gap: 1.5, alignItems: 'center', justifyContent: 'flex-start' }}
        >
          <Box sx={(t) => ({
            flex: 'none', width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center',
            bgcolor: t.palette.primary.soft || t.palette.action.hover, color: 'primary.main',
          })}
          >
            <Icon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{plugin.name}</Typography>
              {plugin.version && <Typography variant="caption" color="text.secondary">{plugin.version}</Typography>}
            </Box>
            <Typography variant="body2" color="text.secondary">{plugin.description}</Typography>
            {installed && outOfPlan && (
              <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <StatusBadge status="warning" label="Désactivé — hors forfait" />
                <Typography variant="caption" color="text.secondary">Données conservées</Typography>
              </Box>
            )}
            {installed && !outOfPlan && (
              <Box sx={{ mt: 0.5 }}>
                <StatusBadge
                  status={failed || incompatible ? 'error' : active ? (setup.needed ? 'warning' : 'success') : 'neutral'}
                  label={incompatible ? 'Incompatible avec cette version' : failed ? 'Erreur' : active ? setup.label || 'Actif' : 'Inactif'}
                />
              </Box>
            )}
            {!installed && outOfPlan && plugin.planChip && (
              <Chip size="small" label={plugin.planChip} sx={{ mt: 0.5, fontWeight: 700 }} />
            )}
            {failed && (
              <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                {bundleFailed && plugin.state !== 'failed' ? 'Échec du chargement.' : 'Échec du démarrage.'}
              </Typography>
            )}
            {incompatible && plugin.incompatible && plugin.incompatible.message !== 'Incompatible avec cette version.' && (
              <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>{plugin.incompatible.message}</Typography>
            )}
            {offerRefusal && !outOfPlan && (
              <Typography variant="body2" color="warning.dark" sx={{ mt: 0.5 }}>{offerRefusal}</Typography>
            )}
            {!installed && !outOfPlan && requirements.length > 0 && !offerRefusal && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Nécessite : {requirements.map((r) => r.name).join(', ')}
              </Typography>
            )}
            {!installed && outOfPlan && plugin.planHint && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{plugin.planHint}</Typography>
            )}
          </Box>
        </CardActionArea>
        {!installed && outOfPlan && (
          <Button variant="contained" disabled sx={{ minHeight: 44, flex: 'none', width: { xs: '100%', sm: 'auto' } }}>Installer</Button>
        )}
        {incompatible && plugin.incompatible && plugin.incompatible.compatibleVersion && !outOfPlan && (
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => act('update', { version: plugin.incompatible.compatibleVersion })}
            sx={{ minHeight: 44, flex: 'none', width: { xs: '100%', sm: 'auto' } }}
          >
            {`Installer la version ${plugin.incompatible.compatibleVersion}`}
          </Button>
        )}
        {!outOfPlan && active && (
          <Stack direction="row" spacing={1} sx={{ flex: 'none', alignItems: 'center', justifyContent: 'flex-end', width: { xs: '100%', sm: 'auto' } }}>
            {setup.action && setup.path && (
              <Button
                variant={setup.needed ? 'contained' : 'outlined'}
                onClick={() => onOpenSettings(setup.path)}
                sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }}
              >
                {setup.action}
              </Button>
            )}
            <IconButton
              aria-label={`Plus d’actions : ${plugin.name}`}
              aria-haspopup="menu"
              aria-expanded={Boolean(menuAnchor)}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              disabled={busy}
              sx={{ minWidth: 44, minHeight: 44, border: 1, borderColor: 'divider' }}
            >
              <MoreHorizIcon />
            </IconButton>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              <MenuItem
                disabled={blocked}
                onClick={() => { setMenuAnchor(null); setConfirmOff(true); }}
                sx={{ minHeight: 44, color: 'error.main', whiteSpace: 'normal', maxWidth: 320 }}
              >
                <ListItemText
                  primary="Désactiver…"
                  secondary={blocked ? plugin.blocker.message : null}
                  slotProps={{ secondary: { sx: { color: 'warning.dark', opacity: 1 } } }}
                />
              </MenuItem>
            </Menu>
          </Stack>
        )}
        {!outOfPlan && primary && (
          <Button
            variant={primary.variant}
            disabled={busy || (primary.action === 'deactivate' && blocked) || (primary.action === 'install' && Boolean(offerRefusal))}
            onClick={() => (primary.action === 'install' && requirements.length ? setConfirmRequirements(true) : act(primary.action))}
            sx={{ minHeight: 44, flex: 'none', width: { xs: '100%', sm: 'auto' } }}
          >
            {primary.label}
          </Button>
        )}
      </Stack>
      {update && !outOfPlan && (
        <Box sx={{ px: 1.5, pb: 1.5, mt: -0.5, pl: { sm: 8.5 } }}>
          <Chip
            color="primary"
            icon={<SystemUpdateAltIcon />}
            label={`Mise à jour ${update.version}`}
            onClick={onOpenUpdate}
            disabled={busy}
            sx={{ minHeight: 36, fontWeight: 700 }}
          />
        </Box>
      )}
      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => { setConfirmOff(false); act('deactivate'); }}
        title={`Désactiver ${plugin.name} ?`}
        message="Ce qu’il ajoute s’arrête. Ses réglages et ses données sont gardés : le réactiver remet tout en place."
        confirmLabel="Désactiver"
        cancelLabel="Garder"
        confirmColor="error"
      />
      {plugin.rollback && (
        <ConfirmDialog
          open={confirmRollback}
          onClose={() => setConfirmRollback(false)}
          onConfirm={() => { setConfirmRollback(false); act('rollback'); }}
          title={`Revenir à ${plugin.name} ${plugin.rollback.version}`}
          message="GuestFlow redémarre."
          confirmLabel="Revenir"
          confirmColor="primary"
        />
      )}
      <ConfirmDialog
        open={confirmRequirements}
        onClose={() => setConfirmRequirements(false)}
        onConfirm={() => { setConfirmRequirements(false); act('install', { withRequirements: true }); }}
        title={`Installer ${plugin.name}`}
        message={`Nécessite aussi : ${requirements.map((r) => `${r.name} ${r.version}`).join(', ')}, installé en premier.`}
        confirmLabel="Tout installer"
        confirmColor="primary"
      />
      {error && (
        <Typography role="alert" variant="body2" color="error" sx={{ px: 2, pb: 1.5, fontWeight: 600 }}>
          {error}
        </Typography>
      )}
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2, pb: 2, pt: 1, borderTop: 1, borderColor: 'divider', borderTopStyle: 'dashed' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>Ce qu’il ajoute</Typography>
          <Box component="ul" sx={{ m: 0, mt: 0.5, mb: installed ? 1.5 : 0, pl: 2.5 }}>
            {plugin.surfaces.map((s) => <Typography component="li" variant="body2" key={s}>{s}</Typography>)}
          </Box>
          {installed && plugin.rollback && (
            <Box sx={{ mb: 1.5 }}>
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => setConfirmRollback(true)}
                sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
              >
                Revenir à la version précédente
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{plugin.rollback.label}</Typography>
            </Box>
          )}
          {installed && (
            <>
              {/* A plugin module can take its data with it (rules 21-22); the others always keep it. */}
              {plugin.erasable && eraseWarnings.map((line) => (
                <Stack key={line.label} direction="row" spacing={1} sx={{ alignItems: 'flex-start', mb: 1, color: 'warning.dark' }}>
                  <WarningAmberIcon fontSize="small" sx={{ mt: '2px' }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{line.label}</Typography>
                </Stack>
              ))}
              {plugin.erasable && (
                <FormControlLabel
                  sx={{ display: 'flex', minHeight: 44, mb: 0.5 }}
                  control={<Checkbox checked={erase} onChange={(e) => { setErase(e.target.checked); setArmed(false); }} />}
                  label="Effacer aussi ses données"
                />
              )}
              {erase ? (
                <Typography variant="body2" color="error" sx={{ mb: 1.5, fontWeight: 600 }}>
                  {eraseLines ? `Seront effacés : ${eraseLines}. ` : ''}C’est définitif.
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Données conservées.</Typography>
              )}
              <Button
                color="error"
                variant={armed ? 'contained' : 'outlined'}
                disabled={busy || blocked}
                onClick={() => (armed ? act('uninstall', erase ? { purge: true } : undefined) : setArmed(true))}
                sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
              >
                {!armed ? 'Désinstaller' : erase ? 'Désinstaller et effacer' : 'Confirmer la désinstallation'}
              </Button>
            </>
          )}
        </Box>
      </Collapse>
    </Card>
  );
}
