/**
 * LogoUpload — generic image upload widget with preview + replace + delete.
 *
 * Used by Settings (company logo) and reusable for any single-image upload
 * field (property photos, etc.).
 *
 * Props:
 *   value:       string                       — current image URL/path ('' when none)
 *   onUpload:    (file: File) => Promise<any> — called with the picked file
 *   onDelete:    () => Promise<any>           — called to remove the image
 *   accept?:     string                       — file input accept attr (default 'image/*')
 *   maxSizeMb?:  number                       — client-side size guard in MB (default 2)
 *   placeholder?: string                      — text shown when no image (default 'Aucun logo')
 *   helperText?: ReactNode                    — helper text shown below the row
 *   disabled?:   boolean
 *   pickLabel?:  string                       — default 'Choisir un logo'
 *   replaceLabel?: string                     — default 'Remplacer le logo'
 *   deleteTooltip?: string                    — default 'Supprimer le logo'
 */
import React, { useRef, useState } from 'react';
import { Box, Button, IconButton, Tooltip, Stack, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

export default function LogoUpload({
  value,
  onUpload,
  onDelete,
  accept = 'image/*',
  maxSizeMb = 2,
  placeholder = 'Aucun logo',
  helperText,
  disabled = false,
  pickLabel = 'Choisir un logo',
  replaceLabel = 'Remplacer le logo',
  deleteTooltip = 'Supprimer le logo',
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handlePick = () => {
    setError('');
    if (inputRef.current) inputRef.current.click();
  };

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError('');
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`Fichier trop volumineux (max ${maxSizeMb} Mo).`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err.message || "Erreur lors de l'upload.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    setError('');
    setBusy(true);
    try {
      await onDelete();
    } catch (err) {
      setError(err.message || 'Erreur lors de la suppression.');
    } finally {
      setBusy(false);
    }
  };

  const showImage = Boolean(value);

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1.5, sm: 2 }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
      >
        {showImage ? (
          <Box
            component="img"
            src={value}
            alt="Logo"
            sx={{
              height: 64,
              maxWidth: 200,
              objectFit: 'contain',
              border: '1px solid #eee',
              borderRadius: 1,
              p: 0.5,
              bgcolor: '#fafafa',
            }}
          />
        ) : (
          <Box
            sx={{
              height: 64,
              width: 140,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="caption" color="text.disabled">{placeholder}</Typography>
          </Box>
        )}
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={handlePick}
            disabled={disabled || busy}
          >
            {busy ? 'Chargement…' : (showImage ? replaceLabel : pickLabel)}
          </Button>
          {showImage && (
            <Tooltip title={deleteTooltip}>
              <span>
                <IconButton
                  size="small"
                  color="error"
                  onClick={handleDelete}
                  disabled={disabled || busy}
                  aria-label={deleteTooltip}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      {(error || helperText) && (
        <Typography
          variant="caption"
          color={error ? 'error' : 'text.secondary'}
          sx={{ display: 'block', mt: 0.75 }}
        >
          {error || helperText}
        </Typography>
      )}
    </Box>
  );
}
