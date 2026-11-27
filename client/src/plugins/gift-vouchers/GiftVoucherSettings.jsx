/**
 * GiftVoucherSettings — Paramètres › Bons cadeaux (specs/gift-vouchers/gift-vouchers.md rule 22, specs/gift-vouchers/gift-voucher-campaigns.md rules 9, 56): the page of the voucher on the site and the
 * base of the two permanent links printed on the cards. Validity, amounts, VAT and ideas are a campaign's now, and the e-mail is built from the voucher: nothing else is
 * declared by the plugin, so nothing else is sent. Saved by the page bar through the plugin's settings route; the server judges every key and its message is shown on the field.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, MenuItem, Stack, TextField,
} from '@mui/material';
import {
  ErrorAlert, HelpedTextField, LoadingState, PageActionBar, useToast,
} from '../sdk';
import FormSection from './FormSection';
import giftVouchersApi from './giftVouchersApi';
import useCatalogue from './useCatalogue';
import { SETTINGS_TEXTS as T } from './giftVoucherTexts';

const DEFAULT_LINK_BASE = 'bon-cadeau';

const draftOf = (values) => ({
  pageUrl: values.pageUrl || '', linkBase: values.linkBase || DEFAULT_LINK_BASE, leftoverDrinkArticleRef: values.leftoverDrinkArticleRef || '',
});

export default function GiftVoucherSettings() {
  const { showSuccess, showError } = useToast();
  const catalogue = useCatalogue();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    giftVouchersApi.getSettings()
      .then((values) => { const next = draftOf(values); setSaved(next); setDraft(next); })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const dirty = Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(saved);
  const setValue = (key) => (value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function save() {
    setBusy(true);
    try {
      const view = await giftVouchersApi.saveSettings({ pageUrl: draft.pageUrl, linkBase: draft.linkBase, leftoverDrinkArticleRef: draft.leftoverDrinkArticleRef });
      const next = draftOf(view);
      setSaved(next);
      setDraft(next);
      setErrors({});
      showSuccess(T.saved);
    } catch (err) {
      const fields = (err && err.errors) || {};
      setErrors(fields);
      if (!Object.keys(fields).length) showError((err && err.message) || 'Les réglages n’ont pas pu être enregistrés.');
    } finally {
      setBusy(false);
    }
  }

  const bar = (
    <PageActionBar title={T.title} onSave={save} saveDisabled={!dirty} saveBusy={busy} onCancel={() => { setDraft(saved); setErrors({}); }} cancelDisabled={!dirty} />
  );

  if (loadError) return <Box>{bar}<Box sx={{ p: 3 }}><ErrorAlert message={T.loadError} onRetry={load} /></Box></Box>;
  if (!draft) return <Box>{bar}<LoadingState /></Box>;

  // The stored option stays in the menu even when the catalogue has not loaded yet or no longer sells it: the select never shows a value it cannot name.
  const sellable = (catalogue.elements || []).filter((e) => e.kind === 'option' && e.sellable);
  const stored = draft.leftoverDrinkArticleRef;
  const known = (catalogue.elements || []).find((e) => e.articleRef === stored);
  const offeredDrinks = stored && !sellable.some((e) => e.articleRef === stored) ? [...sellable, { articleRef: stored, label: known ? known.label : T.drink.unlisted(stored) }] : sellable;

  return (
    <Box>
      {bar}
      <Stack spacing={2.5} sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 960 }}>
        <FormSection title={T.pages.title}>
          <HelpedTextField label={T.pages.pageUrl} helperText={T.pages.pageUrlHelp} error={errors.pageUrl} value={draft.pageUrl} onChange={setValue('pageUrl')} size="small" fullWidth />
          <HelpedTextField label={T.pages.linkBase} helperText={T.pages.linkBaseHelp} error={errors.linkBase} value={draft.linkBase} onChange={setValue('linkBase')} size="small" fullWidth />
        </FormSection>
        <FormSection title={T.drink.title} help={T.drink.help}>
          <TextField
            select label={T.drink.label} value={draft.leftoverDrinkArticleRef} onChange={(e) => setValue('leftoverDrinkArticleRef')(e.target.value)} size="small" fullWidth
            error={Boolean(errors.leftoverDrinkArticleRef)} helperText={errors.leftoverDrinkArticleRef}
          >
            <MenuItem value="">{T.drink.none}</MenuItem>
            {offeredDrinks.map((e) => <MenuItem key={e.articleRef} value={e.articleRef}>{e.label}</MenuItem>)}
          </TextField>
        </FormSection>
      </Stack>
    </Box>
  );
}
