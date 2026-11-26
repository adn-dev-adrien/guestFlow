/**
 * ArticleChecklistPicker — a search field and a checklist of catalogue articles, grouped by category, that STAYS OPEN after a pick so several articles are ticked in one pass
 * (specs/site/site-outside-resource-booking.md rule 36). Generic: it knows no list, no kind, no page — the host owns the selection and the server owns every judgment.
 *
 * Each row is a checkbox with the article's name and, under it, its unit price (`unitCents` and `unitLabel`, read from the server, nothing computed or worded here). An article the server marks
 * `sellable: false` is greyed and cannot be ticked, with its `reason` under the name; one already selected can still be unticked so a stale choice is never stuck. A tick that would
 * pass `max` is refused with « N articles au plus. ».
 *
 * Props:
 *   search       async (q) => [{ category, articles: [{ articleRef, label, unitCents, unitLabel, sellable?, reason? }] }]   the server's grouped catalogue (required)
 *   selected     string[]  the `articleRef`s already in the list, in order (required)
 *   onToggle     (article, checked) => void  a tick adds at the end of the list, an untick removes (required)
 *   onClose      () => void  « Fermer » (required)
 *   max          number    the most articles the list holds (default 12)
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';

const TEXTS = Object.freeze({
  search: 'Chercher un article',
  noMatch: 'Aucun article ne correspond.',
  loadFailed: 'Impossible de charger les articles.',
  close: 'Fermer',
});

export default function ArticleChecklistPicker({
  search, selected, onToggle, onClose, max = 12,
}) {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState(null);
  const [failed, setFailed] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

  useEffect(() => {
    let current = true;
    setFailed(false);
    const timer = setTimeout(() => {
      search(query).then((res) => { if (current) setGroups(res); }).catch(() => { if (current) setFailed(true); });
    }, query ? 250 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [query, search]);

  const toggle = (article, checked) => {
    if (checked && selected.length >= max) { setLimitHit(true); return; }
    setLimitHit(false);
    onToggle(article, checked);
  };

  return (
    <Box sx={{ display: 'grid', gap: 0.75, p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.default' }}>
      <TextField
        autoFocus
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={TEXTS.search}
        slotProps={{ htmlInput: { 'aria-label': TEXTS.search, style: { fontSize: 16 } } }}
      />
      {groups === null && !failed && <Typography variant="caption" color="text.secondary">…</Typography>}
      {failed && <Typography role="alert" variant="caption" color="error">{TEXTS.loadFailed}</Typography>}
      {groups && groups.length === 0 && <Typography variant="caption" color="text.secondary">{TEXTS.noMatch}</Typography>}
      <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
        {(groups || []).map((group) => (
          <Box key={group.category || ''} role="group" aria-label={group.category || undefined}>
            {group.category && <Typography variant="overline" color="text.secondary" sx={{ display: 'block', px: 0.5, pt: 0.75 }}>{group.category}</Typography>}
            {group.articles.map((article) => {
              const checked = selected.includes(article.articleRef);
              const refused = article.sellable === false;
              return (
                <FormControlLabel
                  key={article.articleRef}
                  sx={{ display: 'flex', alignItems: 'flex-start', m: 0, minHeight: 44, width: '100%', color: refused ? 'text.secondary' : 'text.primary' }}
                  control={<Checkbox checked={checked} disabled={refused && !checked} onChange={(e) => toggle(article, e.target.checked)} sx={{ p: 1.25 }} />}
                  label={(
                    <Box sx={{ py: 0.75 }}>
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{article.label}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {refused ? article.reason : `${formatCurrency((Number(article.unitCents) || 0) / 100)} ${article.unitLabel}`}
                      </Typography>
                    </Box>
                  )}
                />
              );
            })}
          </Box>
        ))}
      </Box>
      <Typography role="status" variant="caption" color="text.secondary">{limitHit ? `${max} articles au plus.` : ''}</Typography>
      <Box><Button size="small" onClick={onClose} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.close}</Button></Box>
    </Box>
  );
}
