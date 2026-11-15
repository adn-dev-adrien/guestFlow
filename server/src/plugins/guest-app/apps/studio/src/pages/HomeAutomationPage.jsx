/**
 * Domotique — what this lodging's « Domotique » page shows (specs/guest-app-home-automation.md §3.C): five blocks, each
 * on or off, in the lodging's order, each fed by an equipment Sowel described. The server judges every draft: the
 * preview is asked for on each change, and its refusals are the inline errors — the studio writes no rule of its own.
 * Saved with the bar; the preview shows the real readings before « Enregistrer ».
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Checkbox, Chip, FormControlLabel, IconButton, MenuItem, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import StatusBadge from '@guestflow/components/StatusBadge';
import StudioPage from '../components/StudioPage';
import Section from '../components/Section';
import SortableList, { moveItem } from '../components/SortableList';
import PhonePreview from '../components/PhonePreview';
import { HOME_BLOCKS, HOME_CHANNEL_STATUS } from '../constants/studio';
import { useLoad } from '../hooks/useLoad';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { usePreviewLang } from '../hooks/usePreviewLang';
import { smartHomeView } from '../utils/previewViews';
import { api } from '../services/api';

const PREVIEW_DELAY_MS = 300;
const LIST_KINDS = ['rooms', 'lights'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The equipment picker of a block or an item: the server's choices, a gone equipment flagged. */
function EquipmentPicker({
  label, value, choices, error, onChange, id,
}) {
  const current = choices.find((c) => c.id === value);
  return (
    <TextField
      id={id}
      select
      fullWidth
      size="small"
      label={label}
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      error={Boolean(error || (current && current.gone))}
      helperText={error || (current && current.gone) || ' '}
    >
      <MenuItem value=""><em>Choisir…</em></MenuItem>
      {choices.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
    </TextField>
  );
}

function ListItems({
  kind, bi, block, choices, errors, onChange,
}) {
  const meta = HOME_BLOCKS[kind];
  const err = (ii, field) => errors[`blocks.${bi}.items.${ii}.${field}`];
  const setItem = (ii, patch) => onChange({ ...block, items: block.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  const full = block.items.length >= meta.max;
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {block.items.map((item, ii) => {
        const choice = choices.find((c) => c.id === item.equipmentId);
        const entrusted = Boolean(choice && choice.guestSwitchable);
        return (
          // eslint-disable-next-line react/no-array-index-key
          <Box key={item.id || `new-${ii}`} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.default', display: 'grid', gap: 1 }}>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: 'minmax(0,1fr) 44px', sm: 'minmax(0,1fr) minmax(0,1.2fr) 44px' }, alignItems: 'start' }}>
              <TextField
                size="small"
                label="Nom affiché"
                value={item.label}
                onChange={(e) => setItem(ii, { label: e.target.value })}
                error={Boolean(err(ii, 'label'))}
                helperText={err(ii, 'label') || ' '}
                slotProps={{ htmlInput: { maxLength: 60 } }}
              />
              <Box sx={{ gridColumn: { xs: '1 / 2', sm: 'auto' }, gridRow: { xs: 2, sm: 'auto' } }}>
                <EquipmentPicker
                  id={`home-${kind}-${ii}-equipment`}
                  label={meta.picker}
                  value={item.equipmentId}
                  choices={choices}
                  error={err(ii, 'equipmentId')}
                  onChange={(equipmentId) => {
                    const next = choices.find((c) => c.id === equipmentId);
                    setItem(ii, { equipmentId, ...(kind === 'lights' && !(next && next.guestSwitchable) ? { pilotable: false } : {}) });
                  }}
                />
              </Box>
              <Tooltip title="Retirer">
                <IconButton aria-label={`Retirer ${item.label || 'cet élément'}`} onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== ii) })} sx={{ width: 44, height: 44, gridRow: { xs: '1 / 3', sm: 'auto' } }}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            {kind === 'lights' ? (
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1.5 }}>
                <FormControlLabel
                  control={<Checkbox checked={Boolean(item.pilotable)} disabled={!entrusted} onChange={(e) => setItem(ii, { pilotable: e.target.checked })} />}
                  label="Pilotable par le voyageur"
                  sx={{ minHeight: 44, mr: 0 }}
                />
                <Typography variant="body2" sx={{ color: err(ii, 'pilotable') ? 'error.main' : 'text.secondary' }}>
                  {err(ii, 'pilotable') || (!item.equipmentId ? '' : (!entrusted ? 'Non confiée aux voyageurs dans Sowel : consultation seule.' : (item.pilotable ? 'Un appui allume, un autre éteint.' : 'Le voyageur voit seulement si elle est allumée.')))}
                </Typography>
              </Box>
            ) : null}
          </Box>
        );
      })}
      {errors[`blocks.${bi}.items`] ? <Typography variant="body2" color="error">{errors[`blocks.${bi}.items`]}</Typography> : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={full}
          onClick={() => onChange({ ...block, items: [...block.items, kind === 'rooms' ? { label: '', equipmentId: null } : { label: '', equipmentId: null, pilotable: false }] })}
        >
          {meta.add}
        </Button>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`${block.items.length} sur ${meta.max} au plus.`}</Typography>
      </Box>
    </Box>
  );
}

export default function HomeAutomationPage({ lodging }) {
  const id = lodging.propertyId;
  const data = useLoad(() => Promise.all([api.home(id), api.lodging(id), api.media()])
    .then(([home, config, media]) => ({ home, config, media })), [id]);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [frozen, setFrozen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lang, setLang] = usePreviewLang();
  const seq = useRef(0);

  const saved = data.data ? data.data.home.blocks : null;
  useEffect(() => { if (saved) setDraft(saved); }, [data.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = Boolean(draft && saved && !same(draft, saved));
  useDirtyGuard(dirty);

  // Rule 16 — the server builds the preview of the draft, and refuses it the way it would refuse the save.
  useEffect(() => {
    if (!draft) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api.homePreview(id, draft, lang).then(
        (view) => { if (mine === seq.current) { setPreview(view); setErrors({}); setFrozen(false); } },
        (err) => { if (mine === seq.current) { setErrors(err.errors || {}); setFrozen(Boolean(err.errors)); } },
      );
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, id, lang]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const home = await api.saveHome(id, draft);
      data.setData((d) => ({ ...d, home }));
      setErrors({});
    } catch (err) {
      setError(err.message);
      if (err.errors) setErrors(err.errors);
    } finally {
      setBusy(false);
    }
  };

  const view = useMemo(() => (preview && data.data ? smartHomeView({
    lodgingName: lodging.name, heroMediaId: data.data.config.heroMediaId, media: data.data.media, data: preview,
  }) : null), [preview, data.data, lodging.name]);

  const nErrors = Object.keys(errors).length;
  const bar = (
    <PageActionBar
      title="Domotique"
      subtitle={<Chip size="small" label={lodging.name} />}
      onSave={save}
      saveDisabled={!dirty || busy}
      saveBusy={busy}
      onCancel={() => { setDraft(saved); setError(null); setErrors({}); }}
      cancelDisabled={!dirty || busy}
    />
  );
  if (!draft) {
    return <StudioPage bar={bar}>{data.error ? <ErrorAlert message={data.error.message} onRetry={data.reload} /> : <LoadingState />}</StudioPage>;
  }
  const { channel, pickers } = data.data.home;
  const setBlock = (bi, block) => setDraft((d) => d.map((b, j) => (j === bi ? block : b)));

  return (
    <StudioPage
      bar={bar}
      preview={(
        <Box sx={{ display: 'grid', gap: 1 }}>
          {frozen ? <StatusBadge status="error" label={`Aperçu figé : ${nErrors} ${nErrors > 1 ? 'saisies refusées' : 'saisie refusée'}`} wrap /> : null}
          <PhonePreview view={view} title={`Aperçu · ${lodging.name}`} caption="Les vraies mesures, avec les réglages en cours." lang={lang} onLang={setLang} />
        </Box>
      )}
    >
      {error ? <ErrorAlert message={error} /> : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <StatusBadge status={HOME_CHANNEL_STATUS[channel.state] || 'neutral'} label={channel.message} wrap />
        {channel.state === 'off' || channel.state === 'never' ? (
          <Button href="/settings/integrations" variant="text" size="small">Réglages › Intégrations</Button>
        ) : null}
      </Box>
      <Section id="home-blocks" title={`Ce que voient les clients de ${lodging.name}`} description="Glisser pour changer l’ordre des blocs. Un bloc coupé n’apparaît pas ; la page entière n’existe que pendant le séjour, et seulement si le module Domotique est allumé.">
        <SortableList
          items={draft}
          getKey={(b) => b.kind}
          label={(b) => HOME_BLOCKS[b.kind].title}
          onMove={(from, to) => setDraft((d) => moveItem(d, from, to))}
          renderItem={(block, { index: bi, handle, up, down }) => {
            const meta = HOME_BLOCKS[block.kind];
            const blockError = errors[`blocks.${bi}.equipmentId`];
            return (
              <Box sx={{ py: 1, borderBottom: 1, borderColor: 'divider', display: 'grid', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 } }}>
                  {handle}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>{meta.title}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>{block.on ? meta.description : 'Coupé pour ce logement.'}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: { xs: 0.5, sm: 1 } }}>{up}{down}</Box>
                  <Switch
                    checked={block.on}
                    onChange={(e) => setBlock(bi, { ...block, on: e.target.checked })}
                    slotProps={{ input: { 'aria-label': `${meta.title} pour ${lodging.name}` } }}
                  />
                </Box>
                {block.on ? (
                  <Box sx={{ pl: { xs: 0, sm: 6 } }}>
                    {LIST_KINDS.includes(block.kind) ? (
                      <ListItems kind={block.kind} bi={bi} block={block} choices={pickers[block.kind] || []} errors={errors} onChange={(next) => setBlock(bi, next)} />
                    ) : (
                      <EquipmentPicker
                        id={`home-${block.kind}-equipment`}
                        label={meta.picker}
                        value={block.equipmentId}
                        choices={pickers[block.kind] || []}
                        error={blockError}
                        onChange={(equipmentId) => setBlock(bi, { ...block, equipmentId })}
                      />
                    )}
                  </Box>
                ) : null}
              </Box>
            );
          }}
        />
      </Section>
    </StudioPage>
  );
}
