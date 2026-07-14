/**
 * PageActionBar — shared sticky page-top action bar.
 *
 * Bundles two canonical actions (Save, Cancel — both optional) plus two slots
 * for page-specific extras (actionsBefore, actionsAfter). Visual reference:
 * ReservationPage.js sticky bar post "Improve sticky banner" commit.
 *
 * Props:
 *   title?       string         (page title, hidden on xs by default)
 *   backTo?      string         (router path; shows a back IconButton on the left)
 *   onBack?      () => void      (back handler; takes precedence over backTo for computed navigation)
 *   subtitle?    ReactNode      (rendered beside the title — e.g. a Chip or caption)
 *   center?      ReactNode      (rendered CENTERED in the bar; hidden on xs — too tight on mobile)
 *
 *   onSave?      () => void     (omit → no Save button)
 *   saveDisabled? boolean
 *   saveTooltip?  string        (default 'Enregistrer')
 *   saveBusy?     boolean       (swaps the icon for a spinner)
 *
 *   onCancel?    () => void     (omit → no Cancel button)
 *   cancelDisabled? boolean
 *   cancelTooltip?  string      (default 'Annuler')
 *
 *   actionsBefore? Action[]     (inserted BEFORE Save — page-specific helpers)
 *   actionsAfter?  Action[]     (inserted AFTER Cancel — destructive zone)
 *
 *   Action shape (icon button):
 *     { icon, tooltip, onClick, color?, disabled?, ariaLabel? }
 *     color ∈ 'primary' | 'info' | 'success' | 'warning' | 'error' | 'default'
 *   Or a custom node: { node: ReactNode } — rendered as-is (e.g. a <Select>),
 *     always kept inline (never collapsed into the mobile overflow menu).
 *
 * Visual:
 *  - Sticky top: 56px (xs), 64px (sm+); white bg; thin bottom border.
 *  - Each button is a bordered IconButton + Tooltip (icon-only, French tooltip).
 *  - Save renders with a filled primary background (the only "filled" button).
 *  - Layout: [Back Title Subtitle] … [center] … [actionsBefore Save Cancel actionsAfter]
 *    (with `center`, the two side sections take equal flex so the centre is truly centred).
 *  - On xs, if `actionsBefore + actionsAfter` has > 2 items, the extras collapse
 *    into a "…" overflow menu (Save/Cancel always stay visible).
 */
import React, { useState } from 'react';
import {
  Box, Typography, IconButton, Tooltip, Menu, MenuItem,
  ListItemIcon, ListItemText, useMediaQuery, CircularProgress,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useNavigate } from 'react-router-dom';

const borderedSx = (color) => ({
  border: '1px solid',
  borderColor: color && color !== 'default' ? `${color}.main` : 'divider',
  borderRadius: 1,
});

const saveFilledSx = {
  bgcolor: 'primary.main',
  color: '#fff',
  borderRadius: 1,
  '&:hover': { bgcolor: 'primary.dark' },
  '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
};

function renderCustomAction(action, key) {
  // A custom-node item (e.g. a Select) is rendered as-is.
  if (action.node) {
    return <React.Fragment key={key}>{action.node}</React.Fragment>;
  }
  const { icon, tooltip, onClick, color, disabled, ariaLabel } = action;
  return (
    <Tooltip key={key} title={tooltip} enterDelay={500} enterNextDelay={500}>
      <span>
        <IconButton
          aria-label={ariaLabel || tooltip}
          color={color && color !== 'default' ? color : 'default'}
          onClick={onClick}
          disabled={disabled}
          sx={borderedSx(color)}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

export default function PageActionBar({
  title,
  backTo,
  onBack,
  subtitle,
  // Optional ReactNode rendered CENTERED in the bar (between the title and the actions). When set, the
  // bar switches to a 3-equal-columns layout so the content is truly centred. Hidden on xs (the mobile
  // bar is too tight) — pass content that the page can afford to drop on small screens.
  center,
  onSave,
  saveDisabled = false,
  saveTooltip = 'Enregistrer',
  saveBusy = false,
  onCancel,
  cancelDisabled = false,
  cancelTooltip = 'Annuler',
  actionsBefore = [],
  actionsAfter = [],
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState(null);

  // Only icon actions collapse into the mobile overflow menu; custom-node items always stay inline.
  const iconExtras = [...actionsBefore, ...actionsAfter].filter((a) => !a.node);
  const useOverflow = isMobile && iconExtras.length > 2;
  const visibleBefore = useOverflow ? actionsBefore.filter((a) => a.node) : actionsBefore;
  const visibleAfter = useOverflow ? actionsAfter.filter((a) => a.node) : actionsAfter;

  return (
    <Box
      sx={{
        position: 'sticky',
        top: { xs: 56, sm: 64 },
        zIndex: (t) => t.zIndex.appBar - 1,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        px: { xs: 1.5, sm: 2 },
        py: { xs: 1, sm: 1.25 },
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 2,
      }}
    >
      {/* Left section: back + title + subtitle. When a `center` node is set, both side sections take an
          equal flex basis (1 1 0) so the centre node is truly centred across the bar. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, ...(center ? { flex: '1 1 0' } : { flexGrow: 1 }) }}>
        {(onBack || backTo) && (
          <Tooltip title="Retour" enterDelay={500} enterNextDelay={500}>
            <IconButton aria-label="Retour" onClick={onBack || (() => navigate(backTo))} sx={borderedSx('default')}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
        )}
        {title && (
          <Typography
            variant="pageTitle"
            sx={{ display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}
          >
            {title}
          </Typography>
        )}
        {subtitle}
      </Box>

      {center && (
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            flex: '0 1 auto',
            minWidth: 0,
            px: 1,
          }}
        >
          {center}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', minWidth: 0, ...(center ? { flex: '1 1 0' } : {}) }}>
        {visibleBefore.map((action, i) => renderCustomAction(action, `before-${i}`))}

        {useOverflow && (
          <>
            <Tooltip title="Plus d'actions" enterDelay={500}>
              <IconButton aria-label="Plus d'actions" onClick={(e) => setMenuAnchor(e.currentTarget)} sx={borderedSx('default')}>
                <MoreVertIcon />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              {iconExtras.map((a, i) => (
                <MenuItem
                  key={`menu-${i}`}
                  onClick={() => { setMenuAnchor(null); a.onClick(); }}
                  disabled={a.disabled}
                >
                  <ListItemIcon>{a.icon}</ListItemIcon>
                  <ListItemText>{a.tooltip}</ListItemText>
                </MenuItem>
              ))}
            </Menu>
          </>
        )}

        {onSave && (
          <Tooltip title={saveBusy ? `${saveTooltip}...` : saveTooltip} enterDelay={500} enterNextDelay={500}>
            <span>
              <IconButton
                color="primary"
                aria-label={saveTooltip}
                onClick={onSave}
                disabled={saveDisabled || saveBusy}
                sx={saveFilledSx}
              >
                {saveBusy ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
              </IconButton>
            </span>
          </Tooltip>
        )}

        {onCancel && (
          <Tooltip title={cancelTooltip} enterDelay={500} enterNextDelay={500}>
            <span>
              <IconButton
                aria-label={cancelTooltip}
                onClick={onCancel}
                disabled={cancelDisabled}
                sx={borderedSx('default')}
              >
                <CloseIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {visibleAfter.map((action, i) => renderCustomAction(action, `after-${i}`))}
      </Box>
    </Box>
  );
}
