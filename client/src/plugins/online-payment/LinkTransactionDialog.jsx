/**
 * LinkTransactionDialog — « Rattacher des virements » (specs/reconciliation-assisted-matching.md rules
 * 1–8, 14). One dialog, both directions:
 *   - from a fiche: `reservationId` → the account's credits, plausible ones first, the rest folded;
 *   - from a credit (the page): `credit` fixed → the open receipts, plausible ones first, the rest folded.
 * The server lists, searches, allocates and refuses; this only draws the answers and sends ids. Nothing is
 * summed here: the footer is the server's preview (`/allocation-preview`), « Rattacher » stays disabled
 * until that preview is valid.
 *
 * Props: open, onClose, busy, onSubmit(pairs[{ transactionId, reservationId, ledgerKey, amountCents }]),
 *        reservationId? (fiche mode), credit? ({ transactionId, remainingCents, dateLabel, counterparty }, credit mode)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Checkbox, Chip, Stack, TextField, Typography,
} from '@mui/material';
import {
  api, FormDialog, PlatformChip, LoadingState, useLatestPreview,
} from '../sdk';
import { money, parseEuroInput, centsToInput } from './reconciliationShared';

const MAX_TICKED = 10;
const REASON_LABELS = { exact: 'montant exact', amount: '±5 €', name: 'nom' };
const INVALID_AMOUNT = 'Montant invalide : chiffres et virgule, deux décimales au plus.';

function Row({ checked, disabled, onToggle, children }) {
  return (
    <Box
      component="label"
      sx={{
        display: 'flex', gap: 0.5, alignItems: 'flex-start', minHeight: 44, py: 0.75, cursor: disabled ? 'default' : 'pointer',
        borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 },
      }}
    >
      <Checkbox checked={checked} disabled={disabled} onChange={onToggle} sx={{ mt: -0.25 }} />
      <Box sx={{ minWidth: 0, flex: 1, pt: 0.5 }}>{children}</Box>
    </Box>
  );
}

function CreditRow({ credit, checked, disabled, onToggle }) {
  return (
    <Row checked={checked} disabled={disabled} onToggle={onToggle}>
      <Stack direction="row" gap={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontVariantNumeric: 'tabular-nums' }}>{money(credit.remainingCents)}</b>
        <Typography component="span" variant="body2" color="text.secondary">{credit.dateLabel}</Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
        {credit.counterparty}{credit.reference ? ` · « ${credit.reference} »` : ''}
      </Typography>
      <Stack direction="row" gap={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
        {(credit.reasons || []).map((r) => <Chip key={r} size="small" label={REASON_LABELS[r]} color={r === 'exact' ? 'success' : 'default'} variant="outlined" />)}
        {credit.partlyUsedLabel && <Chip size="small" label={credit.partlyUsedLabel} variant="outlined" />}
        {credit.proposedElsewhere && <Chip size="small" label="proposé ailleurs" />}
      </Stack>
    </Row>
  );
}

function ReceiptRow({ receipt, checked, disabled, onToggle }) {
  return (
    <Row checked={checked} disabled={disabled} onToggle={onToggle}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {receipt.reservation.clientName || 'Client'} · {receipt.label}
        <PlatformChip platform={receipt.reservation.platform} sx={{ ml: 1 }} />
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(receipt.openCents)}</span>
        {receipt.anchorDateLabel ? ` · ${receipt.anchorDateLabel}` : ''}{receipt.reservation.propertyName ? ` · ${receipt.reservation.propertyName}` : ''}
      </Typography>
    </Row>
  );
}

export default function LinkTransactionDialog({ open, onClose, busy = false, onSubmit, reservationId = null, credit = null }) {
  const creditMode = Boolean(credit);
  const runKey = open ? `${creditMode ? credit.transactionId : reservationId}` : 'closed';
  const [q, setQ] = useState('');
  const [ticked, setTicked] = useState([]);
  const [more, setMore] = useState([]);
  const [moreBusy, setMoreBusy] = useState(false);
  const [manual, setManual] = useState(null);

  useEffect(() => {
    if (!open) return;
    setQ(''); setTicked([]); setMore([]); setManual(null);
  }, [open, reservationId, credit]);

  const list = useLatestPreview({
    fetcher: ({ query }) => (creditMode
      ? api.getReconciliationCandidates({ transactionId: credit.transactionId, q: query })
      : api.getReconciliationFicheCredits(reservationId, { q: query })),
    draft: { query: q },
    enabled: open,
    scope: creditMode ? credit.transactionId : reservationId,
    resetKey: runKey,
    delay: 250,
  });
  const base = list.data;
  useEffect(() => { setMore([]); }, [base]);

  const keyOf = (item) => (creditMode ? item.key : item.transactionId);
  const tickedIds = ticked;
  const toggle = (id) => {
    setManual(null);
    setTicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : (cur.length < MAX_TICKED ? [...cur, id] : cur)));
  };

  const manualPairs = useMemo(() => {
    if (!manual) return null;
    return manual.map((m) => ({ transactionId: m.transactionId, reservationId: m.reservationId, ledgerKey: m.ledgerKey, amountCents: parseEuroInput(m.text) }));
  }, [manual]);
  const manualInvalid = manualPairs ? manualPairs.some((p) => p.amountCents == null) : false;

  const preview = useLatestPreview({
    fetcher: (d) => api.previewReconciliationAllocation(d.pairs ? { pairs: d.pairs }
      : (creditMode ? { transactionIds: [credit.transactionId], receiptKeys: d.ids } : { reservationId, transactionIds: d.ids })),
    draft: manualPairs && !manualInvalid ? { pairs: manualPairs } : { ids: tickedIds },
    enabled: open && !manualInvalid && (manualPairs ? manualPairs.length > 0 : tickedIds.length > 0),
    scope: creditMode ? credit.transactionId : reservationId,
    resetKey: runKey,
    delay: 150,
  });
  const answer = preview.fresh && !preview.error ? preview.data : null;
  const shown = preview.data;

  const showMore = async () => {
    setMoreBusy(true);
    try {
      const offset = base.others.items.length + more.length;
      const page = creditMode
        ? await api.getReconciliationCandidates({ transactionId: credit.transactionId, q, offset })
        : await api.getReconciliationFicheCredits(reservationId, { q, offset });
      setMore((cur) => [...cur, ...page.others.items]);
    } finally { setMoreBusy(false); }
  };

  const startManual = () => {
    if (!shown || !shown.pairs) return;
    setManual(shown.pairs.map((p) => ({ ...p, text: centsToInput(p.amountCents) })));
  };

  const submit = () => {
    if (!answer || !answer.valid) return;
    onSubmit(answer.pairs);
  };

  const others = base ? [...base.others.items, ...more] : [];
  const noLikely = base && base.likely.length === 0;
  const searching = Boolean(q.trim());
  const empty = base && base.likely.length === 0 && base.others.total === 0;
  const renderItem = (item) => (creditMode
    ? <ReceiptRow key={keyOf(item)} receipt={item} checked={tickedIds.includes(keyOf(item))} disabled={!tickedIds.includes(keyOf(item)) && tickedIds.length >= MAX_TICKED} onToggle={() => toggle(keyOf(item))} />
    : <CreditRow key={keyOf(item)} credit={item} checked={tickedIds.includes(keyOf(item))} disabled={!tickedIds.includes(keyOf(item)) && tickedIds.length >= MAX_TICKED} onToggle={() => toggle(keyOf(item))} />);
  const nameOfPair = (p) => {
    const r = shown && shown.receipts.find((x) => x.key === `${p.reservationId}|${p.ledgerKey}`);
    return `${r ? r.label : p.ledgerKey}`;
  };
  const errorFor = (index) => (answer || shown ? ((shown && shown.errors) || []).find((e) => e.field === `pairs.${index}`) : null);

  return (
    <FormDialog
      open={open} onClose={onClose} maxWidth="sm" title="Rattacher des virements" submitLabel="Rattacher"
      onSubmit={submit} submitDisabled={!answer || !answer.valid || manualInvalid} submitBusy={busy}
    >
      {creditMode && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          <b>{money(credit.remainingCents)}</b> · {credit.dateLabel} · {credit.counterparty}
        </Typography>
      )}
      <TextField
        fullWidth size="small" sx={{ mt: 1.5, mb: 1 }} value={q} onChange={(e) => setQ(e.target.value)} type="search"
        label={creditMode ? 'Client, logement, date (12/03) ou montant' : 'Nom, date (12/03) ou montant (596,58)'}
        slotProps={{ htmlInput: { autoComplete: 'off', style: { fontSize: 16 } } }}
      />
      {!base && <LoadingState />}
      {base && !creditMode && base.receipts.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          {base.receipts.map((r) => `${r.label} · ${money(r.openCents)}${r.anchorDateLabel ? ` · ${r.anchorDateLabel}` : ''}`).join('  |  ')}
        </Typography>
      )}
      {empty && searching && (
        <Box sx={{ py: 2 }}>
          <Typography variant="body2">Aucun résultat pour « {q.trim()} ».</Typography>
          <Button size="small" onClick={() => setQ('')} sx={{ textTransform: 'none', minHeight: 44 }}>Effacer la recherche</Button>
        </Box>
      )}
      {empty && !searching && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {creditMode ? 'Aucune échéance à rattacher.' : 'Aucun virement disponible : tous les crédits lus sont déjà rattachés.'}
        </Typography>
      )}
      {base && !empty && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 1 }}>{creditMode ? 'Échéances probables' : 'Correspondances probables'}</Typography>
          {noLikely
            ? <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{creditMode ? 'Aucune échéance proche du montant du virement.' : 'Aucun virement proche du montant attendu.'}</Typography>
            : <Box>{base.likely.map(renderItem)}</Box>}
          {base.others.total > 0 && (
            <Box component="details" open={noLikely || searching} sx={{ mt: 1 }}>
              <Box component="summary" sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 600, minHeight: 44, display: 'flex', alignItems: 'center' }}>
                {creditMode ? `Toutes les échéances ouvertes (${base.others.total})` : `Tous les virements disponibles (${base.others.total})`}
              </Box>
              <Box>{others.map(renderItem)}</Box>
              {others.length < base.others.total && (
                <Button fullWidth variant="text" disabled={moreBusy} onClick={showMore} sx={{ textTransform: 'none', minHeight: 44 }}>Afficher plus</Button>
              )}
            </Box>
          )}
        </>
      )}

      {tickedIds.length > 0 && (
        <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', mt: 1.5, py: 1.25 }} aria-live="polite">
          {shown ? (
            <>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{shown.summaryLabel}</Typography>
              {shown.receipts.map((r) => (
                <Typography key={r.key} variant="caption" component="div" color="text.secondary">
                  {r.label} · {r.statusLabel}
                </Typography>
              ))}
              {shown.leftover.map((l) => <Typography key={l.transactionId} variant="caption" component="div" color="warning.main">{l.message}</Typography>)}
              {shown.errors.filter((e) => !String(e.field || '').startsWith('pairs.') || !manual).map((e) => (
                <Typography key={`${e.code}-${e.field}`} variant="caption" component="div" color="error.main" role="alert">{e.message}</Typography>
              ))}
              {!manual && shown.pairs.length > 0 && (
                <Button size="small" onClick={startManual} sx={{ textTransform: 'none', minHeight: 44 }}>Modifier la répartition</Button>
              )}
            </>
          ) : <Typography variant="caption" color="text.secondary">Calcul de la répartition…</Typography>}
          {manual && (
            <Stack gap={1} sx={{ mt: 1 }}>
              {manual.map((m, i) => {
                const refusal = errorFor(i);
                const local = parseEuroInput(m.text) == null ? INVALID_AMOUNT : '';
                return (
                  <TextField
                    key={`${m.transactionId}|${m.reservationId}|${m.ledgerKey}`} size="small" fullWidth
                    label={`${nameOfPair(m)} (€)`} value={m.text}
                    onChange={(e) => setManual((cur) => cur.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    error={Boolean(local || refusal)} helperText={local || (refusal && refusal.message) || ' '}
                    slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off', style: { fontSize: 16 } } }}
                  />
                );
              })}
            </Stack>
          )}
        </Box>
      )}
    </FormDialog>
  );
}
