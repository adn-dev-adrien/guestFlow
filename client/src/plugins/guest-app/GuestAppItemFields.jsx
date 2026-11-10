/**
 * GuestAppItemFields — the « Application clients » section of GuestFlow's option and resource editors
 * (specs/guest-app.md rules 22, 23, 37bis-37quater, 39; §6.6), contributed to `options.fields` and
 * `resources.fields` with a `section`. The sell switch, the article's presentation in the app and its stock — the
 * only place the stock is edited. The price and the title stay GuestFlow's, per lodging.
 *
 * It keeps its own row (`/api/guest-app/items/:kind/:id`): the editor's « Enregistrer » saves the option or the
 * resource first, then calls the save this section registered.
 *
 * Props (usePluginFields):
 *   kind           'option' | 'resource'
 *   itemId         number | null       null for an article not created yet: nothing to sell before it exists
 *   registerSave   (fn) => unregister  fn({ itemId }) writes what changed, throws a French message on refusal
 *   onDirtyChange  (dirty) => void
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Divider, FormHelperText, Stack, Switch, TextField, Typography,
} from '@mui/material';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import { ErrorAlert, LoadingState, StatusBadge } from '../sdk';
import guestAppApi from './guestAppApi';
import GuestAppMediaPicker, { thumbOf } from './GuestAppMediaPicker';
import {
  MAX_DESCRIPTION, draftErrors, draftOf, patchOf, sameDraft,
} from './itemDraft';

const SMALL_PHOTO = 1200;
const NOUN = { option: 'l’option', resource: 'la ressource' };

/** A switch with its label and one line of help, the whole row clickable. */
function SwitchRow({
  id, label, help, checked, disabled = false, onChange,
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
      <Box component="label" htmlFor={id} sx={{ minWidth: 0, cursor: disabled ? 'default' : 'pointer' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
        {help && <Typography variant="caption" color="text.secondary" component="p" id={`${id}-help`}>{help}</Typography>}
      </Box>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        slotProps={{ input: { 'aria-describedby': help ? `${id}-help` : undefined } }}
        sx={{ flexShrink: 0, mt: -0.5 }}
      />
    </Box>
  );
}

const counterSlot = { sx: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } };
const numberInput = { htmlInput: { inputMode: 'numeric', style: { fontVariantNumeric: 'tabular-nums' } } };

export default function GuestAppItemFields({
  kind, itemId, registerSave, onDirtyChange,
}) {
  const [view, setView] = useState(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [refusal, setRefusal] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const [media, setMedia] = useState(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (itemId == null) return undefined;
    let live = true;
    setLoadError(false);
    guestAppApi.getItem(kind, itemId)
      .then((v) => {
        if (!live) return;
        const d = draftOf(v);
        setView(v);
        setSaved(d);
        setDraft(d);
      })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [kind, itemId, attempt]);

  // The library is read once: the thumbnail of the current photo, and the picker.
  useEffect(() => {
    if (itemId == null) return undefined;
    let live = true;
    guestAppApi.getMedia().then((list) => { if (live) setMedia(Array.isArray(list) ? list : []); }).catch(() => { if (live) setMedia([]); });
    return () => { live = false; };
  }, [itemId]);

  const dirty = Boolean(draft && saved) && !sameDraft(draft, saved);
  const errors = useMemo(() => (draft ? draftErrors(draft, { kind, saved }) : {}), [draft, kind, saved]);

  useEffect(() => { if (onDirtyChange) onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // The host calls the latest save, which reads the latest draft.
  const latest = useRef({});
  latest.current = {
    draft, saved, errors, kind,
  };
  useEffect(() => {
    if (!registerSave) return undefined;
    return registerSave(async ({ itemId: id }) => {
      const now = latest.current;
      if (Object.keys(now.errors).length > 0) {
        setShowErrors(true);
        throw new Error('Application clients : champs à corriger.');
      }
      try {
        const next = await guestAppApi.saveItem(now.kind, id, patchOf(now.saved, now.draft, { kind: now.kind }));
        const d = draftOf(next);
        setView(next);
        setSaved(d);
        setDraft(d);
        setRefusal(null);
        setShowErrors(false);
      } catch (err) {
        const message = err.message || 'Les réglages de l’application n’ont pas pu être enregistrés.';
        setRefusal(message);
        throw new Error(`Application clients : ${message}`);
      }
    });
  }, [registerSave]);

  if (itemId == null) {
    return (
      <Typography variant="body2" color="text.secondary">
        {`Enregistrer d’abord ${NOUN[kind]} : elle pourra ensuite être vendue dans l’application « Mon séjour ».`}
      </Typography>
    );
  }
  if (loadError) return <ErrorAlert onRetry={() => setAttempt((n) => n + 1)} />;
  if (!draft) return <LoadingState variant="skeleton" rows={3} />;

  const set = (patch) => { setRefusal(null); setDraft((d) => ({ ...d, ...patch })); };
  const errorOf = (field) => (showErrors || draft[field] !== saved[field] ? errors[field] : undefined);
  const photo = media && draft.mediaId ? media.find((m) => m.id === draft.mediaId) : null;
  const sellable = view.sellable || { ok: true };
  const stock = view.stock || {};

  return (
    <Stack spacing={2.25}>
      <SwitchRow
        id={`guest-app-sold-${kind}-${itemId}`}
        label="Vendu dans l’app"
        help={sellable.ok ? 'Le prix et le titre restent ceux de GuestFlow, par logement.' : sellable.reason}
        checked={draft.sold}
        disabled={!sellable.ok && !draft.sold}
        onChange={(sold) => set({ sold })}
      />

      {draft.sold && (
        <>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <Box
              sx={{
                width: 76, height: 76, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover',
                display: 'grid', placeItems: 'center', color: 'text.secondary',
              }}
            >
              {photo
                ? <Box component="img" src={thumbOf(photo)} alt={photo.altFr || ''} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <ImageOutlinedIcon aria-hidden />}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>Photo (carrée)</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                <Button variant="outlined" size="small" onClick={() => setPicking(true)} sx={{ minHeight: 44 }}>
                  {draft.mediaId ? 'Changer la photo' : 'Choisir une photo'}
                </Button>
                {draft.mediaId && (
                  <Button size="small" color="inherit" onClick={() => set({ mediaId: null })} sx={{ minHeight: 44 }}>Retirer</Button>
                )}
              </Stack>
              <FormHelperText sx={{ mx: 0 }}>
                {photo && photo.width < SMALL_PHOTO
                  ? `Photo de ${photo.width} px de large : elle paraîtra floue sur une tablette (1 200 px conseillés).`
                  : 'Carrée, en lumière naturelle. Une photo de moins de 1 200 px de large sera signalée.'}
              </FormHelperText>
            </Box>
          </Box>

          <TextField
            label="Description courte"
            value={draft.shortDescriptionFr}
            onChange={(e) => set({ shortDescriptionFr: e.target.value })}
            multiline
            minRows={2}
            fullWidth
            slotProps={{ htmlInput: { maxLength: MAX_DESCRIPTION }, formHelperText: counterSlot }}
            helperText={`${draft.shortDescriptionFr.length}/${MAX_DESCRIPTION}`}
          />
          <TextField
            label="Description courte (anglais)"
            value={draft.shortDescriptionEn}
            onChange={(e) => set({ shortDescriptionEn: e.target.value })}
            multiline
            minRows={2}
            fullWidth
            slotProps={{ htmlInput: { maxLength: MAX_DESCRIPTION, lang: 'en' }, formHelperText: counterSlot }}
            helperText={`${draft.shortDescriptionEn.length}/${MAX_DESCRIPTION}`}
          />

          {kind === 'option' && (
            <SwitchRow
              id={`guest-app-staff-${itemId}`}
              label="Préparé par l’équipe"
              help="Le client choisit une heure de livraison dans les horaires du service."
              checked={draft.needsStaff}
              onChange={(needsStaff) => set({ needsStaff })}
            />
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            {kind === 'option' && draft.needsStaff && (
              <TextField
                label="Délai de préparation (min)"
                value={draft.leadMinutes}
                onChange={(e) => set({ leadMinutes: e.target.value })}
                error={Boolean(errorOf('leadMinutes'))}
                helperText={errorOf('leadMinutes')}
                slotProps={numberInput}
              />
            )}
            <TextField
              label="Quantité max. par commande"
              value={draft.maxQuantity}
              onChange={(e) => set({ maxQuantity: e.target.value })}
              error={Boolean(errorOf('maxQuantity'))}
              helperText={errorOf('maxQuantity')}
              slotProps={numberInput}
            />
          </Box>
        </>
      )}

      {view.stockable && (
        <>
          <Divider />
          <Box>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant="body2" component="h4" sx={{ fontWeight: 700 }}>Stock</Typography>
              {stock.tracked && (stock.out || stock.soldOut
                ? <StatusBadge status="error" label="Épuisé dans l’app" />
                : stock.left !== null && stock.left !== undefined && (
                  <StatusBadge status="success" label={`${stock.left} vendable${stock.left > 1 ? 's' : ''} dans l’app`} />
                ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" component="p">
              Un seul stock pour le domaine. Il baisse avec toutes les ventes : l’app à la commande, le site et l’équipe
              le jour de l’arrivée du séjour (ou tout de suite si l’article est ajouté pendant le séjour).
            </Typography>
          </Box>

          <SwitchRow
            id={`guest-app-stock-${kind}-${itemId}`}
            label="Suivre le stock"
            help="Coupé : l’article n’est jamais limité."
            checked={draft.stockTracked}
            onChange={(stockTracked) => set({ stockTracked })}
          />

          {draft.stockTracked && (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <TextField
                  label="En stock"
                  value={draft.stockQuantity}
                  onChange={(e) => set({ stockQuantity: e.target.value })}
                  error={Boolean(errorOf('stockQuantity'))}
                  helperText={errorOf('stockQuantity') || [stock.restockLine, stock.heldLabel, 'Compte à saisir au réassort.'].filter(Boolean).join(' · ')}
                  slotProps={numberInput}
                />
                <TextField
                  label="Prévenir sous"
                  value={draft.stockAlertBelow}
                  onChange={(e) => set({ stockAlertBelow: e.target.value })}
                  error={Boolean(errorOf('stockAlertBelow'))}
                  helperText={errorOf('stockAlertBelow') || 'Notification « Stock bas », puis « épuisé ». Vide : seulement à 0.'}
                  slotProps={numberInput}
                />
              </Box>
              <SwitchRow
                id={`guest-app-soldout-${kind}-${itemId}`}
                label="En rupture"
                help="Plus rien à vendre, quel que soit le compte : l’app affiche « Épuisé ». Le site continue de le vendre pour les séjours à venir."
                checked={draft.soldOut}
                onChange={(soldOut) => set({ soldOut })}
              />
            </>
          )}
        </>
      )}

      {refusal && <Alert severity="error">{refusal}</Alert>}

      <GuestAppMediaPicker
        open={picking}
        media={media}
        selected={draft.mediaId}
        onClose={() => setPicking(false)}
        onPick={(mediaId) => { set({ mediaId }); setPicking(false); }}
        onUploaded={(m) => setMedia((list) => [m, ...(list || [])])}
      />
    </Stack>
  );
}
