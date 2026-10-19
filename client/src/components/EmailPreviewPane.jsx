/**
 * EmailPreviewPane — a rendered email as the guest reads it (specs/guest-email-texts-made-simple.md
 * rules 13–15, 41). Generic: it renders what the server rendered and owns no rule.
 *
 * With `segments` (rule 45, UI/UX review 2026-10-18 decision 13), each sentence the server tagged with
 * its text is a button: hover marks it, a click (or Entrée) hands its key to `onSegmentClick`. The
 * template's own words call `onTemplateClick`.
 *
 * Props:
 *   subject, body          strings — the server's rendering (plain text, as sent)
 *   segments               [{ text, key }] — the same body, cut by the text each piece comes from
 *   subjectKey             the key of the subject's text, clickable like a sentence
 *   activeKey              the key of the text being edited, highlighted
 *   onSegmentClick         (key) => void
 *   onTemplateClick        () => void — a click on the template's own words
 *   html                   string — the HTML part the server derives from `body` (rule 37); given, a
 *                          « Texte | HTML » switch shows either part, the HTML in a sandboxed frame;
 *                          the sentences are clickable in « Texte » only (rule 45)
 *   loading                boolean — a new rendering is on its way
 *   error                  string — shown instead of the email
 *   stale                  string — shown above the email, kept as last rendered (a refused draft)
 *   language               'fr' | 'en';  onLanguageChange(lang) — omit to show « Aperçu · FR » only
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

const sentenceSx = (active) => ({
  borderRadius: 0.5,
  cursor: 'pointer',
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
  transition: 'background-color 120ms ease-out',
  bgcolor: active ? 'warning.soft' : 'transparent',
  '@media (hover: hover)': { '&:hover': { bgcolor: active ? 'warning.soft' : 'info.soft' } },
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '1px' },
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
});

function Sentence({ text, active, label, onOpen }) {
  return (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      aria-label={label}
      data-active={active ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      sx={sentenceSx(active)}
    >
      {text}
    </Box>
  );
}

const excerpt = (text) => text.trim().replace(/\s+/g, ' ').slice(0, 60);

export default function EmailPreviewPane({
  subject = '', body = '', segments, subjectKey, activeKey, onSegmentClick, onTemplateClick,
  loading = false, error = '', stale = '', language = 'fr', onLanguageChange, notice,
  reservations = [], reservationId = SAMPLE, onReservationChange, onSendTest, testMessage, sx, html = '',
}) {
  const [part, setPart] = useState('text');
  const showHtml = Boolean(html) && part === 'html';
  const clickable = Boolean(onSegmentClick && segments) && !showHtml;
  const piece = (s, i) => {
    if (s.key) {
      return <Sentence key={i} text={s.text} active={activeKey === s.key} label={`Modifier : ${excerpt(s.text)}`} onOpen={() => onSegmentClick(s.key)} />;
    }
    if (onTemplateClick && s.text.trim()) {
      return <Box key={i} component="span" title="Texte du modèle complet" onClick={onTemplateClick} sx={{ cursor: 'pointer' }}>{s.text}</Box>;
    }
    return <React.Fragment key={i}>{s.text}</React.Fragment>;
  };
  return (
    <Card variant="outlined" sx={sx}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
          {onLanguageChange ? (
            <ToggleButtonGroup size="small" exclusive value={language} onChange={(e, v) => v && onLanguageChange(v)} aria-label="Langue de l’aperçu">
              <ToggleButton value="fr" sx={{ minWidth: 44 }}>FR</ToggleButton>
              <ToggleButton value="en" sx={{ minWidth: 44 }}>EN</ToggleButton>
            </ToggleButtonGroup>
          ) : (
            <Typography variant="overline" color="text.secondary">{`Aperçu · ${language.toUpperCase()}`}</Typography>
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
        {stale && <Alert severity="error" sx={{ mb: 1.5 }}>{stale}</Alert>}
        {clickable && !error && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Cliquer une phrase pour la modifier.
          </Typography>
        )}
        {error ? <Alert severity="error">{error}</Alert> : (
          <Box data-testid="email-preview" sx={{ bgcolor: 'background.default', borderRadius: 1, p: { xs: 1.5, sm: 2 }, opacity: loading || stale ? 0.6 : 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>
              {clickable && subjectKey
                ? <Sentence text={subject} active={activeKey === subjectKey} label="Modifier : objet" onOpen={() => onSegmentClick(subjectKey)} />
                : subject}
            </Typography>
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
                {clickable ? segments.map(piece) : body}
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
