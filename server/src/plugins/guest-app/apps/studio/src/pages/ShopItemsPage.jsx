/**
 * Boutique — the articles linked to this lodging in GuestFlow, and how the app presents those it sells (rules 22-24,
 * 37bis, 39, 48, 50). The price, the title, the category and the stock are GuestFlow's: shown here, changed there
 * (« Modifier dans GuestFlow »). The sell switch and the presentation are the same rows as the « Application
 * clients » section of GuestFlow's option and resource editors. Saved with the bar.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box, ButtonBase, Chip, Collapse, FormControlLabel, Link, Paper, Switch, TextField, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import EmptyState from '@guestflow/components/EmptyState';
import StatusBadge from '@guestflow/components/StatusBadge';
import StudioPage from '../components/StudioPage';
import MediaPicker from '../components/MediaPicker';
import PhonePreview from '../components/PhonePreview';
import { thumbOf } from '../components/MediaDialog';
import { GUESTFLOW_LINKS } from '../constants/studio';
import { useLoad } from '../hooks/useLoad';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { usePreviewLang } from '../hooks/usePreviewLang';
import { shopView } from '../utils/previewViews';
import { api } from '../services/api';

const FIELDS = ['sold', 'mediaId', 'shortDescriptionFr', 'shortDescriptionEn', 'maxQuantity', 'needsStaff', 'leadMinutes'];
const keyOf = (item) => `${item.kind}:${item.id}`;
const presentationOf = (item) => Object.fromEntries(FIELDS.map((f) => [f, item[f] ?? (f.startsWith('short') ? '' : null)]));
const changedFields = (draft, item) => Object.fromEntries(FIELDS.filter((f) => draft[f] !== presentationOf(item)[f]).map((f) => [f, draft[f]]));

function stockBadge(item) {
  const s = item.stock;
  if (!s) return null;
  if (s.soldOut || s.out) return <StatusBadge status="error" label="Épuisé" />;
  if (s.tracked && s.quantityLabel) return <StatusBadge status={s.alertBelow !== null && s.left !== null && s.left <= s.alertBelow ? 'warning' : 'neutral'} label={`Stock : ${s.quantityLabel}`} />;
  return null;
}

function stateBadge(item, draft) {
  if (!item.sellable.ok) return <StatusBadge status="neutral" label="Ne se vend pas dans l’app" />;
  return draft.sold ? <StatusBadge status="success" label="Vendu dans l’app" /> : <StatusBadge status="neutral" label="Non vendu" />;
}

function ItemRow({
  item, draft, media, open, onToggle, onChange,
}) {
  const photo = media.find((m) => m.id === draft.mediaId);
  const link = item.kind === 'resource' ? GUESTFLOW_LINKS.resource : GUESTFLOW_LINKS.option;
  const price = [item.priceLabel, item.priceUnitLabel].filter(Boolean).join(' · ');
  const panelId = `item-${item.kind}-${item.id}`;
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: { xs: 1.5, sm: 2 } }}>
        <Box sx={{ width: 48, height: 48, borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover', flexShrink: 0 }}>
          {photo ? <Box component="img" src={thumbOf(photo)} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ButtonBase onClick={onToggle} aria-expanded={open} aria-controls={panelId} sx={{ display: 'flex', gap: 0.5, alignItems: 'center', textAlign: 'left', borderRadius: 1, minHeight: 44 }}>
            <Typography sx={{ fontWeight: 600 }}>{item.title}</Typography>
            <ExpandMoreIcon fontSize="small" sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms', color: 'text.secondary' }} />
          </ButtonBase>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {[item.category, price].filter(Boolean).join(' · ')}
            {' · '}
            <Link href={link} target="_blank" rel="noopener">Modifier dans GuestFlow</Link>
          </Typography>
          {!item.sellable.ok && item.sellable.reason ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{item.sellable.reason}</Typography> : null}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {stockBadge(item)}
          {stateBadge(item, draft)}
        </Box>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box id={panelId} sx={{ display: 'grid', gap: 2, p: { xs: 1.5, sm: 2 }, pt: 0, borderTop: 1, borderColor: 'divider' }}>
          <FormControlLabel
            sx={{ mt: 1.5 }}
            control={<Switch checked={Boolean(draft.sold)} disabled={!item.sellable.ok} onChange={(e) => onChange({ sold: e.target.checked })} />}
            label="Vendu dans l’app"
          />
          <MediaPicker label="Photo" ratio="1:1" mediaId={draft.mediaId} media={media} onChange={(mediaId) => onChange({ mediaId })} />
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField label="Description courte" value={draft.shortDescriptionFr || ''} onChange={(e) => onChange({ shortDescriptionFr: e.target.value })} helperText={`${(draft.shortDescriptionFr || '').length}/140`} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 140 } }} />
            <TextField label="Short description (English)" value={draft.shortDescriptionEn || ''} onChange={(e) => onChange({ shortDescriptionEn: e.target.value })} helperText={`${(draft.shortDescriptionEn || '').length}/140`} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 140, lang: 'en' } }} />
            <TextField label="Quantité max. par commande" type="number" value={draft.maxQuantity ?? ''} onChange={(e) => onChange({ maxQuantity: e.target.value === '' ? null : Number(e.target.value) })} slotProps={{ htmlInput: { min: 1, max: 50, inputMode: 'numeric' } }} />
            {item.kind === 'option' ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                <FormControlLabel control={<Switch checked={Boolean(draft.needsStaff)} onChange={(e) => onChange({ needsStaff: e.target.checked })} />} label="Préparé par l’équipe" />
                {draft.needsStaff ? (
                  <TextField label="Délai de préparation (min)" type="number" value={draft.leadMinutes ?? ''} onChange={(e) => onChange({ leadMinutes: e.target.value === '' ? null : Number(e.target.value) })} slotProps={{ htmlInput: { min: 0, max: 240, inputMode: 'numeric' } }} />
                ) : null}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary', alignSelf: 'center' }}>Une ressource suit son planning : pas de délai de préparation.</Typography>
            )}
          </Box>
          {item.stockable ? (
            <Box sx={{ display: 'grid', gap: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Stock</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {item.stock && item.stock.tracked ? [item.stock.quantityLabel && `En stock : ${item.stock.quantityLabel}`, item.stock.heldLabel, item.stock.restockLine].filter(Boolean).join(' · ') : 'Stock non suivi : l’article n’est jamais limité.'}
                {item.stock && item.stock.soldOut ? ' · En rupture.' : ''}
              </Typography>
              <Typography variant="body2">Le stock se règle dans GuestFlow seulement. <Link href={link} target="_blank" rel="noopener">Modifier dans GuestFlow</Link></Typography>
            </Box>
          ) : null}
        </Box>
      </Collapse>
    </Paper>
  );
}

export default function ShopItemsPage({ lodging }) {
  const id = lodging.propertyId;
  const data = useLoad(() => Promise.all([api.items(id), api.media()]).then(([items, media]) => ({ items, media })), [id]);
  const [drafts, setDrafts] = useState({});
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lang, setLang] = usePreviewLang();

  useEffect(() => { if (data.data) setDrafts(Object.fromEntries(data.data.items.map((i) => [keyOf(i), presentationOf(i)]))); }, [data.data]);
  const changes = data.data ? data.data.items.map((i) => [i, drafts[keyOf(i)] ? changedFields(drafts[keyOf(i)], i) : {}]).filter(([, c]) => Object.keys(c).length) : [];
  const dirty = changes.length > 0;
  useDirtyGuard(dirty);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = [];
      for (const [item, patch] of changes) {
        try {
          updated.push(await api.saveItem(item.kind, item.id, patch));
        } catch (err) {
          throw Object.assign(err, { message: `${item.title} : ${err.message}` });
        }
      }
      data.setData((d) => ({ ...d, items: d.items.map((i) => { const u = updated.find((x) => x.kind === i.kind && x.id === i.id); return u ? { ...i, ...u } : i; }) }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const view = useMemo(() => (data.data ? shopView({
    lodgingName: lodging.name,
    items: data.data.items.map((i) => ({ ...i, ...(drafts[keyOf(i)] || {}) })),
    media: data.data.media,
    modules: ['booklet', 'shop', 'orders'],
    lang,
  }) : null), [data.data, drafts, lodging.name, lang]);

  const bar = (
    <PageActionBar
      title="Boutique"
      subtitle={<Chip size="small" label={lodging.name} />}
      onSave={save}
      saveDisabled={!dirty || busy}
      saveBusy={busy}
      onCancel={() => { setDrafts(Object.fromEntries(data.data.items.map((i) => [keyOf(i), presentationOf(i)]))); setError(null); }}
      cancelDisabled={!dirty || busy}
    />
  );
  if (!data.data) return <StudioPage bar={bar}>{data.error ? <ErrorAlert message={data.error.message} onRetry={data.reload} /> : <LoadingState />}</StudioPage>;
  const { items, media } = data.data;
  return (
    <StudioPage bar={bar} preview={<PhonePreview view={view} title={`Aperçu · ${lodging.name}`} caption="Ce que verront les clients après « Enregistrer »." lang={lang} onLang={setLang} />}>
      {error ? <ErrorAlert message={error} /> : null}
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Les articles liés à {lodging.name} dans GuestFlow. Touchez un article pour régler sa vente dans l’app ; le prix, le titre et le stock se modifient dans GuestFlow.
      </Typography>
      {!items.length ? <EmptyState message={`Aucune option ni ressource n’est liée à ${lodging.name} dans GuestFlow.`} /> : null}
      {items.map((item) => (
        <ItemRow
          key={keyOf(item)}
          item={item}
          draft={drafts[keyOf(item)] || presentationOf(item)}
          media={media}
          open={open === keyOf(item)}
          onToggle={() => setOpen((o) => (o === keyOf(item) ? null : keyOf(item)))}
          onChange={(patch) => setDrafts((d) => ({ ...d, [keyOf(item)]: { ...(d[keyOf(item)] || presentationOf(item)), ...patch } }))}
        />
      ))}
    </StudioPage>
  );
}
