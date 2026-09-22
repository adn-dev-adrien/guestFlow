/**
 * MarkdownEditorField — a Markdown textarea with the rendering produced by the SERVER next to it (the
 * client never parses Markdown). Side by side from `md`, one at a time below with an « Aperçu »
 * toggle.
 *
 * Props:
 *   label:          string                 — accessible name of the textarea
 *   value:          string
 *   onChange:       (value: string) => void
 *   previewHtml:    string                 — the server rendering of `value` (may lag while typing)
 *   previewLoading?: boolean
 *   disabled?:      boolean
 *   helper?:        ReactNode              — shown under the textarea (e.g. the variables list)
 *   minRows?:       number                 — default 18
 */
import React, { useState } from 'react';
import {
  Box, Button, LinearProgress, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SandboxedHtmlFrame from './SandboxedHtmlFrame';

export default function MarkdownEditorField({
  label, value, onChange, previewHtml, previewLoading = false, disabled = false, helper = null, minRows = 18,
}) {
  const theme = useTheme();
  const stacked = useMediaQuery(theme.breakpoints.down('md'));
  const [showPreview, setShowPreview] = useState(false);

  const editor = (
    <Box sx={{ minWidth: 0 }}>
      <TextField
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        multiline
        minRows={minRows}
        fullWidth
        slotProps={{ htmlInput: { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 } } }}
      />
      {helper && <Box sx={{ mt: 1 }}>{helper}</Box>}
    </Box>
  );

  const preview = (
    <Box sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">Aperçu</Typography>
      </Box>
      {previewLoading ? <LinearProgress /> : <Box sx={{ height: 4 }} />}
      <SandboxedHtmlFrame html={previewHtml} title={`Aperçu — ${label}`} minHeight={{ xs: '50vh', md: 420 }} />
    </Box>
  );

  if (stacked) {
    return (
      <Box>
        <Button size="small" onClick={() => setShowPreview((v) => !v)} sx={{ mb: 1, minHeight: 44 }}>
          {showPreview ? 'Revenir au texte' : 'Aperçu'}
        </Button>
        {showPreview ? preview : editor}
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
      {editor}
      {preview}
    </Box>
  );
}
