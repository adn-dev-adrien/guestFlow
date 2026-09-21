/**
 * PropertyDocumentsTab — « Documents » tab of the property page (specs/settings-rationalization.md
 * rule 21). A table of the documents with « Retirer » per row, and one « Ajouter un document »
 * button that reveals Type, Nom and « Parcourir… » with Annuler / Enregistrer. Adding or removing a
 * document is written at once through its own endpoint — never through the property's Save.
 *
 * Props:
 *   propertyId, documents ([{ id, type, name, filePath }]), canManage, onChanged() — reload after a write
 */
import React, { useState } from 'react';
import {
  Box, Button, Card, CardContent, FormControl, FormHelperText, InputLabel, Link, MenuItem, Select,
  Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import UploadIcon from '@mui/icons-material/Upload';
import TableCard from '../TableCard';
import api from '../../api';
import { useToast } from '../DialogProvider';

const DOC_TYPES = [
  { value: 'contract', label: 'Contrat' },
  { value: 'rules', label: 'Règlement' },
  { value: 'other', label: 'Autre' },
];
const typeLabel = (value) => (DOC_TYPES.find((t) => t.value === value) || { label: value || 'Autre' }).label;
const EMPTY_DRAFT = { type: 'contract', name: '', file: null };

export default function PropertyDocumentsTab({ propertyId, documents = [], canManage, onChanged }) {
  const { showSuccess, showError } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const close = () => { setOpen(false); setDraft(EMPTY_DRAFT); setErrors({}); };

  const save = async () => {
    const next = {};
    if (!draft.name.trim()) next.name = 'Donnez un nom au document.';
    if (!draft.file) next.file = 'Choisissez le fichier sur votre ordinateur.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', draft.file);
      fd.append('type', draft.type);
      fd.append('name', draft.name.trim());
      await api.uploadDocument(propertyId, fd);
      close();
      showSuccess('Document ajouté.');
      await onChanged();
    } catch (err) {
      showError((err && err.message) || "Impossible d'ajouter le document.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc) => {
    try {
      await api.deleteDocument(propertyId, doc.id);
      showSuccess('Document retiré.');
      await onChanged();
    } catch (err) {
      showError((err && err.message) || 'Impossible de retirer le document.');
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="sectionHeader" sx={{ display: 'block' }}>Documents</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Un document ajouté ou retiré s&apos;enregistre tout de suite, sans passer par le bouton de la barre.
        </Typography>
        <TableCard minWidth={480}>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Nom</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {documents.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell>{typeLabel(doc.type)}</TableCell>
                <TableCell><Link href={doc.filePath} target="_blank" rel="noopener noreferrer">{doc.name}</Link></TableCell>
                <TableCell align="right">
                  <Button size="small" color="error" variant="outlined" onClick={() => remove(doc)} disabled={!canManage}>Retirer</Button>
                </TableCell>
              </TableRow>
            ))}
            {documents.length === 0 && (
              <TableRow><TableCell colSpan={3} align="center">Aucun document.</TableCell></TableRow>
            )}
          </TableBody>
        </TableCard>

        {open ? (
          <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Nouveau document</Typography>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel id="doc-type-label">Type</InputLabel>
                  <Select labelId="doc-type-label" label="Type" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
                    {DOC_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  label="Nom"
                  value={draft.name}
                  onChange={(e) => { setDraft((d) => ({ ...d, name: e.target.value })); setErrors((x) => ({ ...x, name: undefined })); }}
                  placeholder="ex. Contrat de location 2027"
                  error={Boolean(errors.name)}
                  helperText={errors.name || ''}
                  fullWidth
                />
              </Box>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Button variant="outlined" component="label" startIcon={<UploadIcon />} disabled={busy}>
                    Parcourir…
                    <input
                      type="file"
                      hidden
                      aria-label="Fichier du document"
                      onChange={(e) => { setDraft((d) => ({ ...d, file: e.target.files[0] || null })); setErrors((x) => ({ ...x, file: undefined })); }}
                    />
                  </Button>
                  <Typography variant="body2" color={draft.file ? 'text.primary' : 'text.secondary'}>
                    {draft.file ? draft.file.name : 'Aucun fichier choisi'}
                  </Typography>
                </Box>
                {errors.file && <FormHelperText error>{errors.file}</FormHelperText>}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexDirection: { xs: 'column', sm: 'row' } }}>
                <Button onClick={close} disabled={busy}>Annuler</Button>
                <Button variant="contained" onClick={save} disabled={busy}>Enregistrer</Button>
              </Box>
            </Stack>
          </Box>
        ) : (
          <Button startIcon={<AddIcon />} onClick={() => setOpen(true)} disabled={!canManage} sx={{ mt: 1.5 }}>
            Ajouter un document
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
