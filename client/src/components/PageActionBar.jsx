/**
 * PageActionBar — shared sticky page-top action bar.
 *
 * Bundles two canonical actions (Save, Cancel — both optional) plus two slots
 * for page-specific extras (actionsBefore, actionsAfter). Visual reference:
 * ReservationPage.js sticky bar post "Improve sticky banner" commit.
 *
 * Props:
 *   title?       string         (page title; on xs it is shown by the TOP bar instead — the page bar
 *                                publishes it, specs/shell-and-home-day-first.md rule 15)
 *   backTo?      string         (router path; shows a back IconButton on the left)
 *   onBack?      () => void      (back handler; takes precedence over backTo for computed navigation)
 *   subtitle?    ReactNode      (rendered beside the title — e.g. a Chip or caption)
 *   center?      ReactNode      (rendered CENTERED in the bar; hidden on xs — too tight on mobile)
 *   centerFrom?  'sm'|'md'|'lg' (breakpoint from which `center` shows; default 'sm'. A page whose
 *                                bar is crowded at tablet width raises it — specs/review-2026-10-18-
 *                                reservations.md rule 6)
 *   identity?    ReactNode      (one ellipsised line naming what the page shows — « Prénom Nom · N° … »
 *                                — on a second row of the bar BELOW `identityBelow`, where `center` is
 *                                hidden. specs/ui-review-2026-10-19-operations.md rule 12)
 *   identityBelow? 'sm'|'md'|'lg' (default 'lg')
 *   tabs?        ReactNode      (a <PageTabs> node — CENTERED in the bar on sm+, and folded onto a
 *                                SECOND ROW of the same sticky block on xs. Mutually exclusive with
 *                                `center`; see specs/ds-tabs.md rules 2-3.)
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
 *     { icon, tooltip, onClick, color?, disabled?, ariaDisabled?, ariaLabel? }
 *     `ariaDisabled`: looks and reads as disabled but stays focusable and inert (an action that has just
 *     been performed, so keyboard focus does not drop to the page)
 *     color ∈ 'primary' | 'info' | 'success' | 'warning' | 'error' | 'default'
 *   Or a custom node: { node: ReactNode } — rendered as-is (e.g. a <Select>),
 *     always kept inline (never collapsed into the mobile overflow menu).
 *
 * Visual:
 *  - Sticky top: 56px (xs), 64px (sm+); white bg; thin bottom border.
 *  - Each button is a bordered IconButton + Tooltip (icon-only, French tooltip).
 *  - Save renders with a filled primary background (the only "filled" button).
 *  - Layout: [Back Title Subtitle] … [center | tabs] … [actionsBefore Save Cancel actionsAfter]
 *    (with `center`, the two side sections take equal flex so the centre is truly centred; with
 *    `tabs`, the row does not wrap on sm+ and the tabs scroll in the room left — ds-tabs rule 11).
 *  - On xs the title lives in the top bar; a bar left with no back button, subtitle, tabs nor action
 *    is not drawn at all (specs/shell-and-home-day-first.md rule 15); one left with a single icon
 *    action (not Save/Cancel, not a node, not `error`, not the overflow menu) hands it to the top bar
 *    while the title keeps its full text there (rule 23). On xs the actions align with the back button, not with the
 *    middle of a wrapped subtitle (rule 24).
 *  - On xs, if `actionsBefore + actionsAfter` has > 2 items, the extras collapse
 *    into a "…" overflow menu (Save/Cancel always stay visible).
 *  - The bar publishes its bottom edge as the CSS variable `--gf-page-bar-bottom` on the document root
 *    (the app bar's height plus the bar's own, measured — it varies with the bar's rows; the app bar's
 *    alone while the bar is not drawn) so a sticky element of the page can stick right under it
 *    (specs/dashboard-planning-scroll.md rule 16). Removed on unmount.
 *  - Narrow bar (specs/ds-components.md rules 19-20): the title keeps a readable width and ends
 *    in an ellipsis only past it; the subtitle wraps under the title; the actions never shrink
 *    (they take a row of their own when they do not fit), and `center`/`tabs` move to a second row
 *    when the bar is under 720 px wide. Every button is 44 × 44.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  Box, Typography, IconButton, Tooltip, Menu, MenuItem,
  ListItemIcon, ListItemText, useMediaQuery, CircularProgress,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { usePublishPageTitle, useTopBarActionSlot } from '../hooks/usePageTitle';

// The app bar's height, above the sticky page bar (the bar's `top` below).
const APP_BAR_HEIGHT = { xs: 56, sm: 64 };

// Publishes where the page bar ends, so a sticky element of the page can stick right under it.
function usePublishBarBottom(ref, isMobile, drawn) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const base = isMobile ? APP_BAR_HEIGHT.xs : APP_BAR_HEIGHT.sm;
    const el = drawn ? ref.current : null;
    const publish = () => root.style.setProperty('--gf-page-bar-bottom', `${base + (el ? el.offsetHeight : 0)}px`);
    publish();
    let observer = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(publish);
      observer.observe(el);
    }
    return () => {
      if (observer) observer.disconnect();
      root.style.removeProperty('--gf-page-bar-bottom');
    };
  }, [ref, isMobile, drawn]);
}

// Every bar button is a 44 × 44 touch target, whatever its border (specs/ds-components.md rule 20).
const BUTTON_SIZE = { width: 44, height: 44 };

// Under this bar width the centre node (or the tabs) takes a second row instead of crushing the title.
const CENTER_ROW_BELOW = 720;

const borderedSx = (color) => ({
  ...BUTTON_SIZE,
  border: '1px solid',
  borderColor: color && color !== 'default' ? `${color}.main` : 'divider',
  borderRadius: 1,
});

const saveFilledSx = {
  ...BUTTON_SIZE,
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
  const { icon, tooltip, onClick, color, disabled, ariaDisabled, ariaLabel } = action;
  return (
    <Tooltip key={key} title={tooltip} enterDelay={500} enterNextDelay={500}>
      <span>
        <IconButton
          aria-label={ariaLabel || tooltip}
          color={color && color !== 'default' ? color : 'default'}
          onClick={ariaDisabled ? undefined : onClick}
          disabled={disabled}
          aria-disabled={ariaDisabled || undefined}
          sx={{ ...borderedSx(color), ...(ariaDisabled ? { opacity: 0.38, cursor: 'default' } : {}) }}
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
  centerFrom = 'sm',
  // One line naming what the page shows, on a second row below `identityBelow`.
  identity,
  identityBelow = 'lg',
  // A <PageTabs> node: centred in the bar on sm+, second row of the same sticky block on xs.
  tabs,
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
  const identityOnSecondRow = useMediaQuery(theme.breakpoints.down(identityBelow)) && Boolean(identity);
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState(null);
  usePublishPageTitle(title);
  const topBarSlot = useTopBarActionSlot();
  const barRef = useRef(null);

  // Only icon actions collapse into the mobile overflow menu; custom-node items always stay inline.
  const iconExtras = [...actionsBefore, ...actionsAfter].filter((a) => !a.node);
  const useOverflow = isMobile && iconExtras.length > 2;
  const visibleBefore = useOverflow ? actionsBefore.filter((a) => a.node) : actionsBefore;
  const visibleAfter = useOverflow ? actionsAfter.filter((a) => a.node) : actionsAfter;

  // The tabs exist ONCE in the DOM: centred in the bar on sm+, on a second row on xs.
  const tabsOnSecondRow = Boolean(tabs) && isMobile;
  const centerNode = tabsOnSecondRow ? null : (tabs || center);
  // On a phone the title is the top bar's; `center` is hidden there. Nothing else → no empty band.
  const hasActions = Boolean(onSave || onCancel || useOverflow || visibleBefore.length || visibleAfter.length);
  const bareOnPhone = isMobile && !(onBack || backTo) && !subtitle && !tabs && !identityOnSecondRow;
  // A phone bar left with one ICON action and nothing else gives it to the top bar instead of drawing
  // a nearly empty band (specs/shell-and-home-day-first.md rule 23). Never Save / Cancel, never a
  // custom node (a text button, a select), never a destructive action, never the « ⋯ » menu; and only
  // while the top bar's title keeps its full text beside it (the slot is null otherwise).
  const lone = [...visibleBefore, ...visibleAfter];
  const movable = lone.length === 1 && !lone[0].node && lone[0].color !== 'error';
  const inTopBar = bareOnPhone && !onSave && !onCancel && !useOverflow && movable && Boolean(topBarSlot);
  usePublishBarBottom(barRef, isMobile, !(bareOnPhone && !hasActions) && !inTopBar);
  if (bareOnPhone && !hasActions) return null;

  // The actions keep their full width: when they do not fit beside the title they take a row of their
  // own, right-aligned — never a column of stacked buttons.
  const actions = (
    <Box
      data-testid="page-action-bar-actions"
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        // The centre's twin only while the centre sits beside the title: hidden on xs, or on its own
        // row, it leaves the title the room (rule 19, amended 2026-10-18).
        flex: { xs: '0 1 auto', sm: centerNode ? '1 1 0' : '0 1 auto' },
        [`@container (max-width: ${CENTER_ROW_BELOW - 0.02}px)`]: { flex: '0 1 auto' },
        minWidth: 'fit-content',
        maxWidth: '100%',
        ml: 'auto',
        '& .MuiButton-root': { whiteSpace: 'nowrap' },
      }}
    >
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
  );

  if (inTopBar) return createPortal(actions, topBarSlot);

  return (
    <Box
      ref={barRef}
      data-sticky-bar=""
      sx={{
        position: 'sticky',
        top: { xs: 56, sm: 64 },
        zIndex: (t) => t.zIndex.appBar - 1,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        mb: 2,
        // The layout below answers to the bar's own width, not the viewport's: the sidebar takes a
        // different share of it on every page and breakpoint.
        containerType: 'inline-size',
      }}
    >
      <Box
        data-testid="page-action-bar-row"
        sx={{
          px: { xs: 1.5, sm: 2 },
          py: { xs: 1, sm: 1.25 },
          display: 'flex',
          // Beside tabs the row never wraps on sm+: the tabs give way, never the actions
          // (specs/ds-tabs.md rule 11). Under 720 px of bar they take a second row (below).
          flexWrap: tabs ? { xs: 'wrap', sm: 'nowrap' } : 'wrap',
          [`@container (max-width: ${CENTER_ROW_BELOW - 0.02}px)`]: { flexWrap: 'wrap' },
          // A phone's subtitle wraps under the back button: the actions stay level with the button, not
          // with the middle of the two lines (specs/shell-and-home-day-first.md rule 24).
          alignItems: { xs: 'flex-start', sm: 'center' },
          columnGap: 1,
          rowGap: 1,
        }}
      >
        {/* Left section: back + title + subtitle. It never gets narrower than a readable title; the
            subtitle wraps under the title rather than squeezing it (specs/ds-components.md rule 19). */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 0.25,
            flex: '1 1 0',
            // Only a visible title claims that width: a bar showing just « Retour » gives it to the actions.
            // Beside tabs it keeps room for a one-line « Dernière mise à jour » under the title: the
            // tabs give way first (specs/ds-tabs.md rule 11).
            minWidth: { xs: 0, sm: title ? `min(100%, ${tabs ? 17 : 14}rem)` : 0 },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, maxWidth: '100%' }}>
            {(onBack || backTo) && (
              <Tooltip title="Retour" enterDelay={500} enterNextDelay={500}>
                <IconButton aria-label="Retour" onClick={onBack || (() => navigate(backTo))} sx={{ ...borderedSx('default'), flexShrink: 0 }}>
                  <ArrowBackIcon />
                </IconButton>
              </Tooltip>
            )}
            {title && (
              <Typography
                variant="pageTitle"
                title={title}
                sx={{
                  display: { xs: 'none', sm: 'block' },
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
              >
                {title}
              </Typography>
            )}
          </Box>
          {subtitle && (
            <Box sx={{ minWidth: 0, maxWidth: '100%' }}>
              {subtitle}
            </Box>
          )}
        </Box>

        {centerNode && (
          <Box
            data-testid="page-action-bar-center"
            sx={{
              display: { xs: 'none', [tabs ? 'sm' : centerFrom]: 'flex' },
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              flex: '0 1 auto',
              minWidth: 0,
              px: 1,
              // The tabs shrink to the room the title and the actions leave and scroll inside it
              // (specs/ds-tabs.md rule 11).
              ...(tabs ? { '& > .MuiTabs-root': { maxWidth: '100%' } } : {}),
              [`@container (max-width: ${CENTER_ROW_BELOW - 0.02}px)`]: { order: 3, flexBasis: '100%', px: 0 },
            }}
          >
            {centerNode}
          </Box>
        )}

        {actions}
      </Box>

      {identityOnSecondRow && (
        <Typography
          data-testid="page-action-bar-identity"
          variant="body2"
          color="text.secondary"
          noWrap
          sx={{ px: { xs: 1.5, sm: 2 }, pb: 1, mt: -0.25, fontVariantNumeric: 'tabular-nums' }}
        >
          {identity}
        </Typography>
      )}

      {/* xs: the centre slot is hidden, so the tabs take a second row of the SAME sticky block —
          never a detached strip above or below it (specs/ds-tabs.md rule 2). */}
      {tabsOnSecondRow && (
        <Box sx={{ px: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
          {tabs}
        </Box>
      )}
    </Box>
  );
}
