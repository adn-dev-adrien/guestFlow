import React from 'react';
import { TextField, Button } from '@mui/material';
import FormDialog from './FormDialog';

/**
 * CalendarNoteDialog — add / edit / delete a single calendar-day note.
 * Pure presentational: the parent owns persistence + state. Built on FormDialog
 * (fullScreen on xs inherited); « Supprimer » rides the secondary-action slot.
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
    <FormDialog
      open={open}
      onClose={onClose}
      title={`Note — ${date}`}
      maxWidth="xs"
      onSubmit={onSave}
      secondaryAction={hasNote ? (
        <Button color="error" onClick={onDelete}>Supprimer</Button>
      ) : null}
    >
      <TextField
        autoFocus fullWidth multiline rows={2} margin="dense"
        label="Note (50 car. max)"
        value={text}
        onChange={(e) => onChangeText(e.target.value.slice(0, maxLength))}
        helperText={`${text.length}/${maxLength}`}
      />
    </FormDialog>
  );
}
