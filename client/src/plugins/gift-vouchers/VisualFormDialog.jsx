/**
 * VisualFormDialog — add a visual to the library, or rename / replace an existing one (specs/gift-voucher-campaigns.md rules 47-48). The server judges the name, the use
 * and the image (format, A6 ratio, size); its refusal is shown on the field it names. Replacing the image adds a version: the vouchers already issued keep theirs.
 *
 * Props: open, onClose, visual? (an existing library entry: rename / replace), defaultUse? ('voucher' | 'merchant' | 'both'), onSaved(visual)
 */
import React, { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField, Typography } from '@mui/material';
import { FormDialog, ImageDropField, useToast } from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import { VISUAL_TEXTS as T } from './giftVoucherTexts';

export default function VisualFormDialog({
  open, onClose, visual = null, defaultUse = 'both', onSaved,
}) {
  const { showSuccess, showError } = useToast();
  const [name, setName] = useState('');
  const [use, setUse] = useState(defaultUse);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(visual ? visual.name : '');
    setUse(visual ? visual.use : defaultUse);
    setFile(null);
    setErrors({});
  }, [open, visual, defaultUse]);

  async function submit() {
    setBusy(true);
    try {
      const saved = visual
        ? await giftVouchersApi.updateVisual(visual.id, { file, name, use })
        : await giftVouchersApi.createVisual({ file, name, use });
      showSuccess(visual ? T.renamed : T.created);
      onSaved(saved);
    } catch (err) {
      const message = (err && err.message) || '';
      if (err && (err.code === 'IMAGE_REFUSED' || err.code === 'UPLOAD_INVALID')) setErrors({ image: message });
      else if (/^Nom/.test(message)) setErrors({ name: message });
      else if (/^Usage|^Utilisé/.test(message)) setErrors({ use: message });
      else showError(message || 'Le visuel n’a pas pu être enregistré.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog open={open} onClose={onClose} title={visual ? T.rename : T.add} submitLabel={T.save} onSubmit={submit} submitBusy={busy}>
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField label={T.name} value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} error={Boolean(errors.name)} helperText={errors.name} required fullWidth slotProps={{ htmlInput: { maxLength: 80 } }} />
        <TextField select label={T.use} value={use} onChange={(e) => { setUse(e.target.value); setErrors((x) => ({ ...x, use: undefined })); }} error={Boolean(errors.use)} helperText={errors.use} fullWidth>
          {T.uses.map((u) => <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>)}
        </TextField>
        <ImageDropField
          value={file} onChange={(next) => { setFile(next); setErrors((x) => ({ ...x, image: undefined })); }} label={visual ? T.replace : T.dropLabel}
          helperText={T.dropHelp} error={errors.image} currentUrl={visual ? giftVouchersApi.visualImageUrl(visual) : null}
        />
        {visual ? <Typography variant="body2" color="text.secondary">{T.replaceNote}</Typography> : null}
      </Stack>
    </FormDialog>
  );
}
