/**
 * PropertyStayTexts — « Textes propres à ce logement » (specs/plugins-phase-p-productisation.md rule 3):
 * the property's own wording of « Dans le logement », the parking lines and the wifi sentence. Each
 * is empty by default and shows the global text as its placeholder; an empty override falls back.
 * Saved on its own, text by text: it is not part of the property form.
 *
 * Props: propertyId (number)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import api from '../../api';
import TokenTextField from '../TokenTextField';
import { useToast } from '../DialogProvider';

export default function PropertyStayTexts({ propertyId }) {
  const { showSuccess } = useToast();
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});

  const load = useCallback(() => {
    api.getStayTexts(propertyId).then((data) => { setRows(data.texts || []); setDrafts({}); }).catch(() => setRows([]));
  }, [propertyId]);
  useEffect(() => { load(); }, [load]);

  const valueOf = (row, lang) => (drafts[row.key] && drafts[row.key][lang] !== undefined ? drafts[row.key][lang] : row[lang]);

  async function save(row) {
    try {
      await api.saveStayText(row.key, { fr: valueOf(row, 'fr'), en: valueOf(row, 'en'), propertyId });
      setErrors((prev) => ({ ...prev, [row.key]: null }));
      showSuccess('Texte enregistré.');
      load();
    } catch (err) {
      setErrors((prev) => ({ ...prev, [row.key]: { [err.field || 'fr']: err.message } }));
    }
  }

  if (!rows.length) return null;
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="sectionHeader" sx={{ display: 'block' }}>Textes propres à ce logement</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Vide : le texte commun des mails.
        </Typography>
        <Stack spacing={2.5}>
          {rows.map((row) => (
            <TokenTextField
              key={row.key}
              label={row.label}
              fr={valueOf(row, 'fr')}
              en={valueOf(row, 'en')}
              onChange={(lang, value) => setDrafts((prev) => ({ ...prev, [row.key]: { fr: valueOf(row, 'fr'), en: valueOf(row, 'en'), [lang]: value } }))}
              tokens={row.tokens}
              flags={row.flags}
              placeholderFr={row.globalFr}
              placeholderEn={row.globalEn}
              errorFr={errors[row.key]?.fr}
              errorEn={errors[row.key]?.en}
              helper={drafts[row.key] && (
                <Button size="small" variant="outlined" onClick={() => save(row)}>Enregistrer ce texte</Button>
              )}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
