/**
 * EmailTextsSettingsPage — Réglages › Emails › « Textes des mails » (specs/plugins-phase-p-productisation.md
 * §6). Three tabs:
 *   - Par mail: the stay texts grouped by email, French and English, with their tokens and « Rétablir »;
 *   - Options citées: the mentions by section, their proposal order, then the confirmation order;
 *   - Aperçu: the offers and confirmations as the guest reads them, rendered by the server.
 *
 * Every text is validated by the server: an unknown token comes back as a 422 shown under its field.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Card, CardContent, FormControl, IconButton, InputLabel, List, ListItem, ListItemText, MenuItem,
  Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import api from '../../api';
import PageActionBar from '../../components/PageActionBar';
import PageTabs from '../../components/PageTabs';
import TokenTextField from '../../components/TokenTextField';
import MentionEditor, { SECTIONS } from '../../components/MentionEditor';
import FormDialog from '../../components/FormDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingState from '../../components/LoadingState';
import ErrorAlert from '../../components/ErrorAlert';
import { useToast } from '../../components/DialogProvider';

const TABS = [
  { value: 'texts', label: 'Par mail' },
  { value: 'mentions', label: 'Options citées' },
  { value: 'preview', label: 'Aperçu' },
];
const MAIL_ORDER = ['J-7', 'J-2', 'J+1', 'Novembre'];
const EMPTY_MENTION = { section: 'extras', optionIds: [], priceSource: 'min', priceOptionId: null, offerFr: '', offerEn: '', bookedFr: '', bookedEn: '' };
const TYPED_LABELS = { babyBed: 'Lit bébé', towels: 'Serviettes de toilette' };

const move = (list, index, delta) => {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item);
  return next;
};

function OrderButtons({ index, length, onMove, label }) {
  return (
    <>
      <Tooltip title="Monter"><span><IconButton size="small" aria-label={`Monter ${label}`} disabled={index === 0} onClick={() => onMove(index, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title="Descendre"><span><IconButton size="small" aria-label={`Descendre ${label}`} disabled={index === length - 1} onClick={() => onMove(index, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
    </>
  );
}

export default function EmailTextsSettingsPage() {
  const { showSuccess, showError } = useToast();
  const [tab, setTab] = useState('texts');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [texts, setTexts] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [mentions, setMentions] = useState([]);
  const [confirmationOrder, setConfirmationOrder] = useState([]);
  const [options, setOptions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [properties, setProperties] = useState([]);
  const [sample, setSample] = useState({ propertyId: '', children: '1', startDate: '' });
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    try {
      const [t, m, o, p] = await Promise.all([api.getStayTexts(), api.getEmailMentions(), api.getOptions(), api.getProperties()]);
      setTexts(t.texts || []);
      setDrafts({});
      setMentions(m.mentions || []);
      setConfirmationOrder(m.confirmationOrder || []);
      setOptions((Array.isArray(o) ? o : o.options || []).map((x) => ({ id: x.id, title: x.title })));
      const list = Array.isArray(p) ? p : p.properties || [];
      setProperties(list);
      setSample((s) => ({ ...s, propertyId: s.propertyId || (list[0] && list[0].id) || '' }));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---- Par mail
  const byMail = useMemo(() => MAIL_ORDER
    .map((mail) => ({ mail, rows: texts.filter((t) => t.email === mail) }))
    .filter((g) => g.rows.length), [texts]);
  const dirtyKeys = Object.keys(drafts);
  const valueOf = (row, lang) => (drafts[row.key] && drafts[row.key][lang] !== undefined ? drafts[row.key][lang] : row[lang]);

  const editText = (row, lang, value) => {
    setDrafts((prev) => ({ ...prev, [row.key]: { fr: valueOf(row, 'fr'), en: valueOf(row, 'en'), [lang]: value } }));
    if (errors[row.key]) setErrors((prev) => { const next = { ...prev }; delete next[row.key]; return next; });
  };

  async function saveTexts() {
    setSaving(true);
    const nextErrors = {};
    for (const key of dirtyKeys) {
      try {
        await api.saveStayText(key, drafts[key]);
      } catch (err) {
        nextErrors[key] = { [err.field || 'fr']: err.message };
      }
    }
    setSaving(false);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showError('Vérifiez les champs en erreur.');
      const t = await api.getStayTexts();
      setTexts(t.texts || []);
      setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => nextErrors[key])));
      return;
    }
    showSuccess('Textes enregistrés.');
    load();
  }

  async function resetText(key) {
    await api.resetStayText(key);
    setDrafts((prev) => { const next = { ...prev }; delete next[key]; return next; });
    const t = await api.getStayTexts();
    setTexts(t.texts || []);
  }

  // ---- Options citées
  const optionTitle = (id) => (options.find((o) => o.id === id) || {}).title || `#${id}`;
  const mentionLabel = (m) => (m.optionIds || []).map(optionTitle).join(', ') || 'Sans option';

  async function moveMention(section, index, delta) {
    const inSection = mentions.filter((m) => m.section === section);
    const moved = move(inSection, index, delta);
    const ids = SECTIONS.flatMap((s) => (s.value === section ? moved : mentions.filter((m) => m.section === s.value))).map((m) => m.id);
    const result = await api.reorderEmailMentions(ids);
    setMentions(result.mentions || []);
  }

  const confirmationItems = useMemo(() => {
    const known = [...confirmationOrder];
    for (const item of ['babyBed', 'towels', ...mentions.map((m) => `mention:${m.id}`)]) if (!known.includes(item)) known.push(item);
    return known;
  }, [confirmationOrder, mentions]);
  const confirmationLabel = (item) => {
    if (TYPED_LABELS[item]) return TYPED_LABELS[item];
    const mention = mentions.find((m) => `mention:${m.id}` === item);
    return mention ? mentionLabel(mention) : item;
  };

  async function moveConfirmation(index, delta) {
    const result = await api.saveConfirmationOrder(move(confirmationItems, index, delta));
    setConfirmationOrder(result.confirmationOrder || []);
  }

  async function saveMention() {
    setEditError(null);
    try {
      if (editing.id) await api.updateEmailMention(editing.id, editing);
      else await api.createEmailMention(editing);
      setEditing(null);
      showSuccess('Phrase enregistrée.');
      load();
    } catch (err) {
      setEditError({ field: err.field, message: err.message });
    }
  }

  async function removeMention() {
    await api.deleteEmailMention(deleting.id);
    setDeleting(null);
    load();
  }

  // ---- Aperçu
  async function runPreview() {
    try {
      setPreview(await api.previewEmailMentions({ propertyId: Number(sample.propertyId), children: Number(sample.children) || 0, startDate: sample.startDate || undefined }));
    } catch (err) {
      showError(err?.message || 'Aperçu impossible.');
    }
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <PageActionBar
        title="Textes des mails"
        backTo="/settings/emails"
        tabs={<PageTabs value={tab} onChange={setTab} items={TABS} ariaLabel="Textes des mails" />}
        onSave={tab === 'texts' ? saveTexts : undefined}
        saveDisabled={!dirtyKeys.length || saving}
        saveBusy={saving}
        onCancel={tab === 'texts' ? () => { setDrafts({}); setErrors({}); } : undefined}
        cancelDisabled={!dirtyKeys.length || saving}
      />

      {loadError && <ErrorAlert message="Impossible de charger les textes." onRetry={load} sx={{ mb: 2 }} />}
      {loading ? <LoadingState /> : (
        <Stack spacing={3} sx={{ mt: 2 }}>
          {tab === 'texts' && byMail.map(({ mail, rows }) => (
            <Card key={mail} variant="outlined">
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography variant="sectionHeader" sx={{ mb: 2, display: 'block' }}>{mail}</Typography>
                <Stack spacing={2.5}>
                  {rows.map((row) => (
                    <TokenTextField
                      key={row.key}
                      label={row.label}
                      fr={valueOf(row, 'fr')}
                      en={valueOf(row, 'en')}
                      onChange={(lang, value) => editText(row, lang, value)}
                      tokens={row.tokens}
                      flags={row.flags}
                      errorFr={errors[row.key]?.fr}
                      errorEn={errors[row.key]?.en}
                      placeholderFr="Vide : pas de paragraphe"
                      placeholderEn="Vide : pas de paragraphe"
                      disabled={saving}
                      helper={!row.isDefault && (
                        <Button size="small" color="inherit" onClick={() => resetText(row.key)}>Rétablir le texte par défaut</Button>
                      )}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          ))}

          {tab === 'mentions' && (
            <>
              {SECTIONS.map((section) => {
                const inSection = mentions.filter((m) => m.section === section.value);
                return (
                  <Card key={section.value} variant="outlined">
                    <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="sectionHeader">{section.label}</Typography>
                        <Button size="small" startIcon={<AddIcon />} onClick={() => { setEditError(null); setEditing({ ...EMPTY_MENTION, section: section.value }); }}>Ajouter</Button>
                      </Box>
                      <List dense>
                        {inSection.map((m, index) => (
                          <ListItem
                            key={m.id}
                            disableGutters
                            secondaryAction={(
                              <Box>
                                <OrderButtons index={index} length={inSection.length} onMove={(i, d) => moveMention(section.value, i, d)} label={mentionLabel(m)} />
                                <Tooltip title="Modifier"><IconButton size="small" aria-label={`Modifier ${mentionLabel(m)}`} onClick={() => { setEditError(null); setEditing({ ...m }); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                <Tooltip title="Supprimer"><IconButton size="small" aria-label={`Supprimer ${mentionLabel(m)}`} onClick={() => setDeleting(m)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                              </Box>
                            )}
                            sx={{ pr: 18 }}
                          >
                            <ListItemText primary={m.offerFr} secondary={mentionLabel(m)} />
                          </ListItem>
                        ))}
                        {!inSection.length && <Typography variant="body2" color="text.secondary">Aucune phrase.</Typography>}
                      </List>
                    </CardContent>
                  </Card>
                );
              })}
              <Card variant="outlined">
                <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                  <Typography variant="sectionHeader">Ordre des confirmations</Typography>
                  <Typography variant="body2" color="text.secondary">Ordre des phrases du J-2 pour ce qui est réservé.</Typography>
                  <List dense>
                    {confirmationItems.map((item, index) => (
                      <ListItem key={item} disableGutters secondaryAction={<OrderButtons index={index} length={confirmationItems.length} onMove={moveConfirmation} label={confirmationLabel(item)} />}>
                        <ListItemText primary={`${index + 1}. ${confirmationLabel(item)}`} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            </>
          )}

          {tab === 'preview' && (
            <Card variant="outlined">
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel id="preview-property">Logement</InputLabel>
                    <Select labelId="preview-property" label="Logement" value={sample.propertyId} onChange={(e) => setSample((s) => ({ ...s, propertyId: e.target.value }))}>
                      {properties.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField size="small" type="number" label="Enfants" value={sample.children} onChange={(e) => setSample((s) => ({ ...s, children: e.target.value }))} />
                  <TextField size="small" type="date" label="Arrivée" value={sample.startDate} onChange={(e) => setSample((s) => ({ ...s, startDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
                  <Button variant="outlined" onClick={runPreview} disabled={!sample.propertyId}>Afficher</Button>
                </Stack>
                {preview && (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                    {['fr', 'en'].map((lang) => (
                      <Box key={lang} sx={{ bgcolor: 'background.default', borderRadius: 1, p: 2, whiteSpace: 'pre-wrap' }}>
                        <Typography variant="overline">{lang === 'fr' ? 'Français' : 'Anglais'} — J-7</Typography>
                        <Typography variant="body2" sx={{ mb: 2 }}>{preview[lang].offers || '—'}</Typography>
                        <Typography variant="overline">J-2</Typography>
                        <Typography variant="body2">{preview[lang].confirmations || '—'}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          )}
        </Stack>
      )}

      <FormDialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing && editing.id ? 'Modifier la phrase' : 'Nouvelle phrase'}
        onSubmit={saveMention}
        maxWidth="md"
      >
        {editing && <MentionEditor value={editing} onChange={setEditing} options={options} error={editError} />}
      </FormDialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={removeMention}
        title="Supprimer la phrase"
        message="Cette phrase ne sera plus proposée ni confirmée dans les mails."
        confirmLabel="Supprimer"
      />
    </Box>
  );
}
