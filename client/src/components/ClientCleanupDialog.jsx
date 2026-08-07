/**
 * ClientCleanupDialog — selective cleanup popup.
 *
 * Props:
 *   - open: boolean
 *   - orphans: Array<{ id, firstName, lastName, email, phone }>
 *   - onClose: () => void            // Annuler / backdrop close — pure no-op
 *   - onConfirm: (ids: number[]) => Promise<void> | void
 *   - busy: boolean                  // true while the parent's onConfirm is in flight
 *
 * Behavior (see specs/clients.md §3 rule 8):
 *   - All rows are checked by default whenever `orphans` changes (re-open = fresh selection).
 *   - Master toggle reflects the current selection (indeterminate when mixed).
 *   - "Supprimer (N)" is disabled when N === 0 or while `busy`.
 *   - Empty `orphans` → friendly empty state + disabled submit.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, CircularProgress, Checkbox, FormControlLabel,
  Typography, Box, List, ListItem, ListItemIcon, ListItemText,
  Divider, useMediaQuery, useTheme,
} from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';

export default function ClientCleanupDialog({ open, orphans, onClose, onConfirm, busy }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const list = Array.isArray(orphans) ? orphans : [];
  const [selected, setSelected] = useState(() => new Set());

  // Re-select everything whenever the orphan list changes (or the dialog re-opens with a fresh fetch).
  useEffect(() => {
    setSelected(new Set(list.map((c) => c.id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, list.length, list.map((c) => c.id).join(',')]);

  const total = list.length;
  const selectedCount = selected.size;
  const allChecked = total > 0 && selectedCount === total;
  const noneChecked = selectedCount === 0;
  const indeterminate = !allChecked && !noneChecked;

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(list.map((c) => c.id)));
  };

  const handleConfirm = () => {
    if (noneChecked || busy) return;
    onConfirm(Array.from(selected));
  };

  const orderedSelected = useMemo(
    () => list.filter((c) => selected.has(c.id)).map((c) => c.id),
    [list, selected],
  );

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle sx={{ pb: 0.5 }}>
        Nettoyer la base clients
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Sélectionne les clients à supprimer. Seuls les clients sans réservation ni devis apparaissent ici.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {total === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
            <DeleteSweepIcon sx={{ fontSize: 40, opacity: 0.4, mb: 1 }} />
            <Typography variant="body2">
              Aucun client à supprimer — tous les clients ont au moins une réservation ou un devis.
            </Typography>
          </Box>
        ) : (
          <>
            <FormControlLabel
              control={(
                <Checkbox
                  checked={allChecked}
                  indeterminate={indeterminate}
                  onChange={toggleAll}
                  slotProps={{ input: { 'aria-label': 'Tout cocher ou décocher' } }}
                />
              )}
              label={(
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {allChecked ? 'Tout décocher' : 'Tout cocher'}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    ({selectedCount}/{total} sélectionné{selectedCount > 1 ? 's' : ''})
                  </Typography>
                </Typography>
              )}
            />
            <Divider sx={{ my: 1 }} />
            <List dense disablePadding>
              {list.map((c) => {
                const labelId = `cleanup-row-${c.id}`;
                const checked = selected.has(c.id);
                const fullName = [c.lastName, c.firstName].filter(Boolean).join(' ').trim()
                  || `Client #${c.id}`;
                const secondary = [c.email, c.phone].filter(Boolean).join(' · ') || '—';
                return (
                  <ListItem
                    key={c.id}
                    disablePadding
                    onClick={() => toggleOne(c.id)}
                    sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <Checkbox
                        edge="start"
                        checked={checked}
                        tabIndex={-1}
                        disableRipple
                        slotProps={{ input: { 'aria-labelledby': labelId } }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      id={labelId}
                      primary={fullName}
                      secondary={secondary}
                      slotProps={{
                        primary: { variant: 'body2', fontWeight: 500 },
                        secondary: { variant: 'caption' },
                      }}
                    />
                  </ListItem>
                );
              })}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Annuler</Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleConfirm}
          disabled={noneChecked || busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DeleteSweepIcon />}
          aria-label={`Supprimer ${selectedCount} client${selectedCount > 1 ? 's' : ''}`}
          data-selected-ids={orderedSelected.join(',')}
        >
          Supprimer ({selectedCount})
        </Button>
      </DialogActions>
    </Dialog>
  );
}
