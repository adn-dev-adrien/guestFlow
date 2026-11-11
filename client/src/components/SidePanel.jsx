/**
 * SidePanel — the editor of a list row, opened beside the list instead of over it
 * (specs/options-resources-ux.md §4.2). Right-hand panel (560 px) with a light scrim on `sm`+, full-height
 * sheet rising from the bottom on `xs`. Header with the title and a 44 px close button, optional section
 * chips that scroll to each `SidePanelSection`, a body that scrolls on its own, a sticky footer with the
 * state text and « Annuler » / « Enregistrer ».
 *
 * Closing (close button, Escape, scrim) with unsaved changes opens UnsavedChangesDialog. The panel owns
 * one history entry while it is open: the browser « Retour » closes a clean panel and asks first on a
 * dirty one (the entry is put back), and closing any other way removes it, so the page behind is one
 * « Retour » away as before. A reload or a sidebar navigation is guarded by useDirtyFormGuard while the
 * panel is dirty — which holds the global navigation slot only while dirty and restores the previous
 * one, so two panels, or a panel and a page form, never erase each other's guard.
 *
 * The panel never closes itself after a save: the owner sets `open` to false once `onSave` succeeded, so
 * a refused save leaves the form where it is. `onSave` answers `true` when it saved; « Enregistrer et
 * quitter » then continues to where the operator was going (the page behind, or the clicked sidebar item).
 *
 * Props:
 *   open          boolean
 *   onClose       () => void                  final close (after the guard, if any)
 *   title         ReactNode                   header, serif
 *   dirty?        boolean                     unsaved changes: enables « Enregistrer » and the guard
 *   onSave?       () => Promise<boolean|void>  « Enregistrer » (and « Enregistrer et quitter » of the guard);
 *                                              resolve `false` when nothing was saved (the guard then stays out)
 *   saving?       boolean                     spinner on « Enregistrer »
 *   errorCount?   number                      invalid fields: disables saving, footer reads « N champ(s) à corriger »
 *   sections?     Array<{ id, label, hasError? }>   chips; `id` matches a <SidePanelSection id>
 *   saveLabel? cancelLabel? closeLabel?       French defaults
 *   children      ReactNode                   the form
 *
 * The panel sits above the app bar (modal layer), so its header and close button are never covered.
 *
 * `prefers-reduced-motion`: opacity only, no slide. Motion is one curve both ways (the panel leaves
 * the way it came).
 */
import React, { useEffect, useId, useRef } from 'react';
import {
  Box, Button, CircularProgress, Drawer, Fade, IconButton, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import useDirtyFormGuard from '../hooks/useDirtyFormGuard';

const EASE = 'cubic-bezier(.32,.72,0,1)';
const DURATION = 340;

/** A titled block of a SidePanel form; `id` is what the section chips scroll to. */
export function SidePanelSection({ id, title, children }) {
  return (
    <Box
      component="section"
      data-side-panel-section={id}
      sx={{ py: 2.25, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
    >
      {title && <Typography variant="sectionHeader" component="h3" sx={{ mb: 1.5 }}>{title}</Typography>}
      {children}
    </Box>
  );
}

export const errorCountLabel = (n) => `${n} champ${n > 1 ? 's' : ''} à corriger`;

export default function SidePanel({
  open, onClose, title, dirty = false, onSave, saving = false, errorCount = 0, sections = [],
  saveLabel = 'Enregistrer', cancelLabel = 'Annuler', closeLabel = 'Fermer', children,
}) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const routerNavigate = useNavigate();
  const bodyRef = useRef(null);

  const titleId = useId();

  const go = (destination) => (typeof destination === 'string' ? routerNavigate(destination) : onClose());
  const guard = useDirtyFormGuard({
    draft: open && dirty, saved: false, navigate: go, guardBack: false,
  });

  const requestClose = () => (dirty ? guard.openGuard() : onClose());

  // The panel's own history entry (see the header): « Retour » pops it.
  const live = useRef({});
  live.current = { dirty, onClose, openGuard: guard.openGuard };
  useEffect(() => {
    if (!open) return undefined;
    const pageUrl = window.location.href;
    let entryOpen = true;
    window.history.pushState({ ...(window.history.state || {}), sidePanel: true }, '', pageUrl);
    const onPop = () => {
      if (!entryOpen) return;
      if (live.current.dirty) {
        window.history.pushState({ ...(window.history.state || {}), sidePanel: true }, '', pageUrl);
        live.current.openGuard();
        return;
      }
      entryOpen = false;
      live.current.onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (entryOpen && window.history.state && window.history.state.sidePanel) window.history.back();
    };
  }, [open]);

  const saveAndQuit = async () => {
    const saved = onSave ? await onSave() : true;
    if (saved === false) guard.dismissGuard();
    else guard.confirmLeave();
  };

  const scrollTo = (id) => {
    const target = bodyRef.current && bodyRef.current.querySelector(`[data-side-panel-section="${id}"]`);
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  };

  const saveDisabled = saving || !dirty || errorCount > 0;
  const stateText = errorCount > 0 ? errorCountLabel(errorCount) : (dirty ? 'Modifié' : '');

  return (
    <>
      <Drawer
        anchor={phone ? 'bottom' : 'right'}
        open={open}
        onClose={requestClose}
        sx={{ zIndex: (t) => t.zIndex.modal }}
        transitionDuration={reduced ? 200 : DURATION}
        slots={reduced ? { transition: Fade } : undefined}
        slotProps={{
          backdrop: { sx: { bgcolor: 'rgba(39,37,31,.22)' } },
          transition: reduced ? undefined : { easing: EASE },
          paper: {
            role: 'dialog',
            'data-anchor': phone ? 'bottom' : 'right',
            'aria-labelledby': titleId,
            sx: {
              width: { xs: '100%', sm: 560 }, maxWidth: '100%',
              height: { xs: 'calc(100% - 10px)', sm: '100%' },
              borderRadius: { xs: '18px 18px 0 0', sm: 0 },
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2.5, pr: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography id={titleId} variant="sectionHeader" component="h2" sx={{ flex: 1, minWidth: 0, fontSize: '1.15rem', overflowWrap: 'anywhere' }}>
            {title}
          </Typography>
          <IconButton aria-label={closeLabel} onClick={requestClose} sx={{ width: 44, height: 44, minWidth: 44, minHeight: 44, flexShrink: 0 }}><CloseIcon /></IconButton>
        </Box>

        {sections.length > 0 && (
          <Box
            role="navigation"
            aria-label="Sections"
            sx={{
              display: 'flex', gap: 0.75, overflowX: 'auto', px: 2.5, py: 1, borderBottom: '1px solid', borderColor: 'divider',
              scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            {sections.map((section) => (
              <Button
                key={section.id}
                size="small"
                onClick={() => scrollTo(section.id)}
                data-has-error={section.hasError ? 'true' : undefined}
                sx={(t) => ({
                  flex: 'none', borderRadius: 99, minHeight: { xs: 44, sm: 32 }, px: 1.5, textTransform: 'none', fontWeight: 500,
                  bgcolor: section.hasError ? t.palette.error.soft : t.palette.grey[200],
                  color: section.hasError ? t.palette.error.text : t.palette.text.secondary,
                  '&:hover': { bgcolor: section.hasError ? t.palette.error.soft : t.palette.grey[300] },
                })}
              >
                {section.label}
              </Button>
            ))}
          </Box>
        )}

        <Box ref={bodyRef} sx={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', px: 2.5, pb: 3 }}>
          {children}
        </Box>

        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.25, px: 2.5, pt: 1.5,
            pb: 'calc(12px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
          }}
        >
          <Typography
            variant="caption"
            role="status"
            sx={{ mr: 'auto', color: errorCount > 0 ? 'error.main' : 'text.secondary' }}
          >
            {stateText}
          </Typography>
          <Button onClick={requestClose} sx={{ minHeight: 44 }}>{cancelLabel}</Button>
          <Button
            variant="contained"
            disabled={saveDisabled}
            onClick={onSave}
            sx={{ minHeight: 44, minWidth: 120 }}
          >
            {saving ? <CircularProgress size={18} color="inherit" /> : saveLabel}
          </Button>
        </Box>
      </Drawer>
      <UnsavedChangesDialog
        open={guard.guardDialogOpen}
        onStay={guard.dismissGuard}
        onDiscard={guard.confirmLeave}
        onSaveAndQuit={saveAndQuit}
      />
    </>
  );
}
