/**
 * IntakeBanner — the banner an intake plugin shows at the top of a fiche (slot `reservation.banners`)
 * to say what a platform's mail or page did to it (specs/airbnb-mail-intake.md §4.1). Presentational:
 * each plugin fetches its intake, maps its status to these props and keeps its own copy.
 *
 * Props:
 *   severity   'success' | 'info' | 'warning' | 'error'
 *   title?     node                       AlertTitle
 *   children   node                       the message
 *   details?   Array<{ key, text }>       a bullet list under the message
 *   notes?     node[]                     extra lines (« Ajouté tel quel … »)
 *   choices?   Array<{ key, label, caption?, onClick }>   one bordered button per option
 *   actions?   Array<{ key, label, onClick, variant? }>   buttons under the message ('contained' first)
 *   link?      { href, label }            opens in a new tab
 *   onClose?   () => void                 shows the close icon (hidden while busy)
 *   busy?      boolean                    disables every button
 *   error?     string                     inline error under the buttons
 */
import React from 'react';
import { Alert, AlertTitle, Box, Button, Link, Stack, Typography } from '@mui/material';

const fullOnXs = { flex: { xs: '1 1 100%', sm: '0 0 auto' }, minHeight: 44 };

export default function IntakeBanner({
  severity, title, children, details = [], notes = [], choices = [], actions = [], link, onClose, busy = false, error = '',
}) {
  return (
    <Alert severity={severity} sx={{ mb: 2 }} onClose={onClose && !busy ? onClose : undefined}>
      {title && <AlertTitle>{title}</AlertTitle>}
      {children}
      {details.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {details.map((d) => <li key={d.key}><Typography variant="body2">{d.text}</Typography></li>)}
        </Box>
      )}
      {notes.filter(Boolean).map((note, i) => (
        <Typography key={i} variant="body2" sx={{ mt: 0.5 }}>{note}</Typography>
      ))}
      {choices.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${choices.length}, minmax(0, 200px))` }, gap: 1, mt: 1 }}>
          {choices.map((c) => (
            <Button
              key={c.key}
              variant="outlined"
              color="inherit"
              disabled={busy}
              onClick={c.onClick}
              sx={{ minHeight: 44, justifyContent: 'flex-start', textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start' }}
            >
              <span>{c.label}</span>
              {c.caption && <Typography component="span" variant="caption">{c.caption}</Typography>}
            </Button>
          ))}
        </Box>
      )}
      {actions.length > 0 && (
        <Stack direction="row" gap={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <Button
              key={a.key}
              size="small"
              variant={a.variant || 'outlined'}
              color={a.variant === 'contained' ? 'primary' : 'inherit'}
              disabled={busy}
              sx={fullOnXs}
              onClick={a.onClick}
            >
              {a.label}
            </Button>
          ))}
        </Stack>
      )}
      {link && link.href && (
        <Link href={link.href} target="_blank" rel="noopener noreferrer" sx={{ display: 'block', width: 'fit-content', mt: 1, minHeight: 24 }}>
          {link.label}
        </Link>
      )}
      {error && <Typography variant="body2" color="error" sx={{ mt: 1 }}>{error}</Typography>}
    </Alert>
  );
}
