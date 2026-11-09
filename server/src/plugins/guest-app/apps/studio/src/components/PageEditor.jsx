/**
 * PageEditor — one booklet page (rules 16-18, 48-49): its title FR / EN, its address, icon and cover, its sharing
 * with the other lodgings (share, stop sharing, duplicate to diverge), and its blocks — added from the palette,
 * reordered, each edited FR / EN side by side and, on a shared page, restricted to some lodgings.
 *
 * Its bar (spec §6.6): Save « Enregistrer le brouillon », Cancel, « Aperçu » and « Publier » before them,
 * « Supprimer la page » after. Saving writes the draft only; guests see it once « Publier » makes it the version
 * of every lodging the page is placed in.
 *
 * Props: `pageId`, `lodging`, `lodgings`, `media`, `items` (sold here, for buttons), `bookletPages`,
 *        `upToDate` (the lodging's booklet is published as it stands), `list` (the PagesList node, drawn above),
 *        `preview` (the PhonePreview node), `onChanged({ slug })` after a save / share / publish, `onDeleted()`,
 *        `onPublish()` (returns a promise), `previewRef` (scrolled to by « Aperçu »).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, Menu, MenuItem, Paper, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import PublicIcon from '@mui/icons-material/Public';
import IosShareIcon from '@mui/icons-material/IosShare';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import PageActionBar from '@guestflow/components/PageActionBar';
import ConfirmDialog from '@guestflow/components/ConfirmDialog';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import StatusBadge from '@guestflow/components/StatusBadge';
import StudioPage from './StudioPage';
import Section from './Section';
import BilingualField from './BilingualField';
import MediaPicker from './MediaPicker';
import SortableList, { moveItem } from './SortableList';
import BlockEditor, { emptyData } from './BlockEditor';
import { BLOCK_TYPES, PAGE_ICONS, blockLabel } from '../constants/studio';
import { useLoad } from '../hooks/useLoad';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import {
  draftOf, isDirty, newBlock, saveDraft,
} from '../utils/pageDraft';
import { api } from '../services/api';

const clone = (value) => JSON.parse(JSON.stringify(value));

function restrictionValue(ids) {
  return ids && ids.length === 1 ? String(ids[0]) : 'all';
}

export default function PageEditor({
  pageId, lodging, lodgings, media, items, bookletPages, upToDate, list, preview, onChanged, onDeleted, onPublish, previewRef,
}) {
  const page = useLoad(() => api.page(pageId), [pageId]);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [duplicateAnchor, setDuplicateAnchor] = useState(null);

  // The page read from the server is the baseline and, after a save, the draft too: the server trims and drops an
  // empty English, so the copy written would stay « modified » for ever.
  const adopted = useRef(null);
  // Bumped when the draft is replaced from outside the editors (Annuler, a save): block editors that keep the text
  // as typed start again from the draft.
  const [generation, setGeneration] = useState(0);
  const adopt = (data, keep = null) => {
    adopted.current = data;
    const next = draftOf(data);
    setSaved(next);
    setDraft(keep || clone(next));
  };
  useEffect(() => {
    if (page.data && page.data !== adopted.current) adopt(page.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.data]);

  const dirty = isDirty(draft, saved);
  useDirtyGuard(dirty);

  const placements = page.data ? page.data.placements : [];
  const others = placements.filter((p) => p.propertyId !== lodging.propertyId);
  const shared = others.length > 0;
  const placedIds = new Set(placements.map((p) => p.propertyId));
  const nameOf = (id) => (lodgings.find((l) => l.propertyId === id) || {}).name || `Logement ${id}`;
  const notPlaced = lodgings.filter((l) => !placedIds.has(l.propertyId));
  const elsewhere = lodgings.filter((l) => l.propertyId !== lodging.propertyId);

  const setField = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setBlock = (key, patch) => setDraft((d) => ({ ...d, blocks: d.blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)) }));

  const run = async (work, message) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (message) setNotice(message);
    } catch (err) {
      setError(err.blockIndex !== undefined ? `Bloc ${err.blockIndex + 1} (${blockLabel(draft.blocks[err.blockIndex].type)}) : ${err.message}` : err.message);
    } finally {
      setBusy(false);
    }
  };

  // `writing` gets the ids of the blocks it creates. It goes on screen at once, whether or not the page can then be
  // read again: a retry never creates a block twice (spec §4.2). After a save refused half-way it stays the draft,
  // every edit kept; after a full save the page read back replaces it.
  const save = () => run(async () => {
    const writing = clone(draft);
    try {
      await saveDraft(api, pageId, writing, saved);
    } catch (error) {
      setDraft(writing);
      const fresh = await page.reload();
      if (fresh) adopt(fresh, writing);
      throw error;
    }
    setDraft(writing);
    const fresh = await page.reload();
    if (fresh) {
      adopt(fresh);
      setGeneration((g) => g + 1);
    }
    onChanged({ slug: writing.slug });
  }, shared ? `Brouillon enregistré, aussi pour ${others.map((o) => o.name).join(', ')}.` : 'Brouillon enregistré.');

  const share = (propertyId) => run(async () => {
    await api.sharePage(pageId, propertyId);
    await page.reload();
    onChanged({});
  }, `Page partagée avec ${nameOf(propertyId)}.`);

  const unshare = (propertyId) => run(async () => {
    await api.unsharePage(pageId, propertyId);
    await page.reload();
    onChanged({});
  }, `La page n’est plus dans le livret de ${nameOf(propertyId)}.`);

  const duplicate = (propertyId) => run(async () => {
    setDuplicateAnchor(null);
    await api.duplicatePage(pageId, propertyId);
    onChanged({});
  }, `Copie indépendante créée dans le livret de ${nameOf(propertyId)}.`);

  const publish = () => run(() => onPublish(), shared
    ? `Publié : ${[lodging.name, ...others.map((o) => o.name)].join(' et ')}.`
    : `Livret de ${lodging.name} publié.`);

  const remove = () => run(async () => {
    setConfirmDelete(false);
    await api.deletePage(pageId);
    onDeleted();
  });

  const publishLabel = shared ? `Publier (${placements.length} logements)` : 'Publier';
  const bar = (
    <PageActionBar
      title={draft ? draft.title.fr || 'Page sans titre' : 'Page'}
      subtitle={page.data ? (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {(() => {
            const here = placements.find((p) => p.propertyId === lodging.propertyId);
            return here ? <StatusBadge status={here.published ? 'success' : 'neutral'} label={here.published ? 'Publiée' : 'Brouillon'} /> : null;
          })()}
          {shared ? <StatusBadge status="info" label={`Partagée avec ${others.map((o) => o.name).join(', ')}`} /> : null}
        </Box>
      ) : null}
      onSave={save}
      saveTooltip="Enregistrer le brouillon"
      saveDisabled={!dirty || busy}
      saveBusy={busy}
      onCancel={() => { setDraft(clone(saved)); setGeneration((g) => g + 1); setError(null); }}
      cancelDisabled={!dirty || busy}
      actionsBefore={[
        { icon: <VisibilityOutlinedIcon />, tooltip: 'Aperçu', onClick: () => previewRef.current && previewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), color: 'info' },
        {
          icon: <PublicIcon />,
          label: publishLabel,
          tooltip: dirty ? 'Enregistrez d’abord le brouillon' : (upToDate ? 'Le livret publié est déjà à jour' : publishLabel),
          onClick: publish,
          color: 'success',
          ariaDisabled: dirty || upToDate || busy,
        },
      ]}
      actionsAfter={[{ icon: <DeleteOutlineIcon />, tooltip: 'Supprimer la page', onClick: () => setConfirmDelete(true), color: 'error', disabled: busy }]}
    />
  );

  const restrictionOptions = useMemo(() => [
    { value: 'all', label: placements.length === 2 ? 'Les deux logements' : 'Tous les logements de la page' },
    ...placements.map((p) => ({ value: String(p.propertyId), label: `Seulement ${p.name}` })),
  ], [placements]);

  if (!draft) {
    return (
      <StudioPage bar={bar} preview={preview}>
        {list}
        {page.error ? <ErrorAlert message={page.error.message} onRetry={page.reload} /> : <LoadingState />}
      </StudioPage>
    );
  }

  return (
    <StudioPage bar={bar} preview={preview}>
      {list}
      {error ? <ErrorAlert message={error} /> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert> : null}
      {shared ? <Alert severity="info">Page partagée : ce que vous enregistrez ici modifie aussi le livret de {others.map((o) => o.name).join(' et de ')}.</Alert> : null}
      {page.data.placeholder ? <Alert severity="warning">Page provisoire : remplacez son contenu par celui de votre livret.</Alert> : null}

      <Section id="page">
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField label="Titre" required value={draft.title.fr} onChange={(e) => setField({ title: { ...draft.title, fr: e.target.value } })} slotProps={{ htmlInput: { maxLength: 120 } }} />
          <TextField label="Title (English)" value={draft.title.en} onChange={(e) => setField({ title: { ...draft.title, en: e.target.value } })} helperText={draft.title.fr && !draft.title.en ? 'Non traduit : les clients anglophones liront le français.' : ' '} slotProps={{ htmlInput: { maxLength: 120, lang: 'en' } }} />
          <TextField label="Adresse de la page" value={draft.slug} onChange={(e) => setField({ slug: e.target.value })} helperText={`…/livret/${draft.slug || '…'}`} slotProps={{ htmlInput: { maxLength: 60, autoCapitalize: 'off', spellCheck: false } }} />
          <TextField select label="Icône" value={draft.icon || ''} onChange={(e) => setField({ icon: e.target.value || null })}>
            <MenuItem value="">Aucune</MenuItem>
            {PAGE_ICONS.map((i) => <MenuItem key={i.value} value={i.value}>{i.label}</MenuItem>)}
          </TextField>
        </Box>
        <MediaPicker label="Couverture" ratio="3:2" mediaId={draft.coverMediaId} media={media} onChange={(coverMediaId) => setField({ coverMediaId })} />
        {elsewhere.length ? (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {others.map((o) => (
              <Button key={o.propertyId} variant="outlined" color="inherit" startIcon={<LinkOffIcon />} disabled={busy || dirty} onClick={() => unshare(o.propertyId)} sx={{ minHeight: 44 }}>
                Ne plus partager avec {o.name}
              </Button>
            ))}
            {notPlaced.map((l) => (
              <Button key={l.propertyId} variant="outlined" startIcon={<IosShareIcon />} disabled={busy || dirty} onClick={() => share(l.propertyId)} sx={{ minHeight: 44 }}>
                Partager avec {l.name}
              </Button>
            ))}
            <Button variant="outlined" color="inherit" startIcon={<ContentCopyIcon />} disabled={busy || dirty} onClick={(e) => setDuplicateAnchor(e.currentTarget)} aria-haspopup="menu" sx={{ minHeight: 44 }}>
              Dupliquer vers…
            </Button>
            <Menu anchorEl={duplicateAnchor} open={Boolean(duplicateAnchor)} onClose={() => setDuplicateAnchor(null)}>
              {lodgings.map((l) => <MenuItem key={l.propertyId} onClick={() => duplicate(l.propertyId)} sx={{ minHeight: 44 }}>{l.name}{l.propertyId === lodging.propertyId ? ' (ce livret)' : ''}</MenuItem>)}
            </Menu>
            {dirty ? <Typography variant="caption" sx={{ color: 'text.secondary', alignSelf: 'center' }}>Enregistrez d’abord le brouillon pour partager ou dupliquer.</Typography> : null}
          </Box>
        ) : null}
      </Section>

      {draft.blocks.length ? (
        <SortableList
          items={draft.blocks}
          getKey={(b) => b.key}
          label={(b) => blockLabel(b.type)}
          onMove={(from, to) => setDraft((d) => ({ ...d, blocks: moveItem(d.blocks, from, to) }))}
          renderItem={(block, { index, handle, up, down }) => {
            const restricted = block.onlyForPropertyIds && block.onlyForPropertyIds.length === 1 ? nameOf(block.onlyForPropertyIds[0]) : null;
            return (
              <Paper variant="outlined" component="section" aria-label={`Bloc ${index + 1} : ${blockLabel(block.type)}`} sx={{ p: { xs: 1.5, sm: 2 }, display: 'grid', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  {handle}
                  <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 120 }}>
                    {blockLabel(block.type)}
                    {restricted ? <Box component="span" sx={{ color: 'primary.main', fontWeight: 600 }}>{` · seulement pour ${restricted}`}</Box> : null}
                  </Typography>
                  {shared ? (
                    <TextField
                      select
                      size="small"
                      label="Pour"
                      value={restrictionValue(block.onlyForPropertyIds)}
                      onChange={(e) => setBlock(block.key, { onlyForPropertyIds: e.target.value === 'all' ? null : [Number(e.target.value)] })}
                      sx={{ minWidth: 190 }}
                    >
                      {restrictionOptions.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                    </TextField>
                  ) : null}
                  {up}
                  {down}
                  <Tooltip title="Retirer ce bloc">
                    <IconButton aria-label={`Retirer le bloc ${index + 1} (${blockLabel(block.type)})`} color="error" onClick={() => setDraft((d) => ({ ...d, blocks: d.blocks.filter((b) => b.key !== block.key) }))} sx={{ width: 44, height: 44, border: 1, borderColor: 'divider' }}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <BlockEditor
                  key={generation}
                  type={block.type}
                  data={block.data}
                  onChange={(data) => setBlock(block.key, { data })}
                  media={media}
                  pages={bookletPages}
                  items={items}
                />
              </Paper>
            );
          }}
        />
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Cette page n’a pas encore de bloc : ajoutez-en un ci-dessous.</Typography>
      )}

      <Section id="palette" title="Ajouter un bloc">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {BLOCK_TYPES.map((b) => (
            <Chip
              key={b.type}
              icon={<AddIcon />}
              label={b.label}
              variant="outlined"
              clickable
              onClick={() => setDraft((d) => ({ ...d, blocks: [...d.blocks, newBlock(b.type, emptyData(b.type))] }))}
              sx={{ minHeight: 44, borderRadius: 999, px: 0.5 }}
            />
          ))}
        </Box>
      </Section>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Supprimer cette page ?"
        message={shared
          ? `« ${draft.title.fr} » disparaît du livret de ${[lodging.name, ...others.map((o) => o.name)].join(' et de ')}. Ses blocs sont supprimés.`
          : `« ${draft.title.fr} » et ses blocs sont supprimés. Le livret déjà publié la garde jusqu’à la prochaine publication.`}
        confirmLabel="Supprimer"
      />
    </StudioPage>
  );
}
