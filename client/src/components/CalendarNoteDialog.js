import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Box } from '@mui/material';

/**
 * CalendarNoteDialog — add / edit / delete a single calendar-day note.
 * Pure presentational: the parent owns persistence + state.
 *
 * Props:
 *  - open: boolean
 *  - date: string (YYYY-MM-DD, shown in the title)
 *  - text: string (current draft)
 *  - maxLength: number
 *  - hasNote: boolean (whether a saved note exists → shows the delete button)
 *  - onChangeText: (value:string) => void  (already length-capped by the parent or here)
 *  - onSave / onDelete / onClose: () => void
 */
export default function CalendarNoteDialog({ open, date, text, maxLength, hasNote, onChangeText, onSave, onDelete, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Note — {date}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth multiline rows={2} margin="dense"
          label="Note (50 car. max)"
          value={text}
          onChange={(e) => onChangeText(e.target.value.slice(0, maxLength))}
          helperText={`${text.length}/${maxLength}`}
        />
      </DialogContent>
      <DialogActions>
        {hasNote && (
          <Button color="error" onClick={onDelete}>Supprimer</Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" onClick={onSave}>Enregistrer</Button>
      </DialogActions>
    </Dialog>
  );
}
