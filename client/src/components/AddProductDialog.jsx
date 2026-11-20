/**
 * AddProductDialog — « Ajouter un produit » on a stay that exists (specs/pricing-components.md §3 rules 27, 30).
 *
 * Props: `open`, `onClose`, `reservationId`, `articles` (`[{ articleRef, label }]`, the catalogue the page already holds), `onSold(saleDetail)`.
 * The dialog asks the server for the price (`POST …/extras/quote`), shows the total and the moment the server gives, and sells at the
 * price the operator saw (`acceptedTotalCents`); a price that moved is refused by the server and the dialog asks to read it again.
 * No amount is computed here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, MenuItem, Stack, TextField, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import FocusKeeper from './FocusKeeper';
import api from '../api';
import useLatestPreview from '../hooks/useLatestPreview';
import useMoneyCommit, { PreviewFailure } from '../hooks/useMoneyCommit';
import { formatCurrency } from '../utils/formatters';

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);

export default function AddProductDialog({ open, onClose, reservationId, articles = [], onSold }) {
  const [articleRef, setArticleRef] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setArticleRef(''); setQuantity('1'); setError(''); }
  }, [open]);

  const requests = articleRef ? [{ articleRef, quantity: Number(quantity) }] : [];
  const valid = requests.length > 0 && Number(quantity) > 0;
  // The money-dialog contract (specs/plugins-phase-1-sdk.md rule 58, loop t26): the price through the shared preview hook (latest request
  // only, a failure with its way out), « Ajouter » only on the answer for the product and quantity on screen.
  const fetcher = useCallback((body, options) => api.quoteExtraSale(reservationId, body, options), [reservationId]);
  const preview = useLatestPreview({
    fetcher, draft: { requests, payment: 'later' }, enabled: open && valid, scope: reservationId, resetKey: open ? 'open' : 'closed',
  });
  const quote = valid ? preview.data : null;
  const commit = useMoneyCommit({ previews: [preview], questions: [valid, !busy, Boolean(quote)] });

  const submit = async () => {
    if (!commit.ready) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.sellExtra(reservationId, { requests, payment: 'later', acceptedTotalCents: quote.totalCents });
      onSold(result.saleDetail);
      onClose();
    } catch (err) {
      setError((err && err.message) || 'Vente refusée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} onClose={onClose} title="Ajouter un produit" submitLabel="Ajouter" onSubmit={submit} submitDisabled={!commit.ready} submitBusy={busy}>
      {/* Rule 58 (I4) — « Réessayer » goes with its failure: the focus stays in the content. */}
      <FocusKeeper component={Stack} spacing={2} sx={{ pt: 1 }}>
        <TextField select label="Produit" value={articleRef} onChange={(e) => setArticleRef(e.target.value)} fullWidth size="small">
          {articles.map((article) => <MenuItem key={article.articleRef} value={article.articleRef} sx={{ minHeight: 44 }}>{article.label}</MenuItem>)}
        </TextField>
        <TextField
          label="Quantité"
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          error={quantity !== '' && !(Number(quantity) > 0)}
          helperText={quantity !== '' && !(Number(quantity) > 0) ? 'Une quantité supérieure à 0.' : ' '}
          size="small"
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
        />
        {quote && (
          <Stack spacing={0.5} aria-live="polite" sx={{ opacity: preview.pending ? 0.6 : 1, transition: 'opacity 120ms' }}>
            <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>{euros(quote.totalCents)}</Typography>
            <Typography variant="body2" color="text.secondary">{quote.lines[0] && quote.lines[0].momentLabel}</Typography>
            {quote.lines[0] && !quote.lines[0].merged && <Typography variant="caption" color="text.secondary">Nouvelle ligne</Typography>}
            {quote.lines[0] && quote.lines[0].note && <Typography variant="caption" color="text.secondary">{quote.lines[0].note}</Typography>}
          </Stack>
        )}
        <PreviewFailure error={preview.error} onRetry={preview.retry} fallback="Prix indisponible." />
        {error && <Alert severity="error">{error}</Alert>}
      </FocusKeeper>
    </FormDialog>
  );
}
