/**
 * FileUploadButton — pick a file and hand its contents to a caller.
 *
 * Generic on purpose: restoring a backup, importing an iCal feed and sending back the translation
 * catalogue are the same gesture, and each of them is written today as a bare `<input type="file">`
 * with its own styling.
 *
 * Props:
 *   label:      string                       button text
 *   accept?:    string                       the input's accept attribute (e.g. '.csv,text/csv')
 *   onFile:     (text, file) => void|Promise called with the file read as UTF-8 text
 *   disabled?:  boolean
 *   busy?:      boolean                      shows a spinner and blocks a second pick
 *   variant?:   MUI Button variant           default 'contained'
 *   fullWidth?: boolean
 */
import React, { useRef } from 'react';
import { Button, CircularProgress } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';

export default function FileUploadButton({
  label,
  accept,
  onFile,
  disabled = false,
  busy = false,
  variant = 'contained',
  fullWidth = false,
}) {
  const inputRef = useRef(null);

  const handleChange = async (event) => {
    const file = event.target.files && event.target.files[0];
    // Reset first: picking the SAME file twice must fire onChange again, which it does not if the
    // input keeps its value.
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    await onFile(text, file);
  };

  return (
    <>
      <Button
        variant={variant}
        onClick={() => inputRef.current && inputRef.current.click()}
        disabled={disabled || busy}
        fullWidth={fullWidth}
        startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <UploadFileIcon />}
        sx={{ minHeight: 44 }}
      >
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </>
  );
}
