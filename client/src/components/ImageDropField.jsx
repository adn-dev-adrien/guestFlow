/**
 * ImageDropField — pick one image by dropping it on the field or tapping it (specs/gift-voucher-campaigns.md rule 47).
 * The field only holds the chosen file and previews it; the server judges the image and its refusal is handed back through `error`.
 *
 * Props:
 *   value        File | null   the chosen file (controlled by the parent)
 *   onChange     (File | null) => void   a file was dropped or picked; `null` when it is removed
 *   currentUrl?  string        the image already stored, previewed while no new file is chosen
 *   label        string        invitation shown in the empty zone (French)
 *   helperText?  string        what the server expects (format, size)
 *   error?       string        the server's refusal, shown under the zone
 *   accept?      string        the input's accept attribute (default 'image/jpeg,image/png')
 *   disabled?    boolean
 *   removeLabel? string        name of the remove button (default « Retirer l’image »)
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, FormHelperText, Typography } from '@mui/material';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';

export default function ImageDropField({
  value, onChange, currentUrl = null, label, helperText = null, error = null, accept = 'image/jpeg,image/png', disabled = false, removeLabel = 'Retirer l’image',
}) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (!value || typeof URL.createObjectURL !== 'function') { setPreviewUrl(null); return undefined; }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => { if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url); };
  }, [value]);

  const pick = (file) => { if (file && !disabled) onChange(file); };
  const shown = previewUrl || currentUrl;

  return (
    <Box>
      <Box
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled || undefined}
        onClick={() => { if (!disabled && inputRef.current) inputRef.current.click(); }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); inputRef.current.click(); } }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null); }}
        sx={{
          border: '2px dashed', borderColor: error ? 'error.main' : (over ? 'primary.main' : 'divider'), borderRadius: 1, p: 2, minHeight: 96, cursor: disabled ? 'default' : 'pointer',
          display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', justifyContent: 'center', gap: 2, textAlign: 'center',
          bgcolor: over ? 'action.hover' : 'transparent', opacity: disabled ? 0.6 : 1,
        }}
      >
        {shown ? <Box component="img" src={shown} alt="" sx={{ maxHeight: 140, maxWidth: '100%', objectFit: 'contain', borderRadius: 0.5 }} /> : <AddPhotoAlternateOutlinedIcon color="action" />}
        <Typography variant="body2" color="text.secondary">{value ? value.name : label}</Typography>
        <input
          ref={inputRef} type="file" accept={accept} hidden data-testid="image-drop-input"
          onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ''; }}
        />
      </Box>
      {value ? <Button size="small" onClick={() => onChange(null)} sx={{ minHeight: 44 }}>{removeLabel}</Button> : null}
      {error ? <FormHelperText error role="alert">{error}</FormHelperText> : (helperText ? <FormHelperText>{helperText}</FormHelperText> : null)}
    </Box>
  );
}
