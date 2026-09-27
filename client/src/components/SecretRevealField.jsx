/**
 * SecretRevealField — a read-only value to copy elsewhere, masked until asked for
 * (API keys, signing secrets, addresses another system must be given).
 *
 * Unlike MaskedTextField, which edits a stored secret, this one only DISPLAYS a value the server
 * handed over: « Afficher » reveals it, « Copier » puts it on the clipboard without revealing it.
 *
 * Props:
 *   label:       string              (required)
 *   value:       string              (required; '' renders the placeholder)
 *   masked?:     boolean             (default true — false shows the value from the start, no toggle)
 *   helperText?: ReactNode
 *   placeholder?: string             (default '—')
 */
import React, { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';

const MASK = '••••••••••••••••';

export default function SecretRevealField({ label, value, masked = true, helperText, placeholder = '—' }) {
  const [shown, setShown] = useState(!masked);
  const [copied, setCopied] = useState(false);
  const hasValue = Boolean(value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
        <Box
          sx={{
            flex: 1, minWidth: 0, px: 1.5, py: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1,
            fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-all',
          }}
          data-testid="secret-value"
        >
          {!hasValue ? placeholder : shown ? value : MASK}
        </Box>
        <Stack direction="row" spacing={1}>
          {masked ? (
            <Button
              variant="outlined" size="small" disabled={!hasValue} onClick={() => setShown((s) => !s)}
              sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }} aria-label={`${shown ? 'Masquer' : 'Afficher'} — ${label}`}
            >
              {shown ? 'Masquer' : 'Afficher'}
            </Button>
          ) : null}
          <Button
            variant="outlined" size="small" disabled={!hasValue} onClick={copy}
            sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }} aria-label={`Copier — ${label}`}
          >
            {copied ? 'Copié' : 'Copier'}
          </Button>
        </Stack>
      </Stack>
      {helperText ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {helperText}
        </Typography>
      ) : null}
    </Box>
  );
}
