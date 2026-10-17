/**
 * EmailMentionsPanel — « Options citées » of the email texts page (specs/plugins-phase-p-productisation.md
 * §3.B): the mentions by section, their proposal order, then the confirmation order. Their sentences
 * are also edited in place on the « Par email » tab (specs/guest-email-texts-made-simple.md rule 9).
 * Specific to that page.
 *
 * Props: onChanged() — called after any write, so the page reloads its texts.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Card, CardContent, IconButton, List, ListItem, ListItemText, Stack, Tooltip, Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import api from '../api';
import MentionEditor, { SECTIONS } from './MentionEditor';
import FormDialog from './FormDialog';
import ConfirmDialog from './ConfirmDialog';
import { useToast } from './DialogProvider';

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

export default function EmailMentionsPanel({ onChanged }) {
  const { showSuccess } = useToast();
  const [mentions, setMentions] = useState([]);
  const [confirmationOrder, setConfirmationOrder] = useState([]);
  const [options, setOptions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    const [m, o] = await Promise.all([api.getEmailMentions(), api.getOptions()]);
    setMentions(m.mentions || []);
    setConfirmationOrder(m.confirmationOrder || []);
    setOptions((Array.isArray(o) ? o : o.options || []).map((x) => ({ id: x.id, title: x.title })));
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const optionTitle = (id) => (options.find((o) => o.id === id) || {}).title || `#${id}`;
  const mentionLabel = (m) => (m.optionIds || []).map(optionTitle).join(', ') || 'Sans option';

  async function moveMention(section, index, delta) {
    const inSection = mentions.filter((m) => m.section === section);
    const moved = move(inSection, index, delta);
    const ids = SECTIONS.flatMap((s) => (s.value === section ? moved : mentions.filter((m) => m.section === s.value))).map((m) => m.id);
    const result = await api.reorderEmailMentions(ids);
    setMentions(result.mentions || []);
    onChanged();
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
    onChanged();
  }

  async function saveMention() {
    setEditError(null);
    try {
      if (editing.id) await api.updateEmailMention(editing.id, editing);
      else await api.createEmailMention(editing);
      setEditing(null);
      showSuccess('Phrase enregistrée.');
      await load();
      onChanged();
    } catch (err) {
      setEditError({ field: err.field, message: err.message });
    }
  }

  async function removeMention() {
    await api.deleteEmailMention(deleting.id);
    setDeleting(null);
    await load();
    onChanged();
  }

  return (
    <Stack spacing={3}>
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
    </Stack>
  );
}
