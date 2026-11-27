/**
 * PrintSheetsDialog — « Imprimer… » for any two-sided A6 document (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 22-27): the mode (« Recto-verso » or « Côte à côte, à
 * plier »), the cards per A4 sheet, how many cards, and — two-sided — the gesture that turns the sheet over. A live preview of the first sheets, numbered so each back matches its front, is
 * drawn from the server's layout: nothing is placed or scaled here, and the PDF is built from the very same layout.
 *
 * Props: open, onClose, title, note? (a line under the fields), fetchLayout(options) → Promise<layout>, onPrint(options) → Promise (the download), initialCount? (default: the cards per sheet).
 * `options` is `{ mode, perSheet, count, flip }`. A refusal (`err.field`, `err.message`) is shown under its field. Full screen on a phone, the preview under the fields.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, FormControl, FormControlLabel, FormHelperText, FormLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import FormDialog from './FormDialog';

const MODES = [{ value: 'recto-verso', label: 'Recto-verso' }, { value: 'side-by-side', label: 'Côte à côte, à plier' }];
const PER_SHEET = { 'recto-verso': [1, 2, 4, 8], 'side-by-side': [1, 2, 4] };
const FLIPS = [{ value: 'left-right', label: 'De gauche à droite' }, { value: 'top-bottom', label: 'De haut en bas' }];
const PREVIEWED_PAGES = 4;

const percent = (part, whole) => `${(part / whole) * 100}%`;

/** One page of the layout: the sheet, its cards numbered, the fold lines — every figure the server's, shown as a share of the sheet. */
function SheetPreview({ page }) {
  const { widthMm, heightMm } = page.sheet;
  return (
    <Box
      data-testid="sheet-preview"
      aria-label={`Feuille ${page.number}`}
      role="img"
      sx={{ position: 'relative', width: '100%', maxWidth: widthMm > heightMm ? 260 : 190, aspectRatio: `${widthMm} / ${heightMm}`, bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, boxShadow: 1 }}
    >
      {page.cells.map((cell) => (
        <Box
          key={`${cell.card}-${cell.face}`}
          data-face={cell.face}
          sx={{
            position: 'absolute',
            left: percent(cell.xMm, widthMm),
            top: percent(cell.yMm, heightMm),
            width: percent(cell.widthMm, widthMm),
            height: percent(cell.heightMm, heightMm),
            border: '1px solid',
            borderColor: cell.face === 'front' ? 'primary.main' : 'text.secondary',
            bgcolor: cell.face === 'front' ? 'action.hover' : 'background.paper',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontVariantNumeric: 'tabular-nums',
            color: 'text.secondary',
          }}
        >
          {cell.card}
        </Box>
      ))}
      {page.folds.map((fold, index) => (
        <Box
          key={index}
          sx={{
            position: 'absolute', left: percent(fold.x1, widthMm), top: percent(fold.y1, heightMm), height: percent(fold.y2 - fold.y1, heightMm), borderLeft: '1px dashed', borderColor: 'text.primary',
          }}
        />
      ))}
    </Box>
  );
}

export default function PrintSheetsDialog({
  open, onClose, title = 'Imprimer', note = null, fetchLayout, onPrint, initialCount = null,
}) {
  const [mode, setMode] = useState('recto-verso');
  const [perSheet, setPerSheet] = useState(4);
  const [count, setCount] = useState(initialCount ? String(initialCount) : '4');
  const [countTouched, setCountTouched] = useState(Boolean(initialCount));
  const [flip, setFlip] = useState('left-right');
  const [layout, setLayout] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => ({
    mode, perSheet, count: count.trim() === '' ? '' : Number(count), flip: mode === 'recto-verso' ? flip : undefined,
  }), [mode, perSheet, count, flip]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setErrors({});
    fetchLayout(options)
      .then((next) => { if (!cancelled) setLayout(next); })
      .catch((err) => {
        if (cancelled) return;
        setLayout(null);
        setErrors({ [(err && err.field) || 'form']: (err && err.message) || 'L’aperçu n’a pas pu être calculé.' });
      });
    return () => { cancelled = true; };
  }, [open, options, fetchLayout]);

  const chooseMode = (next) => {
    setMode(next);
    if (!PER_SHEET[next].includes(perSheet)) setPerSheet(PER_SHEET[next][PER_SHEET[next].length - 1]);
  };
  const choosePerSheet = (next) => {
    setPerSheet(next);
    if (!countTouched) setCount(String(next));
  };

  async function print() {
    setBusy(true);
    try {
      await onPrint(options);
      onClose();
    } catch (err) {
      setErrors({ [(err && err.field) || 'form']: (err && err.message) || 'Le PDF n’a pas pu être préparé.' });
    } finally {
      setBusy(false);
    }
  }

  const previewed = layout ? layout.pages.slice(0, PREVIEWED_PAGES) : [];

  return (
    <FormDialog open={open} onClose={onClose} title={title} submitLabel="Télécharger le PDF" onSubmit={print} submitBusy={busy} submitDisabled={Boolean(errors.count || errors.perSheet || errors.flip || errors.mode)} maxWidth="md" sheet>
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <FormControl error={Boolean(errors.mode)}>
          <FormLabel id="print-mode">Mode</FormLabel>
          <RadioGroup aria-labelledby="print-mode" value={mode} onChange={(e) => chooseMode(e.target.value)} sx={{ flexDirection: { xs: 'column', sm: 'row' } }}>
            {MODES.map((m) => <FormControlLabel key={m.value} value={m.value} control={<Radio />} label={m.label} sx={{ minHeight: 44 }} />)}
          </RadioGroup>
          {errors.mode ? <FormHelperText>{errors.mode}</FormHelperText> : null}
        </FormControl>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField
            select size="small" label="Cartes par feuille" value={perSheet} onChange={(e) => choosePerSheet(Number(e.target.value))}
            error={Boolean(errors.perSheet)} helperText={errors.perSheet || 'Feuille A4.'}
          >
            {PER_SHEET[mode].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </TextField>
          <TextField
            size="small" label="Nombre de cartes" value={count} onChange={(e) => { setCount(e.target.value); setCountTouched(true); }}
            error={Boolean(errors.count)} helperText={errors.count || 'De 1 à 200.'} slotProps={{ htmlInput: { inputMode: 'numeric', style: { fontSize: 16 } } }}
          />
        </Box>
        {mode === 'recto-verso' ? (
          <TextField
            select size="small" label="Retournement de la feuille" value={flip} onChange={(e) => setFlip(e.target.value)}
            error={Boolean(errors.flip)} helperText={errors.flip || 'Le geste qui retourne la feuille pour imprimer le verso.'}
          >
            {FLIPS.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
          </TextField>
        ) : null}
        {note ? <Typography variant="body2" color="text.secondary">{note}</Typography> : null}
        {errors.form ? <Typography variant="body2" color="error" role="alert">{errors.form}</Typography> : null}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Aperçu</Typography>
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 2 }} aria-live="polite">
            {previewed.map((page) => <SheetPreview key={page.number} page={page} />)}
          </Stack>
          {layout ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {`${layout.pageCount} page${layout.pageCount > 1 ? 's' : ''}${layout.pageCount > previewed.length ? `, les ${previewed.length} premières montrées` : ''}.`}
            </Typography>
          ) : null}
        </Box>
      </Stack>
    </FormDialog>
  );
}
