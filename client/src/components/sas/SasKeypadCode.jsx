import React from 'react';
import { Stack, Typography } from '@mui/material';

/**
 * SasKeypadCode — the property's gate keypad code, large and dictable (specs/arrival-departure-sas.md
 * §3.5; specs/plugins-phase-1-sdk.md rule 17). A SAS fact: shown by the « Portail » step on its own,
 * or under the Sowel key when the gate-access plugin has one for the stay.
 *
 * Props:
 *   portalCode  string   the code (Établissement); renders nothing when empty
 *   secondary   boolean  smaller, labelled as the fallback beside a Sowel key
 */
export default function SasKeypadCode({ portalCode, secondary = false }) {
  if (!portalCode) return null;
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'center', pt: secondary ? 1.5 : 0 }}>
      <Typography variant="body2" color="text.secondary">
        {secondary ? 'Secours — code du clavier du portail :' : 'Code du portail à communiquer au client :'}
      </Typography>
      {/* A code is digits and letters → kpiValue (sans, tabular): never serif. */}
      <Typography variant="kpiValue" sx={{ fontSize: secondary ? '1.6rem' : '2.6rem', letterSpacing: 2 }}>
        {portalCode}
      </Typography>
    </Stack>
  );
}
