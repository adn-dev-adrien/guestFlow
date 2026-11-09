/**
 * PhonePreview — the phone frame of the studio (specs/guest-app.md rule 49): the guest app's real components, drawn
 * in an iframe (`preview.html`) so the guest app's styles never reach the studio. The parent screen hands the
 * `view` to draw; the frame redraws on every change, without a network round trip.
 *
 * Props:
 *   view     { view: 'home'|'page'|'shop', lodgingName, … } — see preview/PreviewApp.jsx for each view's fields
 *   title    string — « Aperçu · La Granja »
 *   caption  string — the line under the phone (« Ce que verront les clients après « Enregistrer ». »)
 *   lang / onLang  the preview's language, FR / EN
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';

export const MESSAGE_SOURCE = 'guestflow-studio';
const FRAME_URL = `${import.meta.env.BASE_URL}preview.html`;

export default function PhonePreview({ view, title, caption, lang, onLang }) {
  const frame = useRef(null);
  const [ready, setReady] = useState(false);
  const [night, setNight] = useState(false);

  const post = useCallback(() => {
    const target = frame.current && frame.current.contentWindow;
    if (!target || !view) return;
    target.postMessage({ ...view, lang, night, source: MESSAGE_SOURCE }, window.location.origin);
  }, [view, lang, night]);

  useEffect(() => {
    const receive = (event) => {
      if (event.origin === window.location.origin && event.data && event.data.source === MESSAGE_SOURCE && event.data.ready) setReady(true);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => { if (ready) post(); }, [ready, post]);

  return (
    <Box component="aside" aria-label={title} sx={{ display: 'grid', gap: 1.5, justifyItems: 'center', alignContent: 'start' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, width: '100%', maxWidth: 320 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>{title}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title={night ? 'Voir de jour' : 'Voir de nuit'}>
            <IconButton size="small" onClick={() => setNight((n) => !n)} aria-label={night ? 'Voir l’aperçu de jour' : 'Voir l’aperçu de nuit'} sx={{ width: 44, height: 44 }}>
              {night ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <ToggleButtonGroup size="small" exclusive value={lang} onChange={(e, next) => next && onLang(next)} aria-label="Langue de l’aperçu">
            <ToggleButton value="fr" aria-label="Aperçu en français" sx={{ minWidth: 44, minHeight: 36 }}>FR</ToggleButton>
            <ToggleButton value="en" aria-label="Aperçu en anglais" sx={{ minWidth: 44, minHeight: 36 }}>EN</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>
      <Box
        sx={{
          width: 300, height: 620, p: '10px', borderRadius: '44px', bgcolor: '#1b1f1a', boxShadow: '0 18px 40px rgba(22,28,22,.22)', flexShrink: 0,
        }}
      >
        <Box
          component="iframe"
          ref={frame}
          src={FRAME_URL}
          title={`${title} — téléphone`}
          sx={{ width: '100%', height: '100%', border: 0, borderRadius: '34px', display: 'block', bgcolor: '#F5F0E6' }}
        />
      </Box>
      {caption ? <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 300 }}>{caption}</Typography> : null}
    </Box>
  );
}
