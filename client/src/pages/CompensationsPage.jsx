import React, { useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Box, IconButton, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PageActionBar from '../components/PageActionBar';
import CancellationCompensationsSection from '../components/CancellationCompensationsSection';
import { useAuth } from '../hooks/useAuth';
import { ADMIN, userHasRole } from '../constants/roles';
import { MONTH_LABELS } from '../constants/months';

/**
 * « Indemnités d'annulation » — Suivi financier (specs/plugins-phase-2-hosts.md rule 21, P7).
 *
 * Core page: the compensations banked in the chosen month and, whatever the month, the pending ones.
 * The admin adds, banks, reopens, edits and deletes them; the accountant reads (the server refuses
 * their writes). The month sits centred in the bar on sm+, on its own strip under it on xs.
 */

function shiftMonth({ month, year }, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

export default function CompensationsPage() {
  const { user } = useAuth();
  const canEdit = userHasRole(user, ADMIN);
  const sectionRef = useRef(null);
  const today = useMemo(() => new Date(), []);

  // Month and year live in the URL, so the back button restores them after opening a stay.
  const [searchParams, setSearchParams] = useSearchParams();
  const month = (() => {
    const m = Number(searchParams.get('month'));
    return Number.isInteger(m) && m >= 1 && m <= 12 ? m : today.getMonth() + 1;
  })();
  const year = (() => {
    const y = Number(searchParams.get('year'));
    return Number.isInteger(y) && y >= 2000 && y <= 9999 ? y : today.getFullYear();
  })();
  const go = (delta) => {
    const next = shiftMonth({ month, year }, delta);
    setSearchParams({ month: String(next.month), year: String(next.year) }, { replace: true });
  };

  const monthNav = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <IconButton size="small" onClick={() => go(-1)} aria-label="Mois précédent">
        <NavigateBeforeIcon />
      </IconButton>
      <Typography variant="body1" sx={{ fontWeight: 600, minWidth: 140, textAlign: 'center' }} aria-live="polite">
        {MONTH_LABELS[month - 1]} {year}
      </Typography>
      <IconButton size="small" onClick={() => go(1)} aria-label="Mois suivant">
        <NavigateNextIcon />
      </IconButton>
    </Box>
  );

  return (
    <Box>
      <PageActionBar
        title="Indemnités d'annulation"
        titleOnXs
        center={monthNav}
        actionsBefore={canEdit ? [{
          icon: <AddIcon />,
          tooltip: 'Ajouter une indemnité',
          ariaLabel: 'Ajouter',
          onClick: () => sectionRef.current && sectionRef.current.openCreate(),
          color: 'primary',
        }] : []}
      />
      {/* xs: the bar hides its centre, so the month gets a strip of its own. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', mb: 2 }}>
        {monthNav}
      </Box>
      <Box sx={{ maxWidth: { xs: '100%', md: 1040 }, mx: 'auto', px: { xs: 0, sm: 1 } }}>
        <CancellationCompensationsSection ref={sectionRef} month={month} year={year} canEdit={canEdit} />
      </Box>
    </Box>
  );
}
