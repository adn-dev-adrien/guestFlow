/**
 * SandboxedHtmlFrame — renders server-produced HTML in an iframe with an empty `sandbox`: no script,
 * no same-origin access, no form, no navigation of the app. The one way GuestFlow shows an HTML
 * document it did not build as React (archived CGV, email bodies).
 *
 * Props:
 *   html:       string   — the document body
 *   title:      string   — accessible name of the frame (required)
 *   minHeight?: object | number — MUI sx value, default { xs: '60vh', sm: 420 }
 */
import React from 'react';
import { Box } from '@mui/material';

const FRAME_STYLE = `<style>
  body { font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #27251F; margin: 16px; }
  h2, h3 { font-family: Georgia, 'Times New Roman', serif; font-weight: 600; line-height: 1.25; }
  a { color: #2F5D46; }
</style>`;

export default function SandboxedHtmlFrame({ html, title, minHeight = { xs: '60vh', sm: 420 } }) {
  return (
    <Box
      component="iframe"
      title={title}
      sandbox=""
      srcDoc={`<!doctype html><html><head><meta charset="utf-8">${FRAME_STYLE}</head><body>${html || ''}</body></html>`}
      sx={{ border: 0, width: '100%', flex: 1, minHeight, bgcolor: 'background.paper', display: 'block' }}
    />
  );
}
