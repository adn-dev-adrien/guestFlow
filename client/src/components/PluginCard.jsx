/**
 * PluginCard — one plugin on the Plugins page (specs/plugins-phase-0-foundation.md rules 22–23).
 * Feature-specific: only the Plugins page lists plugins.
 *
 * Props:
 *   plugin    { id, name, description, icon, surfaces, state, blocker }  as GET /api/plugins returns it
 *   busy      boolean   an action on this card is running
 *   error     string?   refusal or failure message, shown in red under the card
 *   onAction  (action: 'install'|'activate'|'deactivate'|'uninstall') => void
 */
import React, { useState } from 'react';
import { Box, Button, Card, CardActionArea, Collapse, Stack, Typography } from '@mui/material';
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
import ExtensionIcon from '@mui/icons-material/Extension';
import StatusBadge from './StatusBadge';

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
};

export default function PluginCard({ plugin, busy = false, error = null, onAction }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const Icon = ICONS[plugin.icon] || ExtensionIcon;
  const installed = plugin.state !== 'available';

  const primary = plugin.state === 'available'
    ? { action: 'install', label: 'Installer', variant: 'contained' }
    : plugin.state === 'active'
      ? { action: 'deactivate', label: 'Désactiver', variant: 'outlined' }
      : { action: 'activate', label: 'Activer', variant: 'contained' };

  const act = (action) => {
    setArmed(false);
    onAction(action);
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
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{plugin.name}</Typography>
            <Typography variant="body2" color="text.secondary">{plugin.description}</Typography>
            {installed && (
              <Box sx={{ mt: 0.5 }}>
                <StatusBadge status={plugin.state === 'active' ? 'success' : 'neutral'} label={plugin.state === 'active' ? 'Actif' : 'Inactif'} />
              </Box>
            )}
          </Box>
        </CardActionArea>
        <Button
          variant={primary.variant}
          disabled={busy}
          onClick={() => act(primary.action)}
          sx={{ minHeight: 44, flex: 'none', width: { xs: '100%', sm: 'auto' } }}
        >
          {primary.label}
        </Button>
      </Stack>
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
          {installed && (
            <>
              <Button
                color="error"
                variant={armed ? 'contained' : 'outlined'}
                disabled={busy}
                onClick={() => (armed ? act('uninstall') : setArmed(true))}
                sx={{ minHeight: 44 }}
              >
                {armed ? 'Confirmer la désinstallation' : 'Désinstaller'}
              </Button>
              {armed && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Tes données sont conservées : en le réinstallant, tu retrouves tout.
                </Typography>
              )}
            </>
          )}
        </Box>
      </Collapse>
    </Card>
  );
}
