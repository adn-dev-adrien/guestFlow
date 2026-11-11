/**
 * SearchField — the one search input of a list page: magnifier, clear button, 16 px text so iOS does
 * not zoom on focus (specs/options-resources-ux.md §4.2). Escape clears it.
 *
 * Props:
 *   value         string                 controlled text
 *   onChange      (text: string) => void
 *   label         string                 accessible name and, unless `placeholder` is set, the placeholder
 *   placeholder?  string
 *   clearLabel?   string                 accessible name of the clear button (default « Effacer »)
 *   sx?           object                 forwarded to the field (width, flex…)
 */
import React from 'react';
import { IconButton, InputAdornment, TextField } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';

export default function SearchField({
  value, onChange, label, placeholder, clearLabel = 'Effacer', sx,
}) {
  return (
    <TextField
      type="search"
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } }}
      placeholder={placeholder || label}
      sx={[{
        '& input': { fontSize: 16, minHeight: 28 },
        '& input::-webkit-search-cancel-button': { display: 'none' },
        '& .MuiOutlinedInput-root': { borderRadius: 3, bgcolor: 'background.paper' },
      }, ...(Array.isArray(sx) ? sx : [sx])]}
      slotProps={{
        htmlInput: { 'aria-label': label, enterKeyHint: 'search', autoComplete: 'off' },
        input: {
          startAdornment: (
            <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" aria-label={clearLabel} onClick={() => onChange('')} edge="end" sx={{ width: { xs: 44, sm: 36 }, height: { xs: 44, sm: 36 } }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : null,
        },
      }}
    />
  );
}
