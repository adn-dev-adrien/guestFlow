/**
 * SuggestedArticlesStep — the generic « Proposés à l'arrivée » step of a SAS (specs/outside-booking-sas.md rules 35-38): the articles suggested for a sale context as one-tap chips,
 * an « Autre article » search, the added lines below with a quantity stepper, « Offrir » and « Retirer », and the server's refusals under their line.
 *
 * Generic and prop-driven: it knows no resource, stay, drink or plugin. It renders what the server answered and tells its parent what the operator did; it adds, prices and
 * bounds nothing (CLAUDE.md §6.0). The only checks here are UX hints (an empty quantity); the server's refusal is the one that rejects.
 *
 * Props:
 *   suggestions   [{ articleRef, label, unitCents, max }] — the chips (the server's `suggestions`)
 *   search        async (q) => [{ articleRef, label, unitCents, max, category }] — the « Autre article » search; absent = no search button
 *   draft         [{ articleRef, label, quantity, max, offered }] — what the operator added and nothing has stored yet (the parent owns it)
 *   draftLines    [{ detail, totalCents, catalogueCents } | null] — the server's quote of each draft entry, in the same order (null while it is pending)
 *   storedLines   [{ id, label, detail, totalCents, catalogueCents, offered, status, statusLabel }] — the extras already on the sale
 *   refusals      [{ field, code, error }] — the server's refusals; `field` is the article reference of a draft entry
 *   pending       boolean — a quote is in flight (figures dimmed)
 *   disabled      boolean — nothing can be changed (read-only visit)
 *   busyId        the id of the stored line being changed
 *   onAdd(article)        a chip or a search result was chosen
 *   onDraftChange(index, patch)  `{ quantity }` or `{ offered }`
 *   onDraftRemove(index)
 *   onStoredOffer(line, offered) / onStoredRemove(line)   an explicit action on a stored line (omit onStoredRemove to hide « Retirer »)
 *   title         the step's heading (default « Proposés à l'arrivée »)
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, CircularProgress, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import SearchIcon from '@mui/icons-material/Search';
import { formatCurrency } from '../utils/formatters';

const TEXTS = Object.freeze({
  title: 'Proposés à l’arrivée',
  other: 'Autre article',
  searchLabel: 'Chercher un article',
  searchEmpty: 'Aucun article vendable ne correspond.',
  searchFailed: 'Recherche impossible.',
  offer: 'Offrir',
  offered: 'Offert',
  remove: 'Retirer',
  quantity: 'Quantité',
  less: 'Un de moins',
  more: 'Un de plus',
  quantityHint: 'Quantité : un nombre entier.',
  empty: 'Aucun article ajouté.',
});

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);
const SEARCH_DELAY = 250;

function Money({ line }) {
  const struck = line.offered && Number(line.catalogueCents) > 0;
  return (
    <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right' }}>
      {struck && <Box component="del" sx={{ color: 'text.secondary', fontWeight: 400, mr: 0.75 }}>{euros(line.catalogueCents)}</Box>}
      {euros(line.totalCents)}
    </Typography>
  );
}

function Stepper({ value, max, onChange, disabled, invalid, label }) {
  const [text, setText] = useState(String(value));
  const [hint, setHint] = useState(null);
  useEffect(() => { setText(String(value)); setHint(null); }, [value]);
  const commit = (raw) => {
    setText(raw);
    if (!/^\d+$/.test(raw.trim())) { setHint(raw.trim() === '' ? null : TEXTS.quantityHint); return; }
    setHint(null);
    onChange(Number(raw.trim()));
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Box role="group" aria-label={`${TEXTS.quantity} ${label}`} sx={{ display: 'inline-flex', alignItems: 'center', border: 1, borderColor: invalid || hint ? 'error.main' : 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
        <IconButton aria-label={TEXTS.less} disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} sx={{ width: 44, height: 44 }}><RemoveIcon fontSize="small" /></IconButton>
        <TextField
          value={text}
          onChange={(e) => commit(e.target.value)}
          disabled={disabled}
          variant="standard"
          slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `${TEXTS.quantity} ${label}`, 'aria-invalid': Boolean(invalid || hint), style: { textAlign: 'center', width: 40, fontSize: 16, fontVariantNumeric: 'tabular-nums' } }, input: { disableUnderline: true } }}
        />
        <IconButton aria-label={TEXTS.more} disabled={disabled || (max != null && value >= max)} onClick={() => onChange(value + 1)} sx={{ width: 44, height: 44 }}><AddIcon fontSize="small" /></IconButton>
      </Box>
      {hint && <Typography role="alert" variant="caption" color="error">{hint}</Typography>}
    </Box>
  );
}

function Row({ name, detail, line, children, refusal, fresh }) {
  return (
    <Box
      component="li"
      sx={{
        display: 'grid', gap: 1, py: 1.25, borderBottom: 1, borderColor: 'divider', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' }, alignItems: 'center',
        animation: fresh ? 'lineIn 150ms ease-out' : 'none',
        '@keyframes lineIn': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Typography>
        {detail && <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{detail}</Typography>}
        {refusal && <Typography role="alert" variant="caption" color="error" sx={{ display: 'block' }}>{refusal}</Typography>}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, justifyContent: { xs: 'space-between', sm: 'flex-end' } }}>
        {children}
        {line && <Money line={line} />}
      </Box>
    </Box>
  );
}

export default function SuggestedArticlesStep({
  suggestions = [], search = null, draft = [], draftLines = [], storedLines = [], refusals = [], pending = false, disabled = false, busyId = null,
  onAdd, onDraftChange, onDraftRemove, onStoredOffer, onStoredRemove, title = TEXTS.title,
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [searchError, setSearchError] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!searching || !search) return undefined;
    const ticket = ++latest.current;
    setFound(null);
    setSearchError(false);
    const timer = setTimeout(() => {
      Promise.resolve().then(() => search(query)).then((list) => { if (ticket === latest.current) setFound(list); }).catch(() => { if (ticket === latest.current) setSearchError(true); });
    }, query ? SEARCH_DELAY : 0);
    return () => clearTimeout(timer);
  }, [searching, query, search]);

  const refusalOf = (articleRef) => {
    const hit = refusals.find((r) => r.field === articleRef);
    return hit ? hit.error : null;
  };
  const choose = (article) => { onAdd(article); setSearching(false); setQuery(''); };
  const empty = draft.length === 0 && storedLines.length === 0;
  const byCategory = (found || []).reduce((acc, item) => {
    const key = item.category || '';
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});

  return (
    <Box component="section" aria-label={title} sx={{ display: 'grid', gap: 1.25 }}>
      <Typography variant="subtitle2">{title}</Typography>
      {(suggestions.length > 0 || search) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {suggestions.map((s) => (
            <Chip
              key={s.articleRef}
              clickable
              disabled={disabled}
              onClick={() => choose(s)}
              label={<><span>{s.label}</span><Box component="b" sx={{ ml: 0.75, fontVariantNumeric: 'tabular-nums' }}>{euros(s.unitCents)}</Box></>}
              variant="outlined"
              sx={{ minHeight: 44, borderRadius: 22, px: 0.5, fontSize: '0.9rem' }}
            />
          ))}
          {search && (
            <Button size="small" variant={searching ? 'contained' : 'text'} disabled={disabled} onClick={() => setSearching((v) => !v)} startIcon={<SearchIcon />} sx={{ minHeight: 44, textTransform: 'none' }}>
              {TEXTS.other}
            </Button>
          )}
        </Box>
      )}
      {searching && search && (
        <Box sx={{ display: 'grid', gap: 1, p: 1.25, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
          <TextField
            autoFocus
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={TEXTS.searchLabel}
            slotProps={{ htmlInput: { 'aria-label': TEXTS.searchLabel, style: { fontSize: 16 } }, input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          />
          {found === null && !searchError && <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}><CircularProgress size={20} aria-label="Recherche en cours" /></Box>}
          {searchError && <Typography role="alert" variant="caption" color="error">{TEXTS.searchFailed}</Typography>}
          {found && found.length === 0 && <Typography variant="caption" color="text.secondary">{TEXTS.searchEmpty}</Typography>}
          {found && Object.keys(byCategory).map((category) => (
            <Box key={category || 'none'} sx={{ display: 'grid', gap: 0.5 }}>
              {category && <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{category}</Typography>}
              {byCategory[category].map((item) => (
                <Button key={item.articleRef} onClick={() => choose(item)} sx={{ justifyContent: 'space-between', textTransform: 'none', minHeight: 44, textAlign: 'left' }}>
                  <span>{item.label}</span><Box component="b" sx={{ fontVariantNumeric: 'tabular-nums' }}>{euros(item.unitCents)}</Box>
                </Button>
              ))}
            </Box>
          ))}
        </Box>
      )}
      {empty ? (
        <Typography variant="caption" color="text.secondary">{TEXTS.empty}</Typography>
      ) : (
        <Box component="ul" aria-label={title} sx={{ listStyle: 'none', m: 0, p: 0, opacity: pending ? 0.6 : 1, transition: 'opacity 120ms' }}>
          {storedLines.map((line) => (
            <Row key={`stored-${line.id}`} name={line.label} detail={[line.detail, line.statusLabel].filter(Boolean).join(' · ')} line={line}>
              <Box sx={{ display: 'flex', gap: 0.75 }}>
                {line.status !== 'cancelled' && (
                  <Button size="small" variant={line.offered ? 'contained' : 'outlined'} aria-pressed={line.offered} disabled={disabled || busyId === line.id} onClick={() => onStoredOffer(line, !line.offered)} sx={{ minHeight: 44, minWidth: 44, textTransform: 'none' }}>
                    {line.offered ? TEXTS.offered : TEXTS.offer}
                  </Button>
                )}
                {onStoredRemove && line.status !== 'cancelled' && (
                  <Button size="small" color="error" disabled={disabled || busyId === line.id} onClick={() => onStoredRemove(line)} sx={{ minHeight: 44, minWidth: 44, textTransform: 'none' }}>{TEXTS.remove}</Button>
                )}
              </Box>
            </Row>
          ))}
          {draft.map((entry, index) => {
            const line = draftLines[index] || null;
            const refusal = refusalOf(entry.articleRef);
            return (
              <Row key={`draft-${index}-${entry.articleRef}`} fresh name={entry.label} detail={line ? line.detail : null} line={line} refusal={refusal}>
                <Stepper value={entry.quantity} max={entry.max} disabled={disabled} invalid={Boolean(refusal)} label={entry.label} onChange={(quantity) => onDraftChange(index, { quantity })} />
                <Box sx={{ display: 'flex', gap: 0.75 }}>
                  <Button size="small" variant={entry.offered ? 'contained' : 'outlined'} aria-pressed={Boolean(entry.offered)} disabled={disabled} onClick={() => onDraftChange(index, { offered: !entry.offered })} sx={{ minHeight: 44, minWidth: 44, textTransform: 'none' }}>
                    {entry.offered ? TEXTS.offered : TEXTS.offer}
                  </Button>
                  <Button size="small" color="error" disabled={disabled} onClick={() => onDraftRemove(index)} sx={{ minHeight: 44, minWidth: 44, textTransform: 'none' }}>{TEXTS.remove}</Button>
                </Box>
              </Row>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
