/**
 * PublicSiteOriginCard — the public website's address, saved on its own
 * (specs/plugins-phase-3a-online-payment.md rule 15). It builds the CGV link of the emails and the
 * return page of an online payment, so it lives with the CGV and outlives any payment plugin.
 *
 * Props:
 *   value:   string                      the stored origin ('' when unset)
 *   onSaved: (overview) => void          the CGV overview the server answers with
 *
 * The server validates and cleans the address; its refusal shows under the field.
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import HelpedTextField from './HelpedTextField';
import { useToast } from './DialogProvider';
import api from '../api';

export default function PublicSiteOriginCard({ value, onSaved }) {
  const { showSuccess } = useToast();
  const [draft, setDraft] = useState(value || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value || ''); }, [value]);

  const dirty = draft.trim() !== (value || '');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      onSaved(await api.saveTermsPublicSiteOrigin(draft));
      showSuccess('Adresse du site enregistrée');
    } catch (e) {
      setError(e.message || 'Adresse invalide.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Typography variant="sectionHeader" component="h2" sx={{ mb: 1 }}>Adresse du site public</Typography>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: { sm: 'flex-start' } }}>
          <HelpedTextField
            label="Adresse du site public"
            size="small"
            value={draft}
            onChange={(v) => { setDraft(v); setError(''); }}
            placeholder="https://www.domainesolio.com"
            helperText="Sert à construire le lien vers vos conditions générales dans les emails, et le retour après un paiement en ligne."
            error={error}
            disabled={saving}
            sx={{ flex: 1, maxWidth: { sm: 520 } }}
          />
          <Button variant="outlined" onClick={save} disabled={!dirty || saving} sx={{ minHeight: 40, width: { xs: '100%', sm: 'auto' } }}>
            Enregistrer l’adresse
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
