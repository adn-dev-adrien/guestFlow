/**
 * The renewal emails (specs/control-plane-plans-and-access.md rule 33): one card per template with
 * its day and its Manuel / Automatique switch (none on « Relancer maintenant », whose click is the
 * approval), and « Modifier »: subject, text, the placeholders as chips that insert at the cursor,
 * and the server's rendering on a sample customer as the text is typed.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, FormControlLabel, Stack, Switch, TextField, Typography,
} from '@mui/material';
import PageActionBar from '@gf/components/PageActionBar';
import FormDialog from '@gf/components/FormDialog';
import LoadingState from '@gf/components/LoadingState';
import ErrorAlert from '@gf/components/ErrorAlert';
import { useToast } from '@gf/components/DialogProvider';
import MailPreview from '../components/MailPreview';
import api from '../api';

export default function EmailTemplatesPage() {
  const { showError, showSuccess } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const bodyRef = useRef(null);

  const load = () => {
    setError(null);
    api.templates().then(setData).catch((err) => setError(err.message));
  };
  useEffect(load, []);

  useEffect(() => {
    if (!editing) return undefined;
    const t = setTimeout(() => {
      api.previewTemplate(editing.key, { subject: editing.subject, body: editing.body }).then(setPreview).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [editing]);

  const replace = (template) => setData((d) => ({ ...d, templates: d.templates.map((t) => (t.key === template.key ? template : t)) }));

  async function setMode(t, auto) {
    try {
      const res = await api.saveTemplate(t.key, { sendMode: auto ? 'auto' : 'manual' });
      replace(res.template);
      showSuccess(res.notice);
    } catch (err) {
      showError(err.message);
    }
  }

  async function save() {
    try {
      const res = await api.saveTemplate(editing.key, { subject: editing.subject, body: editing.body });
      replace(res.template);
      setEditing(null);
      showSuccess(res.notice);
    } catch (err) {
      showError(err.message);
    }
  }

  function insert(name) {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    const start = el ? el.selectionStart : editing.body.length;
    const end = el ? el.selectionEnd : editing.body.length;
    setEditing((e) => ({ ...e, body: e.body.slice(0, start) + token + e.body.slice(end) }));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = start + token.length;
      el.selectionEnd = start + token.length;
    });
  }

  const bar = <PageActionBar title="Emails" titleOnXs />;
  if (error) return <>{bar}<Box sx={{ p: 2 }}><ErrorAlert message={error} onRetry={load} /></Box></>;
  if (!data) return <>{bar}<LoadingState /></>;

  return (
    <>
      {bar}
      <Box sx={{ p: { xs: 1.5, sm: 3 }, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
        {data.templates.map((t) => (
          <Card key={t.key}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="sectionHeader" component="h2">{t.name}</Typography>
                <Typography variant="body2" color="text.secondary">{t.day}</Typography>
                {t.sendMode === null ? (
                  <Chip label={t.modeLabel} size="small" sx={{ alignSelf: 'flex-start' }} />
                ) : (
                  <FormControlLabel sx={{ minHeight: 44 }} label={t.modeLabel}
                    control={<Switch checked={t.sendMode === 'auto'} onChange={(e) => setMode(t, e.target.checked)} slotProps={{ input: { 'aria-label': `Envoi automatique : ${t.name}` } }} />} />
                )}
                <Button variant="outlined" sx={{ minHeight: 44 }} onClick={() => { setPreview(null); setEditing({ key: t.key, name: t.name, subject: t.subject, body: t.body }); }}>Modifier</Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Box>

      <FormDialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `Modifier « ${editing.name} »` : ''} onSubmit={save}>
        {editing && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Objet" value={editing.subject} onChange={(e) => setEditing((x) => ({ ...x, subject: e.target.value }))} fullWidth />
            <TextField label="Texte" value={editing.body} onChange={(e) => setEditing((x) => ({ ...x, body: e.target.value }))} fullWidth multiline minRows={8}
              inputRef={bodyRef} error={Boolean(preview && preview.error)} helperText={preview && preview.error} />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }} aria-label="Variables">
              {data.placeholders.map((p) => <Chip key={p} label={`{{${p}}}`} size="small" variant="outlined" onClick={() => insert(p)} sx={{ fontFamily: 'monospace' }} />)}
            </Box>
            {preview && (
              <Box>
                <Typography variant="caption" color="text.secondary">Aperçu (client d’exemple)</Typography>
                <MailPreview subject={preview.subject} body={preview.body} />
              </Box>
            )}
          </Stack>
        )}
      </FormDialog>
    </>
  );
}
