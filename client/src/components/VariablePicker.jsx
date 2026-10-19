/**
 * VariablePicker — the list of variables and conditions a text may use, opened on demand
 * (specs/guest-email-texts-made-simple.md rule 37 — UI/UX review 2026-10-18, decision 5). Generic:
 * any editor that inserts `{{token}}` from the server's labelled list (texts, templates, mentions).
 *
 * It replaces the wall of chips under every field: « + Variable », or the `[` key, opens it at the
 * field; typing filters by the label (« pré » → « Prénom du voyageur »); ↑ ↓ choose, Entrée inserts,
 * Échap closes.
 *
 * Props:
 *   open           boolean
 *   anchorEl       the element the list opens under (the field)
 *   variables      [{ name, label }]
 *   conditions     [{ name, label }] — shown after the variables as « Seulement si … »
 *   onPick         (entry, kind: 'var' | 'cond') => void
 *   onClose        (reason: 'escape' | 'away' | 'tab' | 'blur') => void
 *
 * Échap and Entrée stop at the list: they never reach an enclosing dialog or sheet, which would close
 * and lose what was typed. Tab or leaving the list closes it; a key typed while an input method is
 * composing is left to it.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Box, ClickAwayListener, InputAdornment, List, ListItemButton, ListItemText, ListSubheader, Paper, Popper, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

const folded = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function VariablePicker({ open, anchorEl, variables = [], conditions = [], onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const paperRef = useRef(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i) => `${uid}-option-${i}`;

  useEffect(() => { if (open) { setQuery(''); setActive(0); } }, [open]);

  const entries = useMemo(() => {
    const q = folded(query);
    const keep = (e) => !q || folded(e.label).includes(q) || folded(e.name).includes(q);
    return [
      ...variables.filter(keep).map((e) => ({ ...e, kind: 'var' })),
      ...conditions.filter(keep).map((e) => ({ ...e, kind: 'cond' })),
    ];
  }, [query, variables, conditions]);

  useEffect(() => {
    const node = listRef.current && listRef.current.querySelector('[aria-selected="true"]');
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e) => {
    if (e.nativeEvent && e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, entries.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const pick = entries[active]; if (pick) onPick(pick, pick.kind); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose('escape'); }
    else if (e.key === 'Tab') { onClose('tab'); }
  };
  // Focus leaving the list (not to one of its options) closes it.
  const onBlur = (e) => {
    if (paperRef.current && e.relatedTarget && paperRef.current.contains(e.relatedTarget)) return;
    onClose('blur');
  };

  const firstCondition = entries.findIndex((e) => e.kind === 'cond');

  return (
    <Popper open={open} anchorEl={anchorEl} placement="bottom-start" sx={{ zIndex: (t) => t.zIndex.modal + 1, width: { xs: 'calc(100vw - 32px)', sm: 340 } }}>
      <ClickAwayListener onClickAway={() => onClose('away')}>
        <Paper ref={paperRef} elevation={6} sx={{ mt: 0.5, overflow: 'hidden' }}>
          <Box sx={{ p: 1 }}>
            <TextField
              autoFocus
              size="small"
              fullWidth
              placeholder="Chercher une variable"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
              slotProps={{
                htmlInput: {
                  'aria-label': 'Chercher une variable',
                  role: 'combobox',
                  'aria-expanded': true,
                  'aria-controls': listId,
                  'aria-activedescendant': entries[active] ? optionId(active) : undefined,
                },
                input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
              }}
            />
          </Box>
          <List id={listId} role="listbox" dense ref={listRef} sx={{ maxHeight: 280, overflowY: 'auto', py: 0 }}>
            {entries.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>{`Aucune variable pour « ${query} »`}</Typography>
            )}
            {entries.map((e, i) => (
              <React.Fragment key={`${e.kind}-${e.name}`}>
                {i === firstCondition && <ListSubheader role="presentation" sx={{ lineHeight: '32px' }}>Conditions</ListSubheader>}
                <ListItemButton
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  selected={i === active}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(e, e.kind)}
                  sx={{ minHeight: 40, '@media (pointer: coarse)': { minHeight: 44 } }}
                >
                  <ListItemText primary={e.kind === 'cond' ? `Seulement si : ${e.label.replace(/^Si /i, '')}` : e.label} />
                </ListItemButton>
              </React.Fragment>
            ))}
          </List>
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}
