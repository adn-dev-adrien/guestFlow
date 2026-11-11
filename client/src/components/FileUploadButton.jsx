/**
 * FileUploadButton — pick a TEXT file and hand its contents to a caller: text only (UTF-8, else
 * Windows-1252 — specs/guest-email-texts-made-simple.md rule 23), never for binaries or backups.
 *
 * Props:
 *   label:      string                       button text
 *   accept?:    string                       the input's accept attribute (e.g. '.csv,text/csv')
 *   onFile:     (text, file) => void|Promise called with the file read as text
 *   onError?:   (message) => void            a file in an unreadable encoding
 *   disabled?:  boolean
 *   busy?:      boolean                      shows a spinner and blocks a second pick
 *   variant?:   MUI Button variant           default 'contained'
 *   fullWidth?: boolean
 */
import React, { useRef } from 'react';
import readTextFile from '../utils/readTextFile';
import { Button, CircularProgress } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';

export default function FileUploadButton({
  label,
  accept,
  onFile,
  onError,
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
    let text;
    try {
      text = await readTextFile(file);
    } catch (err) {
      if (onError) onError(err.message);
      return;
    }
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
