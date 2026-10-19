/**
 * EmailPreviewPane — a rendered email as the guest reads it (specs/guest-email-texts-made-simple.md
 * rules 13–15). Generic: it renders what the server rendered and owns no rule.
 *
 * Props:
 *   subject, body          strings — the server's rendering (plain text, as sent)
 *   html                   string — the HTML part the server derives from `body` (rule 37); given, a
 *                          « Texte | HTML » switch shows either part, the HTML in a sandboxed frame
 *   loading                boolean — a new rendering is on its way
 *   error                  string — shown instead of the email
 *   language               'fr' | 'en';  onLanguageChange(lang)
 *   notice                 string — the server's « Texte anglais manquant … »
 *   reservations           [{ id, label }] — the stays this email could be shown on
 *   reservationId          number | 'sample';  onReservationChange(value)
 *   onSendTest             () => void — omit to hide « M'envoyer un test »
 *   testMessage            ReactNode — the result of the last test
 *   sx
 */
import React, { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, FormControl, InputLabel, MenuItem, Select,
  Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

export const SAMPLE = 'sample';

export default function EmailPreviewPane({
  subject = '', body = '', loading = false, error = '', language = 'fr', onLanguageChange, notice,
  reservations = [], reservationId = SAMPLE, onReservationChange, onSendTest, testMessage, sx, html = '',
}) {
  const [part, setPart] = useState('text');
  const showHtml = Boolean(html) && part === 'html';
  return (
    <Card variant="outlined" sx={sx}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
          {onLanguageChange && (
            <ToggleButtonGroup size="small" exclusive value={language} onChange={(e, v) => v && onLanguageChange(v)} aria-label="Langue de l’aperçu">
              <ToggleButton value="fr" sx={{ minWidth: 44 }}>FR</ToggleButton>
              <ToggleButton value="en" sx={{ minWidth: 44 }}>EN</ToggleButton>
            </ToggleButtonGroup>
          )}
          {onReservationChange && (
            <FormControl size="small" sx={{ flex: 1, minWidth: 160 }}>
              <InputLabel id="preview-reservation">Réservation</InputLabel>
              <Select labelId="preview-reservation" label="Réservation" value={reservationId} onChange={(e) => onReservationChange(e.target.value)}>
                {reservations.map((r) => <MenuItem key={r.id} value={r.id}>{r.label}</MenuItem>)}
                <MenuItem value={SAMPLE}>Exemple</MenuItem>
              </Select>
            </FormControl>
          )}
          {html && (
            <ToggleButtonGroup size="small" exclusive value={part} onChange={(e, v) => v && setPart(v)} aria-label="Partie de l’email">
              <ToggleButton value="text" sx={{ minWidth: 44, textTransform: 'none' }}>Texte</ToggleButton>
              <ToggleButton value="html" sx={{ minWidth: 44, textTransform: 'none' }}>HTML</ToggleButton>
            </ToggleButtonGroup>
          )}
          {loading && <CircularProgress size={18} aria-label="Aperçu en cours" />}
        </Stack>
        {notice && <Alert severity="warning" sx={{ mb: 1.5 }}>{notice}</Alert>}
        {error ? <Alert severity="error">{error}</Alert> : (
          <Box data-testid="email-preview" sx={{ bgcolor: 'background.default', borderRadius: 1, p: { xs: 1.5, sm: 2 }, opacity: loading ? 0.6 : 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{subject}</Typography>
            {showHtml ? (
              <Box
                component="iframe"
                title="Email en HTML"
                sandbox=""
                srcDoc={html}
                sx={{ display: 'block', width: '100%', height: { xs: 520, md: 640 }, border: 0, borderRadius: 1, bgcolor: 'background.paper' }}
              />
            ) : (
              <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'Georgia, serif' }}>
                {body}
              </Typography>
            )}
          </Box>
        )}
        {onSendTest && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5, alignItems: { sm: 'center' } }}>
            <Button variant="outlined" startIcon={<SendIcon />} onClick={onSendTest} sx={{ minHeight: 44 }}>M’envoyer un test</Button>
            {testMessage && <Typography variant="body2" color="text.secondary">{testMessage}</Typography>}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
