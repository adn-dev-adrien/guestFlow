/**
 * EmailTextsSettingsPage — Paramètres › « Textes des emails », the single page where the guest emails
 * are written (specs/guest-email-texts-made-simple.md §3.B–3.F, §6).
 *
 *   - « À compléter » on top: what the server found missing (rules 6–7);
 *   - one section per email in send order, each with only its own sentences (rule 9), variables shown
 *     by their label (rule 10), the full template behind « Modifier le modèle complet »;
 *   - beside it (below on mobile, « Voir l'email »), the email rendered by the server from the draft,
 *     FR/EN, on the next stay or « Exemple », with « M'envoyer un test » (rules 13–15);
 *   - one file out, one file in, and the English filled by the platform's translator (rules 16–20);
 *   - one language at a time, FR | EN, with the server's « N à traduire » (rule 42);
 *   - variables on demand and refusals under their field, with a one-tap fix (rule 41);
 *   - a click on a sentence of the preview opens its field — beside it on a computer, in a sheet over
 *     the email on a phone (rule 45).
 *
 * The page holds drafts only; the server renders, validates and saves. `?propertyId=` picks the
 * property whose own texts are shown, `#<section>` opens one email.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, ButtonBase, Drawer, FormControl, InputLabel, Link, MenuItem, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import TranslateIcon from '@mui/icons-material/Translate';
import api from '../../api';
import PageActionBar from '../../components/PageActionBar';
import PageTabs from '../../components/PageTabs';
import TokenTextField from '../../components/TokenTextField';
import EmailPreviewPane, { SAMPLE } from '../../components/EmailPreviewPane';
import ReadinessList from '../../components/ReadinessList';
import EmailMentionsPanel from '../../components/EmailMentionsPanel';
import FormDialog from '../../components/FormDialog';
import StatusBadge from '../../components/StatusBadge';
import LoadingState from '../../components/LoadingState';
import ErrorAlert from '../../components/ErrorAlert';
import ConfirmDialog from '../../components/ConfirmDialog';
import useDirtyFormGuard from '../../hooks/useDirtyFormGuard';
import { useToast } from '../../components/DialogProvider';
import readTextFile from '../../utils/readTextFile';
import { buildDictionary, toDisplay } from '../../utils/tokenDisplay';
import { plural } from '../../utils/formatters';

const TABS = [
  { value: 'texts', label: 'Par email' },
  { value: 'mentions', label: 'Options citées' },
];
// Rule 13 — typing is debounced; every other trigger renders at once (rule 50).
const PREVIEW_DELAY_MS = 400;
const hasKeys = (object) => Object.keys(object || {}).length > 0;

export default function EmailTextsSettingsPage() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const fileInput = useRef(null);

  const [tab, setTab] = useState('texts');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [data, setData] = useState({ sections: [], properties: [], propertyId: null, canTranslate: false });
  const [readiness, setReadiness] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(location.hash ? location.hash.slice(1) : 'j2');
  const [templateBySection, setTemplateBySection] = useState({});
  const [mobilePreview, setMobilePreview] = useState(false);
  const [language, setLanguage] = useState('fr');
  const [reservationId, setReservationId] = useState(null);
  const [preview, setPreview] = useState({ subject: '', body: '', html: '', segments: null, reservations: [], loading: false, error: '', stale: '', notice: null, toTranslate: null });
  const [testMessage, setTestMessage] = useState('');
  const [fullTemplate, setFullTemplate] = useState(null);
  const [importPlan, setImportPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  // Rule 45 — the text whose sentence is highlighted in the preview, and the one opened in the phone's sheet.
  const [activeKey, setActiveKey] = useState(null);
  const [sheetKey, setSheetKey] = useState(null);
  const [focusKey, setFocusKey] = useState(null);
  const [unusedOpen, setUnusedOpen] = useState('');
  // Bumped on every load, so the preview re-renders what was just saved or imported.
  const [revision, setRevision] = useState(0);

  const propertyParam = new URLSearchParams(location.search).get('propertyId');

  const load = useCallback(async () => {
    try {
      const [texts, ready] = await Promise.all([api.getEmailTexts(propertyParam), api.getEmailReadiness()]);
      setData(texts);
      setReadiness(ready.items || []);
      setRevision((r) => r + 1);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [propertyParam]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (location.hash) setOpen(location.hash.slice(1));
  }, [location.hash]);

  const section = data.sections.find((s) => s.id === open) || null;
  const templateId = section ? (templateBySection[section.id] || (section.templates[0] || {}).id) : null;
  const dirty = Object.keys(drafts).length > 0;
  // Rule 42 — the server's count: of the saved texts, or of the draft while one is being typed.
  const toTranslate = (dirty && preview.toTranslate != null ? preview.toTranslate : data.toTranslate) || 0;

  // Typed sentences are not lost on a link, the menu, « Retour » or a reload (rule 34).
  const { guardDialogOpen, dismissGuard, confirmLeave } = useDirtyFormGuard({ draft: drafts, saved: {}, navigate });
  const leave = (path) => {
    const guard = window.__guestflowBeforeNavigate;
    if (typeof guard === 'function' && guard(path)) return;
    navigate(path);
  };
  // A link inside the page (« Traductions », the readiness list) goes through the same guard.
  const guardLinks = (event) => {
    if (!dirty || event.defaultPrevented) return;
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor || anchor.target === '_blank') return;
    const url = new URL(anchor.getAttribute('href'), window.location.href);
    if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
    event.preventDefault();
    event.stopPropagation();
    leave(`${url.pathname}${url.search}${url.hash}`);
  };

  const valueOf = (item, lang) => (drafts[item.key] && drafts[item.key][lang] !== undefined ? drafts[item.key][lang] : item[lang]);
  const edit = (item, lang, value) => {
    setDrafts((prev) => ({ ...prev, [item.key]: { ...(prev[item.key] || {}), [lang]: value } }));
    if (errors[item.key]) setErrors((prev) => { const next = { ...prev }; delete next[item.key]; return next; });
  };
  // A refusal as the field shows it: the message, the word typed and the server's suggestion (rule 41).
  const refusalOf = (err) => ({ message: err.message, unknown: err.unknown, suggestion: err.suggestion });

  // ---- live preview (rule 13): debounced, the server renders the draft
  const previewBody = useMemo(() => ({
    templateId,
    propertyId: data.propertyId,
    reservationId: reservationId || undefined,
    language,
    draft: { texts: drafts, ...(fullTemplate && fullTemplate.id === templateId ? { template: fullTemplate.draft } : {}) },
  }), [templateId, data.propertyId, reservationId, language, drafts, fullTemplate]);

  const typedDrafts = useRef({ drafts, full: null });
  useEffect(() => {
    if (!templateId || tab !== 'texts') return undefined;
    const fullDraft = fullTemplate && fullTemplate.id === templateId ? fullTemplate.draft : null;
    const typing = (drafts !== typedDrafts.current.drafts && hasKeys(drafts)) || (fullDraft !== typedDrafts.current.full && hasKeys(fullDraft));
    typedDrafts.current = { drafts, full: fullDraft };
    setPreview((p) => ({ ...p, loading: true }));
    // A newer draft supersedes this request: its late answer (or refusal) must not overwrite the newer preview.
    let superseded = false;
    const render = async () => {
      try {
        const r = await api.previewEmailDraft(previewBody);
        if (superseded) return;
        setPreview({
          subject: r.subject, body: r.body, html: r.html || '', segments: r.segments || null, subjectKey: r.subjectKey, reservations: r.reservations || [],
          loading: false, error: '', stale: '', notice: r.englishNotice, current: r.sample ? SAMPLE : r.reservationId,
          toTranslate: typeof r.toTranslate === 'number' ? r.toTranslate : null,
        });
      } catch (err) {
        if (superseded) return;
        // Rule 41 — a refused text is named under its field; the email stays as last rendered.
        if (err.key) {
          setErrors((prev) => ({ ...prev, [err.key]: { [err.field || 'fr']: refusalOf(err) } }));
          setPreview((p) => ({ ...p, loading: false, stale: 'Texte à corriger : l’aperçu montre le dernier texte valide.' }));
        } else {
          setPreview((p) => ({ ...p, loading: false, error: err.message || 'Aperçu impossible.' }));
        }
      }
    };
    let timer = null;
    if (typing) timer = setTimeout(render, PREVIEW_DELAY_MS); else render();
    return () => { superseded = true; clearTimeout(timer); };
  }, [previewBody, templateId, tab, revision]);

  async function sendTest() {
    setTestMessage('');
    try {
      const r = await api.sendTestEmail(previewBody);
      setTestMessage(`Envoyé à ${r.to}`);
    } catch (err) {
      setTestMessage(err.message || 'Envoi impossible');
    }
  }

  // ---- save, cancel
  async function save() {
    setSaving(true);
    try {
      await api.saveEmailTexts(drafts);
      setDrafts({});
      setErrors({});
      showSuccess('Textes enregistrés.');
      await load();
    } catch (err) {
      if (err.key) {
        setErrors({ [err.key]: { [err.field || 'fr']: refusalOf(err) } });
        const owner = data.sections.find((s) => s.items.some((i) => i.key === err.key));
        if (owner) setOpen(owner.id);
      }
      showError(err.message || 'Enregistrement impossible.');
    }
    setSaving(false);
  }

  async function confirmTranslation(item) {
    await api.confirmEmailText(item.key);
    await load();
  }

  // ---- file (rules 16–17) and translation (rule 19)
  async function exportFile() {
    try { await api.downloadEmailTexts(); } catch (err) { showError(err.message); }
  }
  async function readFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const csv = await readTextFile(file);
      const plan = await api.importEmailTexts(csv);
      setImportPlan({ ...plan, csv });
    } catch (err) {
      showError(err.message || 'Fichier illisible.');
    }
  }
  async function applyImport() {
    setBusy(true);
    try {
      await api.importEmailTexts(importPlan.csv, { confirm: true });
      showSuccess(`${plural(importPlan.changed.length, 'texte')} enregistré${importPlan.changed.length > 1 ? 's' : ''}.`);
      setImportPlan(null);
      await load();
    } catch (err) {
      showError(err.message || 'Import impossible.');
    }
    setBusy(false);
  }
  async function translate() {
    setBusy(true);
    try {
      const r = await api.translateEmailTexts();
      const done = r.translated ? `${plural(r.translated, 'texte')} traduit${r.translated > 1 ? 's' : ''}, à relire.` : 'Rien à traduire.';
      showSuccess(r.skipped ? `${done} ${r.skipped} à traduire à la main.` : done);
      await load();
    } catch (err) {
      showError(err.message || 'Traduction impossible.');
    }
    setBusy(false);
  }

  // ---- the full template (rule 9: behind « Modifier le modèle complet »)
  async function openFullTemplate() {
    const [template, chips] = await Promise.all([api.getEmailTemplate(templateId), api.getEmailTemplateVariables(templateId)]);
    setFullTemplate({ id: template.id, template, chips, draft: {}, error: null });
  }
  const fullValue = (field) => (fullTemplate.draft[field] !== undefined ? fullTemplate.draft[field] : fullTemplate.template[field] || '');
  const editFull = (field, value) => setFullTemplate((f) => ({ ...f, draft: { ...f.draft, [field]: value }, error: null }));
  async function saveFullTemplate() {
    try {
      await api.updateEmailTemplate(fullTemplate.id, fullTemplate.draft);
      setFullTemplate(null);
      showSuccess('Modèle enregistré.');
      await load();
    } catch (err) {
      setFullTemplate((f) => ({ ...f, error: { field: err.field, ...refusalOf(err) } }));
    }
  }

  // ---- rule 45: a sentence of the preview opens its field
  const allItems = data.sections.flatMap((s) => s.items);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A text folded away (its section closed, or under « Phrases non utilisées ») is unfolded first, then
  // reached once its field is shown.
  function openText(key) {
    const item = allItems.find((i) => i.key === key);
    if (!item) return;
    setActiveKey(key);
    if (!desktop) { setSheetKey(key); return; }
    const owner = data.sections.find((s) => s.items.some((i) => i.key === key));
    if (owner && owner.id !== open) setOpen(owner.id);
    if (owner && item.used === false) setUnusedOpen(owner.id);
    setFocusKey({ key });
  }
  useEffect(() => {
    if (!focusKey) return undefined;
    let tries = 0;
    let timer;
    // Waits (up to ~0.6 s) for the unfolding to show the field.
    const reach = () => {
      const field = document.getElementById(`${focusKey.key}-${language}`);
      tries += 1;
      if (!field || (field.offsetParent === null && tries < 12)) {
        if (tries < 12) timer = setTimeout(reach, 50);
        return;
      }
      field.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      field.focus({ preventScroll: true });
    };
    timer = setTimeout(reach, 0);
    return () => clearTimeout(timer);
  }, [focusKey, language, reducedMotion]);

  const pane = (
    <EmailPreviewPane
      subject={preview.subject}
      body={preview.body}
      html={preview.html}
      segments={preview.segments}
      subjectKey={preview.subjectKey}
      activeKey={activeKey}
      onSegmentClick={openText}
      onTemplateClick={templateId ? openFullTemplate : undefined}
      loading={preview.loading}
      error={preview.error}
      stale={preview.stale}
      language={language}
      notice={preview.notice}
      reservations={preview.reservations}
      reservationId={reservationId || preview.current || SAMPLE}
      onReservationChange={setReservationId}
      onSendTest={sendTest}
      testMessage={testMessage}
    />
  );

  // On a phone a sentence is one line until tapped: the J-2 alone holds dozens of them. The row says
  // what needs attention (English missing, machine translation to read).
  const englishMissing = (item) => Boolean(String(valueOf(item, 'fr')).trim()) && !String(valueOf(item, 'en')).trim();
  const compactOf = (item) => {
    const shownLanguage = language === 'en' && String(valueOf(item, 'en')).trim() ? 'en' : 'fr';
    const dict = buildDictionary(item.chips.variables, item.chips.conditions);
    // A property's own text left empty: the shared text is what the guest reads (rule 34).
    const inherited = !String(valueOf(item, 'fr')).trim() && item.placeholderFr ? toDisplay(item.placeholderFr, dict) : '';
    return (
      <ButtonBase
        key={item.key}
        onClick={() => setEditingKey(item.key)}
        aria-label={`Modifier ${item.label}`}
        sx={{ display: 'block', width: '100%', textAlign: 'left', borderBottom: 1, borderColor: 'divider', py: 1, minHeight: 44 }}
      >
        <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography component="span" variant="subtitle2">{item.label}</Typography>
          {englishMissing(item) && <StatusBadge status="warning" label={language === 'en' ? 'À traduire' : 'EN manquant'} />}
          {item.autoTranslated && <StatusBadge status="info" label="À relire" />}
        </Box>
        {inherited ? (
          <Typography component="span" variant="body2" color="text.disabled" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600 }}>Texte commun utilisé : </Box>
            {inherited}
          </Typography>
        ) : (
          <Typography component="span" variant="body2" color={valueOf(item, shownLanguage) ? 'text.secondary' : 'text.disabled'} sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {toDisplay(valueOf(item, shownLanguage), dict) || 'Vide'}
          </Typography>
        )}
      </ButtonBase>
    );
  };
  const fieldOf = (item) => (!desktop && editingKey !== item.key && !errors[item.key] ? compactOf(item) : editorOf(item));
  const editorOf = (item, { inSheet = false } = {}) => (
    <TokenTextField
      key={item.key}
      id={inSheet ? `sheet-${item.key}` : item.key}
      label={item.label}
      language={language}
      onFocus={() => setActiveKey(item.key)}
      fr={valueOf(item, 'fr')}
      en={valueOf(item, 'en')}
      onChange={(lang, value) => edit(item, lang, value)}
      tokens={item.chips.variables}
      flags={item.chips.conditions}
      errorFr={errors[item.key]?.fr}
      errorEn={errors[item.key]?.en}
      placeholderFr={item.placeholderFr || 'Vide : pas de phrase'}
      placeholderEn={item.placeholderEn || 'Vide : pas de phrase'}
      emptyHint={item.placeholderFr ? 'Vide : texte commun utilisé' : undefined}
      disabled={saving}
      autoFocus={inSheet || (!desktop && editingKey === item.key)}
      badge={(
        <>
          {language === 'en' && englishMissing(item) && <StatusBadge status="warning" label="À traduire" />}
          {item.autoTranslated && <StatusBadge status="info" label="Traduit automatiquement, à relire" />}
        </>
      )}
      helper={(
        <Stack direction="row" spacing={1}>
          {item.autoTranslated && <Button size="small" onClick={() => confirmTranslation(item)}>Relu</Button>}
          {item.kind === 'text' && (valueOf(item, 'fr') !== item.defaultFr || valueOf(item, 'en') !== item.defaultEn) && (
            <Button size="small" color="inherit" onClick={() => setDrafts((prev) => ({ ...prev, [item.key]: { fr: item.defaultFr, en: item.defaultEn } }))}>
              Rétablir le texte par défaut
            </Button>
          )}
        </Stack>
      )}
    />
  );

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1400, mx: 'auto' }} onClickCapture={guardLinks}>
      <PageActionBar
        title={desktop ? 'Textes des emails' : 'Textes'}
        onBack={() => leave('/settings/emails')}
        tabs={<PageTabs value={tab} onChange={setTab} items={TABS} ariaLabel="Textes des emails" />}
        onSave={tab === 'texts' ? save : undefined}
        saveDisabled={!dirty || saving}
        saveBusy={saving}
        onCancel={tab === 'texts' ? () => { setDrafts({}); setErrors({}); } : undefined}
        cancelDisabled={!dirty || saving}
        actionsBefore={tab === 'texts' ? [
          { icon: <DownloadIcon />, tooltip: 'Exporter les textes', onClick: exportFile, color: 'info' },
          { icon: <UploadIcon />, tooltip: 'Importer', onClick: () => fileInput.current && fileInput.current.click(), color: 'info', disabled: dirty || busy },
        ] : []}
      />
      <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={readFile} data-testid="email-texts-file" />

      {loadError && <ErrorAlert message="Impossible de charger les textes." onRetry={load} sx={{ mt: 2 }} />}
      {loading && <LoadingState />}
      {!loading && tab === 'mentions' && <Box sx={{ mt: 2 }}><EmailMentionsPanel onChanged={load} /></Box>}
      {!loading && tab === 'texts' && (
        <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 0.85fr)' }, gap: 2, alignItems: 'start' }}>
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            <ReadinessList items={readiness} />
            {/* Rule 24 — option and resource names are translated in the catalogue, not here. */}
            <Link component={RouterLink} to="/settings/systeme" variant="body2">Noms des options et des ressources : Traductions</Link>
            {data.properties.length > 1 && (
              <FormControl size="small" sx={{ maxWidth: 320 }}>
                <InputLabel id="texts-property">Logement</InputLabel>
                <Select
                  labelId="texts-property"
                  label="Logement"
                  value={data.propertyId || ''}
                  disabled={dirty}
                  onChange={(e) => navigate({ search: `?propertyId=${e.target.value}`, hash: location.hash }, { replace: true })}
                >
                  {data.properties.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={language}
                onChange={(e, v) => v && setLanguage(v)}
                aria-label="Langue des textes"
              >
                <ToggleButton value="fr" sx={{ minWidth: 56, minHeight: 40, '@media (pointer: coarse)': { minHeight: 44 } }}>FR</ToggleButton>
                <ToggleButton value="en" sx={{ minWidth: 56, minHeight: 40, '@media (pointer: coarse)': { minHeight: 44 } }}>EN</ToggleButton>
              </ToggleButtonGroup>
              <StatusBadge
                status={toTranslate ? 'warning' : 'success'}
                label={toTranslate ? `${toTranslate} à traduire` : 'Anglais complet'}
              />
              {data.canTranslate && toTranslate > 0 && (
                <Button size="small" startIcon={<TranslateIcon />} onClick={translate} disabled={dirty || busy} aria-label="Traduire les textes manquants" sx={{ minHeight: 40, '@media (pointer: coarse)': { minHeight: 44 } }}>
                  Traduire
                </Button>
              )}
            </Stack>
            {data.sections.map((s) => (
              <Accordion
                key={s.id}
                id={s.id}
                expanded={open === s.id}
                onChange={(e, expanded) => { setOpen(expanded ? s.id : ''); setReservationId(null); setMobilePreview(false); setTestMessage(''); }}
                disableGutters
                variant="outlined"
                slotProps={{ transition: { unmountOnExit: true } }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48 }}>
                  {/* Rule 44 — one name per email, in stay order, with its « Quand ». */}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>{s.title}</Typography>
                    {s.when && <Typography variant="body2" color="text.secondary">{s.when}</Typography>}
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    {s.templates.length > 1 && (
                      <FormControl size="small">
                        <InputLabel id={`tpl-${s.id}`}>Email</InputLabel>
                        <Select
                          labelId={`tpl-${s.id}`}
                          label="Email"
                          value={templateBySection[s.id] || s.templates[0].id}
                          onChange={(e) => { setTemplateBySection((m) => ({ ...m, [s.id]: e.target.value })); setReservationId(null); }}
                        >
                          {s.templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                    )}
                    {s.items.filter((i) => i.used !== false).map(fieldOf)}
                    {/* Rule 25 — sentences the stored template never places, out of the way. */}
                    {s.items.some((i) => i.used === false) && (
                      <Accordion
                        disableGutters
                        variant="outlined"
                        expanded={unusedOpen === s.id}
                        onChange={(e, expanded) => setUnusedOpen(expanded ? s.id : '')}
                        slotProps={{ transition: { unmountOnExit: true } }}
                        sx={{ bgcolor: 'background.default' }}
                      >
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Typography variant="body2" color="text.secondary">
                            {`Phrases non utilisées par le modèle (${s.items.filter((i) => i.used === false).length})`}
                          </Typography>
                        </AccordionSummary>
                        <AccordionDetails><Stack spacing={2}>{s.items.filter((i) => i.used === false).map(fieldOf)}</Stack></AccordionDetails>
                      </Accordion>
                    )}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button variant="outlined" onClick={openFullTemplate} disabled={!templateId} sx={{ minHeight: 44 }}>Modifier le modèle complet</Button>
                      {!desktop && (
                        <Button variant="contained" onClick={() => setMobilePreview((v) => !v)} sx={{ minHeight: 44 }}>
                          {mobilePreview ? 'Masquer l’email' : 'Voir l’email'}
                        </Button>
                      )}
                    </Stack>
                    {!desktop && mobilePreview && open === s.id && pane}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
          </Stack>
          {desktop && section && <Box sx={{ position: 'sticky', top: 128 }}>{pane}</Box>}
        </Box>
      )}

      <ConfirmDialog
        open={guardDialogOpen}
        onClose={dismissGuard}
        onConfirm={confirmLeave}
        title="Modifications non enregistrées"
        message="Des textes ne sont pas enregistrés. Quitter sans enregistrer ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="warning"
      />

      {/* Rule 45 — on a phone, the sentence tapped in the email opens in a sheet over it. */}
      <Drawer
        anchor="bottom"
        open={Boolean(sheetKey) && !desktop}
        onClose={() => setSheetKey(null)}
        slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, p: 2, pb: 'max(16px, env(safe-area-inset-bottom))', maxHeight: '85vh' } } }}
      >
        {sheetKey && allItems.some((i) => i.key === sheetKey) && (
          <Stack spacing={1.5}>
            {editorOf(allItems.find((i) => i.key === sheetKey), { inSheet: true })}
            <Button variant="contained" onClick={() => setSheetKey(null)} sx={{ minHeight: 44 }}>OK</Button>
          </Stack>
        )}
      </Drawer>

      <FormDialog
        open={Boolean(fullTemplate)}
        onClose={() => setFullTemplate(null)}
        title="Modèle complet"
        onSubmit={saveFullTemplate}
        submitDisabled={!fullTemplate || !Object.keys(fullTemplate.draft).length}
        maxWidth="md"
      >
        {fullTemplate && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <ToggleButtonGroup size="small" exclusive value={language} onChange={(e, v) => v && setLanguage(v)} aria-label="Langue du modèle" sx={{ alignSelf: 'flex-start' }}>
              <ToggleButton value="fr" sx={{ minWidth: 56, minHeight: 40, '@media (pointer: coarse)': { minHeight: 44 } }}>FR</ToggleButton>
              <ToggleButton value="en" sx={{ minWidth: 56, minHeight: 40, '@media (pointer: coarse)': { minHeight: 44 } }}>EN</ToggleButton>
            </ToggleButtonGroup>
            {[['subject', 'subjectEn', 'Objet'], ['body', 'bodyEn', 'Corps']].map(([frField, enField, label]) => {
              // Rule 41 — one notation everywhere: the subject shows its variables by their label too.
              const subjectChips = (allItems.find((i) => i.key === `subject:${fullTemplate.template.stableKey}`) || {}).chips;
              const chips = frField === 'body' ? fullTemplate.chips : (subjectChips || { variables: fullTemplate.chips.variables, conditions: [] });
              return (
                <TokenTextField
                  key={frField}
                  id={`full-${frField}`}
                  label={label}
                  language={language}
                  fr={fullValue(frField)}
                  en={fullValue(enField)}
                  onChange={(lang, value) => editFull(lang === 'fr' ? frField : enField, value)}
                  tokens={chips.variables}
                  flags={chips.conditions}
                  minRows={frField === 'body' ? 8 : 1}
                  errorFr={fullTemplate.error && fullTemplate.error.field === frField ? fullTemplate.error : undefined}
                  errorEn={fullTemplate.error && fullTemplate.error.field === enField ? fullTemplate.error : undefined}
                />
              );
            })}
          </Stack>
        )}
      </FormDialog>

      <FormDialog
        open={Boolean(importPlan)}
        onClose={() => setImportPlan(null)}
        title="Importer les textes"
        onSubmit={applyImport}
        submitLabel={importPlan ? `Enregistrer ${importPlan.changed.length}` : 'Enregistrer'}
        submitDisabled={!importPlan || !importPlan.changed.length}
        submitBusy={busy}
        maxWidth="md"
      >
        {importPlan && (
          <Stack spacing={2}>
            <Typography sx={{ fontWeight: 600 }}>
              {`${plural(importPlan.changed.length, 'texte')} modifié${importPlan.changed.length > 1 ? 's' : ''}, ${importPlan.refused.length} refusé${importPlan.refused.length > 1 ? 's' : ''}`}
            </Typography>
            {(importPlan.changed.length > 0 || importPlan.refused.length > 0) && (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Ligne</TableCell><TableCell>Texte</TableCell><TableCell>Français</TableCell><TableCell>Anglais</TableCell></TableRow></TableHead>
                  <TableBody>
                    {importPlan.changed.map((c) => (
                      <TableRow key={`c-${c.line}`}>
                        <TableCell>{c.line}</TableCell>
                        <TableCell>{c.description}</TableCell>
                        <TableCell sx={{ fontWeight: c.fr !== undefined ? 600 : 400 }}>{c.frShown}</TableCell>
                        <TableCell sx={{ fontWeight: c.en !== undefined ? 600 : 400 }}>{c.enShown}</TableCell>
                      </TableRow>
                    ))}
                    {importPlan.refused.map((r) => (
                      <TableRow key={`r-${r.line}`}>
                        <TableCell>{r.line}</TableCell>
                        <TableCell><StatusBadge status="error" label="Refusée" /></TableCell>
                        <TableCell colSpan={2} sx={{ color: 'error.main' }}>{r.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Stack>
        )}
      </FormDialog>
    </Box>
  );
}
