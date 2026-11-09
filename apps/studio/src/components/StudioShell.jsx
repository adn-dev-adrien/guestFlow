/**
 * StudioShell — the studio's frame (rules 47-48): a top bar (« Studio du livret », back to GuestFlow), a side
 * navigation — the lodgings, then the chosen lodging's screens, then the settings every lodging shares — and the
 * screen. From 900 px the navigation is a column; below, a drawer behind the menu button. Every move between
 * screens goes through the dirty-form guard.
 *
 * Props: `lodgings`, `children` (the routed screen).
 */
import { useState } from 'react';
import { useLocation } from 'react-router';
import {
  AppBar, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader,
  Toolbar, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import TuneIcon from '@mui/icons-material/Tune';
import HomeWorkOutlinedIcon from '@mui/icons-material/HomeWorkOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LodgingSwitcher from './LodgingSwitcher';
import { useGuardedNavigate } from '../hooks/useDirtyGuard';

const NAV_WIDTH = 248;

const LODGING_SCREENS = [
  { key: 'modules', label: 'Modules', icon: <TuneIcon fontSize="small" /> },
  { key: 'infos', label: 'Infos du logement', icon: <HomeWorkOutlinedIcon fontSize="small" /> },
  { key: 'livret', label: 'Livret', icon: <MenuBookOutlinedIcon fontSize="small" /> },
  { key: 'boutique', label: 'Boutique', icon: <ShoppingBagOutlinedIcon fontSize="small" /> },
];
const SHARED_SCREENS = [
  { path: '/reglages/service', label: 'Service', icon: <ScheduleIcon fontSize="small" /> },
  { path: '/reglages/application', label: 'Application', icon: <SettingsOutlinedIcon fontSize="small" /> },
  { path: '/reglages/photos', label: 'Photos', icon: <PhotoLibraryOutlinedIcon fontSize="small" /> },
];

const itemSx = { borderRadius: 2, minHeight: 44 };

/** `/12/livret/3` → `{ propertyId: 12, screen: 'livret' }`. */
function whereAmI(pathname) {
  const m = /^\/(\d+)\/([a-z]+)/.exec(pathname);
  return m ? { propertyId: Number(m[1]), screen: m[2] } : { propertyId: null, screen: null };
}

function Navigation({ lodgings, onGo }) {
  const { pathname } = useLocation();
  const here = whereAmI(pathname);
  const [lastLodging, setLastLodging] = useState(null);
  const currentId = here.propertyId || lastLodging || (lodgings.find((l) => l.enabled) || lodgings[0] || {}).propertyId;
  const current = lodgings.find((l) => l.propertyId === currentId);
  const go = (to, propertyId) => { if (propertyId) setLastLodging(propertyId); onGo(to); };
  return (
    <Box component="nav" aria-label="Studio" sx={{ px: 1.5, py: 1 }}>
      <LodgingSwitcher lodgings={lodgings} currentId={here.propertyId} onSelect={(id) => go(`/${id}/${here.screen || 'modules'}`, id)} />
      <Divider sx={{ my: 1 }} />
      {current ? (
        <List dense aria-label={`Écrans de ${current.name}`} subheader={<ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '32px' }}>{current.name}</ListSubheader>}>
          {LODGING_SCREENS.map((s) => {
            const active = here.propertyId === current.propertyId && here.screen === s.key;
            return (
              <ListItemButton key={s.key} selected={active} aria-current={active ? 'page' : undefined} sx={itemSx} onClick={() => go(`/${current.propertyId}/${s.key}`, current.propertyId)}>
                <ListItemIcon sx={{ minWidth: 36 }}>{s.icon}</ListItemIcon>
                <ListItemText primary={s.label} />
              </ListItemButton>
            );
          })}
        </List>
      ) : null}
      <Divider sx={{ my: 1 }} />
      <List dense aria-label="Réglages" subheader={<ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '32px' }}>Réglages · tous les logements</ListSubheader>}>
        {SHARED_SCREENS.map((s) => (
          <ListItemButton key={s.path} selected={pathname === s.path} aria-current={pathname === s.path ? 'page' : undefined} sx={itemSx} onClick={() => go(s.path)}>
            <ListItemIcon sx={{ minWidth: 36 }}>{s.icon}</ListItemIcon>
            <ListItemText primary={s.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

export default function StudioShell({ lodgings, children }) {
  const theme = useTheme();
  const wide = useMediaQuery('(min-width:900px)');
  const [open, setOpen] = useState(false);
  const go = useGuardedNavigate();
  const onGo = (to) => { setOpen(false); go(to); };
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', zIndex: theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1 }}>
          {!wide ? (
            <IconButton edge="start" aria-label="Ouvrir le menu du studio" onClick={() => setOpen(true)} sx={{ width: 44, height: 44 }}><MenuIcon /></IconButton>
          ) : null}
          <Typography component="h1" sx={{ fontFamily: theme.typography.pageTitle?.fontFamily, fontWeight: 600, fontSize: 20, flex: 1 }} noWrap>Studio du livret</Typography>
          <Tooltip title="Retour à GuestFlow">
            <IconButton component="a" href="/" aria-label="Retour à GuestFlow" sx={{ width: 44, height: 44 }}><ArrowBackIcon /></IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        {wide ? (
          <Box sx={{ width: NAV_WIDTH, flexShrink: 0, position: 'sticky', top: { xs: 56, sm: 64 }, height: { xs: 'calc(100vh - 56px)', sm: 'calc(100vh - 64px)' }, overflowY: 'auto', borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
            <Navigation lodgings={lodgings} onGo={onGo} />
          </Box>
        ) : (
          <Drawer open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: NAV_WIDTH + 16 } } }}>
            <Toolbar />
            <Navigation lodgings={lodgings} onGo={onGo} />
          </Drawer>
        )}
        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </Box>
    </Box>
  );
}
