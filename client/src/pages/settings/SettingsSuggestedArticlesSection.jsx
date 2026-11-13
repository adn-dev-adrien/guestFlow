/**
 * SettingsSuggestedArticlesSection — « Proposés à l'arrivée » (specs/outside-booking-sas.md rules 36-37), a tab of Options & ressources: one reorderable list of articles per sale
 * context (« Bain nordique »…), grouped by kind, edited together and saved with the bar's « Enregistrer ».
 *
 * Renders `GET /api/settings/suggested-articles`; the lists are the server's `suggested_articles` rows. A kind with no context is not drawn (its plugin is off or lists nothing). The
 * server judges everything (12 articles at most, a known reference, no repeat): « 12 articles au plus. » here is a hint that stops the « Ajouter » early, never the guard.
 * Order is changed with ↑ / ↓ buttons (44 px), a drag being a second way of the same thing that a phone does not need.
 *
 * Props: barTabs — the tabs node the host page passes to its `PageActionBar`
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Box, Button, Card, CardContent, IconButton, TextField, Typography } from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import api from '../../api';
import PageActionBar from '../../components/PageActionBar';
import LoadingState from '../../components/LoadingState';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import UnsavedChangesDialog from '../../components/UnsavedChangesDialog';
import useDirtyFormGuard from '../../hooks/useDirtyFormGuard';
import { useToast } from '../../components/DialogProvider';
import { PAGE_TITLE } from '../../constants/optionsResourcesTexts';

const TEXTS = Object.freeze({
  intro: 'Articles proposés d’un geste à l’arrivée, dans l’ordre choisi.',
  empty: 'Aucune liste à régler.',
  none: 'Aucun article proposé.',
  add: 'Ajouter un article',
  search: 'Chercher un article',
  noMatch: 'Aucun article ne correspond.',
  limit: '12 articles au plus.',
  up: 'Monter',
  down: 'Descendre',
  remove: 'Retirer de la liste',
  saved: 'Listes enregistrées.',
  saveFailed: 'Enregistrement impossible.',
  loadFailed: 'Impossible de charger les listes.',
});
const MAX_LISTED = 12;
const keyOf = (kind, id) => `${kind}:${id}`;

function ContextCard({ context, kind, articles, onChange }) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!adding) return undefined;
    let current = true;
    setFound(null);
    setFailed(false);
    const timer = setTimeout(() => {
      api.getSuggestedArticlesCatalogue({ q: query }).then((res) => { if (current) setFound(res.articles); }).catch(() => { if (current) setFailed(true); });
    }, query ? 250 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [adding, query]);

  const listed = new Set(articles.map((a) => a.articleRef));
  const move = (index, delta) => {
    const next = [...articles];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    onChange(next);
  };
  const full = articles.length >= MAX_LISTED;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }} component="section" aria-label={`${kind.label} · ${context.label}`}>
      <CardContent sx={{ display: 'grid', gap: 1.25, p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{context.label}</Typography>
        {articles.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{TEXTS.none}</Typography>
        ) : (
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {articles.map((article, index) => (
              <Box
                component="li"
                key={article.articleRef}
                sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 0.5, borderBottom: 1, borderColor: 'divider', py: 0.25 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{article.label}</Typography>
                <Box sx={{ display: 'flex' }}>
                  <IconButton aria-label={`${TEXTS.up} ${article.label}`} disabled={index === 0} onClick={() => move(index, -1)} sx={{ width: 44, height: 44 }}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  <IconButton aria-label={`${TEXTS.down} ${article.label}`} disabled={index === articles.length - 1} onClick={() => move(index, 1)} sx={{ width: 44, height: 44 }}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  <IconButton aria-label={`${TEXTS.remove} : ${article.label}`} onClick={() => onChange(articles.filter((_, i) => i !== index))} sx={{ width: 44, height: 44 }}><CloseIcon fontSize="small" /></IconButton>
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {full && <Typography role="status" variant="caption" color="text.secondary">{TEXTS.limit}</Typography>}
        {!adding ? (
          <Box>
            <Button startIcon={<AddIcon />} disabled={full} onClick={() => setAdding(true)} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.add}</Button>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gap: 0.75, p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.default' }}>
            <TextField autoFocus size="small" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={TEXTS.search} slotProps={{ htmlInput: { 'aria-label': TEXTS.search, style: { fontSize: 16 } } }} />
            {found === null && !failed && <Typography variant="caption" color="text.secondary">…</Typography>}
            {failed && <Typography role="alert" variant="caption" color="error">{TEXTS.loadFailed}</Typography>}
            {found && found.filter((a) => !listed.has(a.articleRef)).length === 0 && <Typography variant="caption" color="text.secondary">{TEXTS.noMatch}</Typography>}
            {found && found.filter((a) => !listed.has(a.articleRef)).map((a) => (
              <Button
                key={a.articleRef}
                disabled={full}
                onClick={() => { onChange([...articles, { articleRef: a.articleRef, label: a.label }]); setAdding(false); setQuery(''); }}
                sx={{ justifyContent: 'flex-start', textTransform: 'none', minHeight: 44, textAlign: 'left' }}
              >
                {a.label}
              </Button>
            ))}
            <Box><Button size="small" onClick={() => { setAdding(false); setQuery(''); }} sx={{ minHeight: 44, textTransform: 'none' }}>Fermer</Button></Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsSuggestedArticlesSection({ barTabs }) {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [kinds, setKinds] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    return api.getSuggestedArticlesSettings().then((res) => {
      const shown = res.kinds.filter((kind) => kind.contexts.length > 0);
      const lists = {};
      shown.forEach((kind) => kind.contexts.forEach((c) => { lists[keyOf(kind.kind, c.id)] = c.articles.map((a) => ({ articleRef: a.articleRef, label: a.label })); }));
      setKinds(shown);
      setSaved(lists);
      setDraft(lists);
    }).catch(() => setLoadError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirtyKeys = useMemo(() => Object.keys(draft).filter((key) => JSON.stringify(draft[key].map((a) => a.articleRef)) !== JSON.stringify((saved[key] || []).map((a) => a.articleRef))), [draft, saved]);
  const dirty = dirtyKeys.length > 0;
  const leaveGuard = useDirtyFormGuard({ draft, saved: kinds ? saved : draft, navigate });

  const save = async () => {
    setSaving(true);
    try {
      for (const key of dirtyKeys) {
        const [kind, ...rest] = key.split(':');
        // eslint-disable-next-line no-await-in-loop
        await api.saveSuggestedArticles(kind, rest.join(':'), draft[key].map((a) => a.articleRef));
      }
      setSaved(draft);
      showSuccess(TEXTS.saved);
      return true;
    } catch (e) {
      showError(e.message || TEXTS.saveFailed);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const saveAndLeave = async () => { if (await save()) leaveGuard.confirmLeave(); };

  let body;
  if (loadError) body = <ErrorAlert message={TEXTS.loadFailed} onRetry={load} />;
  else if (!kinds) body = <LoadingState />;
  else if (kinds.length === 0) body = <EmptyState message={TEXTS.empty} />;
  else {
    body = (
      <Box sx={{ display: 'grid', gap: 3 }}>
        <Typography variant="body2" color="text.secondary">{TEXTS.intro}</Typography>
        {kinds.map((kind) => (
          <Box key={kind.kind} sx={{ display: 'grid', gap: 1.25 }}>
            <Typography variant="sectionHeader">{kind.label}</Typography>
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
              {kind.contexts.map((context) => (
                <ContextCard
                  key={context.id}
                  kind={kind}
                  context={context}
                  articles={draft[keyOf(kind.kind, context.id)] || []}
                  onChange={(next) => setDraft((prev) => ({ ...prev, [keyOf(kind.kind, context.id)]: next }))}
                />
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <>
      <PageActionBar
        title={PAGE_TITLE}
        tabs={barTabs}
        onSave={save}
        saveDisabled={!dirty || saving}
        saveBusy={saving}
        onCancel={() => setDraft(saved)}
        cancelDisabled={!dirty}
      />
      <Box sx={{ mt: 2, maxWidth: 1240, mx: 'auto', p: { xs: 1.5, sm: 0 } }}>{body}</Box>
      <UnsavedChangesDialog open={leaveGuard.guardDialogOpen} onStay={leaveGuard.dismissGuard} onDiscard={leaveGuard.confirmLeave} onSaveAndQuit={saveAndLeave} />
    </>
  );
}
