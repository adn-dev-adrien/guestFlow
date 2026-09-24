import React from 'react';
import Tooltip from '@mui/material/Tooltip';
import TranslateIcon from '@mui/icons-material/Translate';
import StatusBadge from './StatusBadge';

/**
 * LanguageBadge — the language a guest is written to in, as a small marker.
 *
 * Props:
 *   lang     'fr' | 'en' (anything else reads as 'fr'). Required.
 *   origin   optional explanation of WHERE the language comes from, shown in the tooltip. Without
 *            it the badge only names the language, which is rarely enough: an operator seeing « EN »
 *            needs to know whether it came from the guest's record or from the page they booked on.
 *
 * English is marked `info`, French `neutral`: French is the ordinary case here and should not
 * compete for attention, while English is the one that changes what the operator should check.
 *
 * specs/site-english-version.md §4.2 — generic on purpose, so the devis list can use it the day
 * English requests become common.
 */
export default function LanguageBadge({ lang, origin }) {
  const isEnglish = String(lang || '').toLowerCase() === 'en';
  const label = isEnglish ? 'EN' : 'FR';
  const name = isEnglish ? 'anglais' : 'français';
  const title = origin ? `${name.charAt(0).toUpperCase()}${name.slice(1)} — ${origin}` : `Écrit en ${name}`;

  return (
    <Tooltip title={title}>
      <span>
        <StatusBadge
          status={isEnglish ? 'info' : 'neutral'}
          label={label}
          icon={<TranslateIcon sx={{ fontSize: 14 }} />}
        />
      </span>
    </Tooltip>
  );
}
