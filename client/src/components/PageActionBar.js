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
 *   subtitle?    ReactNode      (rendered beside the title — e.g. a Chip or caption)
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
 *   Action shape:
 *     { icon, tooltip, onClick, color?, disabled?, ariaLabel? }
 *     color ∈ 'primary' | 'info' | 'success' | 'warning' | 'error' | 'default'
 *
 * Visual:
 *  - Sticky top: 56px (xs), 64px (sm+); white bg; thin bottom border.
 *  - Each button is a bordered IconButton + Tooltip (icon-only, French tooltip).
 *  - Save renders with a filled primary background (the only "filled" button).
 *  - Layout: [Back] [Title + Subtitle] ……… [actionsBefore] [Save] [Cancel] [actionsAfter]
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
  subtitle,
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

  const allExtras = [...actionsBefore, ...actionsAfter];
  const useOverflow = isMobile && allExtras.length > 2;
  const visibleBefore = useOverflow ? [] : actionsBefore;
  const visibleAfter = useOverflow ? [] : actionsAfter;

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
      {backTo && (
        <Tooltip title="Retour" enterDelay={500} enterNextDelay={500}>
          <IconButton aria-label="Retour" onClick={() => navigate(backTo)} sx={borderedSx('default')}>
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1, minWidth: 0 }}>
        {title && (
          <Typography
            variant="h6"
            sx={{ display: { xs: 'none', sm: 'block' }, fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {title}
          </Typography>
        )}
        {subtitle}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {visibleBefore.map((action, i) => renderCustomAction(action, `before-${i}`))}

        {useOverflow && (
          <>
            <Tooltip title="Plus d'actions" enterDelay={500}>
              <IconButton aria-label="Plus d'actions" onClick={(e) => setMenuAnchor(e.currentTarget)} sx={borderedSx('default')}>
                <MoreVertIcon />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              {allExtras.map((a, i) => (
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
