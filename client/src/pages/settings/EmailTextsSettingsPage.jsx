/**
 * EmailTextsSettingsPage — Paramètres › « Textes des emails », the single page where the guest emails
 * are written (specs/guest-email-texts-made-simple.md §3.B–3.F, §6).
 *
 *   - « À compléter » on top: what the server found missing (rules 6–7);
 *   - one section per email in send order, each with only its own sentences (rule 9), variables shown
 *     by their label (rule 10), the full template behind « Modifier le modèle complet »;
 *   - beside it (below on mobile, « Voir l'email »), the email rendered by the server from the draft,
 *     FR/EN, on the next stay or « Exemple », with « M'envoyer un test » (rules 13–15);
 *   - one file out, one file in, and the English filled by the platform's translator (rules 16–20).
 *
 * The page holds drafts only; the server renders, validates and saves. `?propertyId=` picks the
 * property whose own texts are shown, `#<section>` opens one email.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, FormControl, InputLabel, MenuItem, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Typography, useMediaQuery,
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
import { useToast } from '../../components/DialogProvider';

const TABS = [
  { value: 'texts', label: 'Par email' },
  { value: 'mentions', label: 'Options citées' },
];
const PREVIEW_DELAY_MS = 400;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

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
  const [preview, setPreview] = useState({ subject: '', body: '', reservations: [], loading: false, error: '', notice: null });
  const [testMessage, setTestMessage] = useState('');
  const [fullTemplate, setFullTemplate] = useState(null);
  const [importPlan, setImportPlan] = useState(null);
  const [busy, setBusy] = useState(false);
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

  const valueOf = (item, lang) => (drafts[item.key] && drafts[item.key][lang] !== undefined ? drafts[item.key][lang] : item[lang]);
  const edit = (item, lang, value) => {
    setDrafts((prev) => ({ ...prev, [item.key]: { ...(prev[item.key] || {}), [lang]: value } }));
    if (errors[item.key]) setErrors((prev) => { const next = { ...prev }; delete next[item.key]; return next; });
  };

  // ---- live preview (rule 13): debounced, the server renders the draft
  const previewBody = useMemo(() => ({
    templateId,
    propertyId: data.propertyId,
    reservationId: reservationId || undefined,
    language,
    draft: { texts: drafts, ...(fullTemplate && fullTemplate.id === templateId ? { template: fullTemplate.draft } : {}) },
  }), [templateId, data.propertyId, reservationId, language, drafts, fullTemplate]);

  useEffect(() => {
    if (!templateId || tab !== 'texts') return undefined;
    setPreview((p) => ({ ...p, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const r = await api.previewEmailDraft(previewBody);
        setPreview({
          subject: r.subject, body: r.body, reservations: r.reservations || [], loading: false, error: '',
          notice: r.englishNotice, current: r.sample ? SAMPLE : r.reservationId,
        });
      } catch (err) {
        if (err.key) setErrors((prev) => ({ ...prev, [err.key]: { [err.field || 'fr']: err.message } }));
        setPreview((p) => ({ ...p, loading: false, error: err.message || 'Aperçu impossible.' }));
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
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
        setErrors({ [err.key]: { [err.field || 'fr']: err.message } });
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
    const csv = await file.text();
    try {
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
      showSuccess(r.translated ? `${plural(r.translated, 'texte')} traduit${r.translated > 1 ? 's' : ''}, à relire.` : 'Rien à traduire.');
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
      setFullTemplate((f) => ({ ...f, error: { field: err.field, message: err.message } }));
    }
  }

  const pane = (
    <EmailPreviewPane
      subject={preview.subject}
      body={preview.body}
      loading={preview.loading}
      error={preview.error}
      language={language}
      onLanguageChange={setLanguage}
      notice={preview.notice}
      reservations={preview.reservations}
      reservationId={reservationId || preview.current || SAMPLE}
      onReservationChange={setReservationId}
      onSendTest={sendTest}
      testMessage={testMessage}
    />
  );

  const fieldOf = (item) => (
    <TokenTextField
      key={item.key}
      id={item.key}
      label={item.label}
      fr={valueOf(item, 'fr')}
      en={valueOf(item, 'en')}
      onChange={(lang, value) => edit(item, lang, value)}
      tokens={item.chips.variables}
      flags={item.chips.conditions}
      errorFr={errors[item.key]?.fr}
      errorEn={errors[item.key]?.en}
      placeholderFr={item.placeholderFr || 'Vide : pas de phrase'}
      placeholderEn={item.placeholderEn || 'Vide : pas de phrase'}
      disabled={saving}
      badge={item.autoTranslated && <StatusBadge status="info" label="Traduit automatiquement, à relire" />}
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
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1400, mx: 'auto' }}>
      <PageActionBar
        title="Textes des emails"
        backTo="/settings/emails"
        tabs={<PageTabs value={tab} onChange={setTab} items={TABS} ariaLabel="Textes des emails" />}
        onSave={tab === 'texts' ? save : undefined}
        saveDisabled={!dirty || saving}
        saveBusy={saving}
        onCancel={tab === 'texts' ? () => { setDrafts({}); setErrors({}); } : undefined}
        cancelDisabled={!dirty || saving}
        actionsBefore={tab === 'texts' ? [
          { icon: <DownloadIcon />, tooltip: 'Exporter les textes', onClick: exportFile, color: 'info' },
          { icon: <UploadIcon />, tooltip: 'Importer', onClick: () => fileInput.current && fileInput.current.click(), color: 'info', disabled: dirty || busy },
          ...(data.canTranslate ? [{ icon: <TranslateIcon />, tooltip: 'Traduire les textes manquants', onClick: translate, color: 'info', disabled: dirty || busy }] : []),
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
            {data.sections.map((s, index) => (
              <Accordion
                key={s.id}
                id={s.id}
                expanded={open === s.id}
                onChange={(e, expanded) => { setOpen(expanded ? s.id : ''); setReservationId(null); setMobilePreview(false); setTestMessage(''); }}
                disableGutters
                variant="outlined"
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48 }}>
                  <Typography sx={{ fontWeight: 600 }}>{`${index + 1}. ${s.title}`}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    {s.templates.length > 1 && (
                      <FormControl size="small">
                        <InputLabel id={`tpl-${s.id}`}>Email</InputLabel>
                        <Select
                          labelId={`tpl-${s.id}`}
                          label="Email"
                          value={templateId || ''}
                          onChange={(e) => { setTemplateBySection((m) => ({ ...m, [s.id]: e.target.value })); setReservationId(null); }}
                        >
                          {s.templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                    )}
                    {s.items.map(fieldOf)}
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
            {[['subject', 'subjectEn', 'Objet'], ['body', 'bodyEn', 'Corps']].map(([frField, enField, label]) => (
              <TokenTextField
                key={frField}
                label={label}
                fr={fullValue(frField)}
                en={fullValue(enField)}
                onChange={(lang, value) => editFull(lang === 'fr' ? frField : enField, value)}
                tokens={frField === 'body' ? fullTemplate.chips.variables : []}
                flags={frField === 'body' ? fullTemplate.chips.conditions : []}
                errorFr={fullTemplate.error && fullTemplate.error.field === frField ? fullTemplate.error.message : undefined}
                errorEn={fullTemplate.error && fullTemplate.error.field === enField ? fullTemplate.error.message : undefined}
              />
            ))}
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
                  <TableHead><TableRow><TableCell>Ligne</TableCell><TableCell>Texte</TableCell><TableCell>Détail</TableCell></TableRow></TableHead>
                  <TableBody>
                    {importPlan.changed.map((c) => (
                      <TableRow key={`c-${c.line}`}>
                        <TableCell>{c.line}</TableCell>
                        <TableCell>{c.description}</TableCell>
                        <TableCell>{c.fr !== undefined ? c.fr : c.en}</TableCell>
                      </TableRow>
                    ))}
                    {importPlan.refused.map((r) => (
                      <TableRow key={`r-${r.line}`}>
                        <TableCell>{r.line}</TableCell>
                        <TableCell><StatusBadge status="error" label="Refusée" /></TableCell>
                        <TableCell sx={{ color: 'error.main' }}>{r.message}</TableCell>
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
