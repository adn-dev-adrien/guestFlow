import React, { useState } from 'react';
import { TextField } from '@mui/material';

/**
 * TextField that intercepts a drag & drop instead of letting the browser insert the raw payload.
 *
 * Dropping a link from a web page normally writes its href verbatim (`mailto:…?subject=…`,
 * `tel:+33…`). This wrapper cancels that default, hands the raw payload to `onDropText` and lets the
 * caller decide what to write in the field — in GuestFlow, the string is sent to the server for
 * cleanup (specs/client-contact-smart-input.md). No parsing happens here.
 *
 * Props:
 * - `onDropText(raw: string)` — called with the dropped payload (`text/uri-list` first, then
 *   `text/plain`), trimmed. Omit it and the field behaves like a plain TextField.
 * - every other prop is forwarded to MUI's `TextField`.
 *
 * The field highlights (primary border + tinted background) while a drag hovers it.
 */
export default function DroppableTextField({ onDropText, sx, ...props }) {
  const [dragOver, setDragOver] = useState(false);

  // `text/uri-list` may hold several lines and `#` comments — the first real URI is the one dropped.
  const readPayload = (dataTransfer) => {
    if (!dataTransfer) return '';
    const uriList = dataTransfer.getData('text/uri-list') || '';
    const firstUri = uriList.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    return (firstUri || dataTransfer.getData('text/plain') || '').trim();
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    const raw = readPayload(event.dataTransfer);
    if (raw && onDropText) onDropText(raw);
  };

  return (
    <TextField
      {...props}
      onDragOver={(event) => { if (onDropText) { event.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDropText ? handleDrop : undefined}
      sx={{
        ...(dragOver ? {
          '& .MuiOutlinedInput-root': {
            bgcolor: 'action.hover',
            '& fieldset': { borderColor: 'primary.main', borderWidth: 2 },
          },
        } : {}),
        ...sx,
      }}
    />
  );
}
