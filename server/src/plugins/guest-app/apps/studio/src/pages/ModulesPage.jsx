/**
 * Modules — what this lodging's guests see on their home (rule 11bis): each module on or off, in the lodging's
 * order (drag, or « Monter » / « Descendre »). A module off disappears from the app, without a greyed tile. Saved
 * with the bar; the preview shows the result before « Enregistrer ».
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box, Chip, Switch, Typography,
} from '@mui/material';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import StudioPage from '../components/StudioPage';
import Section from '../components/Section';
import SortableList, { moveItem } from '../components/SortableList';
import PhonePreview from '../components/PhonePreview';
import ModuleIcon from '../components/ModuleIcon';
import { MODULES } from '../constants/studio';
import { useLoad } from '../hooks/useLoad';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { usePreviewLang } from '../hooks/usePreviewLang';
import { homeView } from '../utils/previewViews';
import { api } from '../services/api';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function ModulesPage({ lodging }) {
  const id = lodging.propertyId;
  const data = useLoad(() => Promise.all([api.lodging(id), api.settings(), api.media()]).then(([config, settings, media]) => ({ config, settings, media })), [id]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lang, setLang] = usePreviewLang();

  const saved = data.data ? data.data.config.modules.map(({ key, on }) => ({ key, on })) : null;
  useEffect(() => { if (saved) setDraft(saved); }, [data.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = Boolean(draft && saved && !same(draft, saved));
  useDirtyGuard(dirty);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const config = await api.saveLodging(id, { modules: draft.map((m, order) => ({ ...m, order })) });
      data.setData((d) => ({ ...d, config }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const view = useMemo(() => (draft && data.data ? homeView({
    lodgingName: lodging.name, modules: draft, heroMediaId: data.data.config.heroMediaId, media: data.data.media, settings: data.data.settings, lang,
  }) : null), [draft, data.data, lodging.name, lang]);

  const bar = (
    <PageActionBar
      title="Modules"
      subtitle={<Chip size="small" label={lodging.name} />}
      onSave={save}
      saveDisabled={!dirty || busy}
      saveBusy={busy}
      onCancel={() => { setDraft(saved); setError(null); }}
      cancelDisabled={!dirty || busy}
    />
  );
  if (!draft) {
    return <StudioPage bar={bar}>{data.error ? <ErrorAlert message={data.error.message} onRetry={data.reload} /> : <LoadingState />}</StudioPage>;
  }
  return (
    <StudioPage
      bar={bar}
      preview={<PhonePreview view={view} title={`Aperçu · ${lodging.name}`} caption="Ce que verront les clients après « Enregistrer »." lang={lang} onLang={setLang} />}
    >
      {error ? <ErrorAlert message={error} /> : null}
      <Section id="modules" title={`Ce que voient les clients de ${lodging.name}`} description="Glisser pour changer l’ordre des tuiles. Un module coupé disparaît de l’app, sans tuile grisée.">
        <SortableList
          items={draft}
          getKey={(m) => m.key}
          label={(m) => MODULES[m.key].label.fr}
          onMove={(from, to) => setDraft((d) => moveItem(d, from, to))}
          renderItem={(m, { handle, up, down }) => (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
              {handle}
              <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'action.hover', display: { xs: 'none', sm: 'grid' }, placeItems: 'center', flexShrink: 0, color: 'primary.main' }}>
                <ModuleIcon module={m.key} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{MODULES[m.key].label.fr}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{m.on ? MODULES[m.key].hint : 'Coupé pour ce logement.'}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: { xs: 0.5, sm: 1 } }}>{up}{down}</Box>
              <Switch
                checked={m.on}
                onChange={(e) => setDraft((d) => d.map((x) => (x.key === m.key ? { ...x, on: e.target.checked } : x)))}
                slotProps={{ input: { 'aria-label': `${MODULES[m.key].label.fr} pour ${lodging.name}` } }}
              />
            </Box>
          )}
        />
      </Section>
    </StudioPage>
  );
}
