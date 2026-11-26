/**
 * SettingsSuggestedArticlesSection — « Options proposées » (specs/sas/outside-booking-sas.md rules 36-37, specs/site/site-outside-resource-booking.md rules 34-36), a tab of Options & ressources:
 * one reorderable list of articles per sale context (« Bain nordique »…), grouped by kind, edited together and saved with the bar's « Enregistrer ». The same list is offered at the arrival and,
 * for an activity sold online, on its page of the website: each card says where it shows (`shownOn`, from the server).
 *
 * Renders `GET /api/settings/suggested-articles`; the lists are the server's `suggested_articles` rows. A kind with no context is not drawn (its plugin is off or lists nothing). The
 * server judges everything (12 articles at most, a known reference, no repeat, an article the engine refuses outside a stay): the page only shows its words. « Ajouter des articles »
 * opens the `ArticleChecklistPicker`; an article already listed and now refused is drawn in warning with its reason, and the save of that list is refused by the server and said on its card.
 * Order is changed with ↑ / ↓ buttons (44 px), a drag being a second way of the same thing that a phone does not need.
 *
 * Props: barTabs — the tabs node the host page passes to its `PageActionBar`
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Box, Button, Card, CardContent, IconButton, Typography } from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import api from '../../api';
import PageActionBar from '../../components/PageActionBar';
import LoadingState from '../../components/LoadingState';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import ArticleChecklistPicker from '../../components/ArticleChecklistPicker';
import UnsavedChangesDialog from '../../components/UnsavedChangesDialog';
import useDirtyFormGuard from '../../hooks/useDirtyFormGuard';
import { useToast } from '../../components/DialogProvider';
import { PAGE_TITLE } from '../../constants/optionsResourcesTexts';
import { formatCurrency } from '../../utils/formatters';

const TEXTS = Object.freeze({
  intro: 'Articles proposés à l’arrivée et, pour une activité vendue en ligne, sur sa page du site, dans l’ordre choisi.',
  empty: 'Aucune liste à régler.',
  none: 'Aucun article proposé.',
  add: 'Ajouter des articles',
  onSite: 'Sur le site',
  onSiteCaption: 'À l’arrivée et dans « Ajouter à la séance » de la page du site.',
  arrivalOnly: 'À l’arrivée seulement',
  arrivalOnlyCaption: 'Proposés à l’arrivée uniquement.',
  removeToSave: 'Retirer pour enregistrer.',
  up: 'Monter',
  down: 'Descendre',
  remove: 'Retirer de la liste',
  saved: 'Listes enregistrées.',
  saveFailed: 'Enregistrement impossible.',
  loadFailed: 'Impossible de charger les listes.',
});
const MAX_LISTED = 12;
const keyOf = (kind, id) => `${kind}:${id}`;
const entryOf = (a) => ({ articleRef: a.articleRef, label: a.label, unitCents: a.unitCents ?? null, unitLabel: a.unitLabel ?? null, reason: a.reason ?? null });

function ContextCard({ context, kind, articles, refusal, onChange }) {
  const [adding, setAdding] = useState(false);
  const search = useCallback(
    (q) => api.getSuggestedArticlesCatalogue({ q, context: keyOf(kind.kind, context.id), all: true }).then((res) => res.groups || []),
    [kind.kind, context.id],
  );
  const move = (index, delta) => {
    const next = [...articles];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    onChange(next);
  };
  const onSite = context.shownOn.includes('site');

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }} component="section" aria-label={`${kind.label} · ${context.label}`}>
      <CardContent sx={{ display: 'grid', gap: 1.25, p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{context.label}</Typography>
          <StatusBadge status={onSite ? 'success' : 'neutral'} label={onSite ? TEXTS.onSite : TEXTS.arrivalOnly} />
        </Box>
        <Typography variant="body2" color="text.secondary">{onSite ? TEXTS.onSiteCaption : TEXTS.arrivalOnlyCaption}</Typography>
        {articles.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{TEXTS.none}</Typography>
        ) : (
          <Box component="ol" aria-label={context.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {articles.map((article, index) => (
              <Box
                component="li"
                key={article.articleRef}
                sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 0.5, borderBottom: 1, borderColor: 'divider', py: 0.25 }}
              >
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{article.label}</Typography>
                  {article.reason ? (
                    <Typography variant="caption" sx={(t) => ({ display: 'block', color: t.palette.warning.text })}>{`${article.reason} ${TEXTS.removeToSave}`}</Typography>
                  ) : article.unitCents != null && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{`${formatCurrency(article.unitCents / 100)} ${article.unitLabel}`}</Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex' }}>
                  <IconButton aria-label={`${TEXTS.up} ${article.label}`} disabled={index === 0} onClick={() => move(index, -1)} sx={{ width: 44, height: 44 }}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  <IconButton aria-label={`${TEXTS.down} ${article.label}`} disabled={index === articles.length - 1} onClick={() => move(index, 1)} sx={{ width: 44, height: 44 }}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  <IconButton aria-label={`${TEXTS.remove} : ${article.label}`} onClick={() => onChange(articles.filter((_, i) => i !== index))} sx={{ width: 44, height: 44 }}><CloseIcon fontSize="small" /></IconButton>
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {refusal && <Typography role="alert" variant="body2" color="error">{refusal}</Typography>}
        {!adding ? (
          <Box>
            <Button startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.add}</Button>
          </Box>
        ) : (
          <ArticleChecklistPicker
            search={search}
            selected={articles.map((a) => a.articleRef)}
            max={MAX_LISTED}
            onToggle={(article, checked) => onChange(checked ? [...articles, entryOf(article)] : articles.filter((a) => a.articleRef !== article.articleRef))}
            onClose={() => setAdding(false)}
          />
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
  const [refusals, setRefusals] = useState({});

  const load = useCallback(() => {
    setLoadError(false);
    return api.getSuggestedArticlesSettings().then((res) => {
      const shown = res.kinds.filter((kind) => kind.contexts.length > 0);
      const lists = {};
      shown.forEach((kind) => kind.contexts.forEach((c) => { lists[keyOf(kind.kind, c.id)] = c.articles.map(entryOf); }));
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
    setRefusals({});
    const done = {};
    const refused = {};
    for (const key of dirtyKeys) {
      const [kind, ...rest] = key.split(':');
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.saveSuggestedArticles(kind, rest.join(':'), draft[key].map((a) => a.articleRef));
        done[key] = draft[key];
      } catch (e) {
        refused[key] = e.message || TEXTS.saveFailed;
      }
    }
    setSaved((prev) => ({ ...prev, ...done }));
    setRefusals(refused);
    setSaving(false);
    const failed = Object.values(refused);
    if (failed.length) {
      showError(failed[0]);
      return false;
    }
    showSuccess(TEXTS.saved);
    return true;
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
                  refusal={refusals[keyOf(kind.kind, context.id)]}
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
        onCancel={() => { setDraft(saved); setRefusals({}); }}
        cancelDisabled={!dirty}
      />
      <Box sx={{ mt: 2, maxWidth: 1240, mx: 'auto', p: { xs: 1.5, sm: 0 } }}>{body}</Box>
      <UnsavedChangesDialog open={leaveGuard.guardDialogOpen} onStay={leaveGuard.dismissGuard} onDiscard={leaveGuard.confirmLeave} onSaveAndQuit={saveAndLeave} />
    </>
  );
}
