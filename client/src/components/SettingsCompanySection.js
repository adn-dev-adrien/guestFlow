/**
 * SettingsCompanySection — "Informations sur votre activité" card.
 *
 * Composes LogoUpload + identity fields + bank details.
 *
 * Props:
 *   values:      { name, address, email, phone, siret, tva, iban, bic, bankName, logoPath }
 *   errors:      { companyEmail?, companySiret?, companyTva?, companyIban?, companyBic? }
 *   onChange:    (key, value) => void   — key is one of the `values` field names
 *   onUploadLogo: (file: File) => Promise
 *   onDeleteLogo: () => Promise
 *   disabled:    boolean
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, TextField, Divider, Box } from '@mui/material';
import LogoUpload from './LogoUpload';
import HelpedTextField from './HelpedTextField';

export default function SettingsCompanySection({
  values,
  errors = {},
  onChange,
  onUploadLogo,
  onDeleteLogo,
  disabled = false,
}) {
  const v = values || {};
  const set = (k) => (val) => onChange(k, val);
  const setEvt = (k) => (e) => onChange(k, e.target.value);

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Informations sur votre activité
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Ces informations apparaissent sur vos devis (en-tête et pied de page).
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Logo de votre activité
            </Typography>
            <LogoUpload
              value={v.logoPath || ''}
              onUpload={onUploadLogo}
              onDelete={onDeleteLogo}
              disabled={disabled}
              helperText="Ce logo apparaît sur vos devis et sert de favicon. Max 2 Mo."
            />
          </Box>

          <TextField
            label="Raison sociale"
            value={v.name || ''}
            onChange={setEvt('name')}
            fullWidth
            disabled={disabled}
            helperText="Nom officiel de votre entreprise."
          />

          <TextField
            label="Adresse"
            value={v.address || ''}
            onChange={setEvt('address')}
            fullWidth
            multiline
            minRows={2}
            disabled={disabled}
            helperText="Vous pouvez utiliser des retours à la ligne."
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <HelpedTextField
              label="Email professionnel"
              value={v.email || ''}
              onChange={set('email')}
              error={errors.companyEmail}
              disabled={disabled}
            />
            <TextField
              label="Téléphone"
              value={v.phone || ''}
              onChange={setEvt('phone')}
              fullWidth
              disabled={disabled}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <HelpedTextField
              label="SIRET"
              value={v.siret || ''}
              onChange={set('siret')}
              helperText="14 chiffres. Identifiant unique de votre entreprise."
              error={errors.companySiret}
              disabled={disabled}
            />
            <HelpedTextField
              label="TVA intracommunautaire"
              value={v.tva || ''}
              onChange={set('tva')}
              helperText="Format FRxx + 11 chiffres. Laissez vide si vous n'êtes pas assujetti."
              error={errors.companyTva}
              disabled={disabled}
            />
          </Stack>

          <Divider />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Vos coordonnées bancaires
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Nom de la banque"
              value={v.bankName || ''}
              onChange={setEvt('bankName')}
              fullWidth
              disabled={disabled}
            />
            <HelpedTextField
              label="BIC"
              value={v.bic || ''}
              onChange={set('bic')}
              helperText="8 ou 11 caractères."
              error={errors.companyBic}
              disabled={disabled}
            />
          </Stack>

          <HelpedTextField
            label="IBAN"
            value={v.iban || ''}
            onChange={set('iban')}
            helperText="Ex : FR76 3000 6000 0112 3456 7890 189"
            error={errors.companyIban}
            disabled={disabled}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
