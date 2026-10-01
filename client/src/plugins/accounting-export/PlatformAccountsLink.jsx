import React from 'react';
import { Link as RouterLink } from 'react-router';
import { Link, Typography } from '@mui/material';

/**
 * The « Plan comptable » pointer of the settings pages (slot `settings.platforms.links`,
 * specs/plugins-phase-2-hosts.md rule 19). Without the accounting export the accounts and their rates
 * are nowhere to edit, so the sentence goes with the plugin.
 *
 * Props:
 *   page  'platforms' — a sentence inside the page's info alert;
 *         'vat'       — a caption under the VAT section.
 */
export default function PlatformAccountsLink({ page }) {
  const link = <Link component={RouterLink} to="/comptabilite/plateformes">Plan comptable</Link>;
  if (page === 'vat') {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5, mb: 3 }}>
        Les taux sur les commissions et les indemnités d&apos;annulation se règlent dans le {link}.
      </Typography>
    );
  }
  return <> Les comptes comptables se règlent dans le {link}.</>;
}
