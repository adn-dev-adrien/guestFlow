/**
 * ChartMenu — the « ⋯ » menu of every report chart (specs/report-grammar.md rule 10): « Voir en
 * tableau » / « Voir le graphique » toggles the view, « Copier les données » puts the chart's data on
 * the clipboard as CSV and says whether it worked (a browser may refuse). Generic: any chart.
 *
 * Props:
 *   view:          'chart' | 'table'
 *   onViewChange:  (next: 'chart' | 'table') => void
 *   getCsv:        () => string        the data, built on demand (utils/reportChart.toCsv)
 *   ariaLabel?:    string              default « Options du graphique »
 */
import React, { useEffect, useRef, useState } from 'react';
import { IconButton, Menu, MenuItem } from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';

export const COPY_DONE = 'Données copiées';
export const COPY_REFUSED = 'Copie refusée par le navigateur';

export default function ChartMenu({ view, onViewChange, getCsv, ariaLabel = 'Options du graphique' }) {
  const [anchor, setAnchor] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = () => { clearTimeout(timer.current); setAnchor(null); setCopyStatus(null); };
  const copy = async () => {
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(getCsv());
        ok = true;
      }
    } catch {
      ok = false;
    }
    setCopyStatus(ok ? COPY_DONE : COPY_REFUSED);
    timer.current = setTimeout(close, 1200);
  };
  return (
    <>
      <IconButton
        size="small"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ border: 1, borderColor: 'divider', borderRadius: '9px', width: 36, height: 36, flex: 'none', color: 'text.secondary' }}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={() => { onViewChange(view === 'table' ? 'chart' : 'table'); close(); }} sx={{ minHeight: 44 }}>
          {view === 'table' ? 'Voir le graphique' : 'Voir en tableau'}
        </MenuItem>
        <MenuItem onClick={copyStatus ? undefined : copy} sx={{ minHeight: 44 }}>
          <span aria-live="polite">{copyStatus || 'Copier les données'}</span>
        </MenuItem>
      </Menu>
    </>
  );
}
