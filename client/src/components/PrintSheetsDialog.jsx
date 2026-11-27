/**
 * PrintSheetsDialog — « Imprimer… » for any two-sided A6 document (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 22-27): the mode (« Recto-verso » or « Côte à côte, à
 * plier »), the cards per A4 sheet, how many cards, and — two-sided — the gesture that turns the sheet over. A live preview of the first sheets, numbered so each back matches its front, is
 * drawn from the server's layout: nothing is placed or scaled here, and the PDF is built from the very same layout.
 *
 * Props: open, onClose, title, note? (a line under the fields), fetchLayout(options) → Promise<layout>, onPrint(options) → Promise (the download), initialCount? (default: the cards per
 * sheet, following « Cartes par feuille » until a number is typed; a document that is a single-use code passes 1). `options` is `{ mode, perSheet, count, flip }`. A refusal (`err.field`,
 * `err.message`) is shown under its field. The layout is fetched once per set of options — a parent that re-renders with a new `fetchLayout` function does not fetch again nor clear an
 * error. The sentence under the fields, the captions, the crop marks and the turned backs are the server's layout. Full screen on a phone, the preview under the fields.
 */
import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Box, FormControl, FormControlLabel, FormHelperText, FormLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import FormDialog from './FormDialog';
import {
  PRINT_MODES as MODES, PRINT_PER_SHEET as PER_SHEET, PRINT_FLIPS as FLIPS, PRINT_PREVIEWED_PAGES as PREVIEWED_PAGES, PRINT_TEXTS as T,
} from '../constants/printSheets';

const percent = (part, whole) => `${(part / whole) * 100}%`;

/** One page of the layout: the sheet, its cards numbered, the fold lines and the crop marks — every figure the server's, shown as a share of the sheet. */
function SheetPreview({ page }) {
  const { widthMm, heightMm } = page.sheet;
  return (
    <Box sx={{ width: '100%', maxWidth: widthMm > heightMm ? 260 : 190 }}>
      <Box
        data-testid="sheet-preview"
        aria-label={page.caption || T.sheet(page.number)}
        role="img"
        sx={{ position: 'relative', width: '100%', aspectRatio: `${widthMm} / ${heightMm}`, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 0.5, boxShadow: 1 }}
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
              border: 1,
              borderColor: cell.face === 'front' ? 'primary.main' : 'text.secondary',
              bgcolor: cell.face === 'front' ? 'action.hover' : 'background.paper',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              typography: 'caption',
              fontVariantNumeric: 'tabular-nums',
              color: 'text.secondary',
              transform: cell.rotateDeg ? `rotate(${cell.rotateDeg}deg)` : undefined,
            }}
          >
            {cell.card}
          </Box>
        ))}
        {(page.marks || []).map((mark, index) => (
          <Box
            key={`mark-${index}`}
            data-mark
            sx={{
              position: 'absolute',
              left: percent(Math.min(mark.x1, mark.x2), widthMm),
              top: percent(Math.min(mark.y1, mark.y2), heightMm),
              width: percent(Math.abs(mark.x2 - mark.x1), widthMm),
              height: percent(Math.abs(mark.y2 - mark.y1), heightMm),
              borderLeft: mark.x1 === mark.x2 ? 1 : 0,
              borderTop: mark.y1 === mark.y2 ? 1 : 0,
              borderColor: 'text.primary',
            }}
          />
        ))}
        {page.folds.map((fold, index) => (
          <Box
            key={index}
            sx={{
              position: 'absolute', left: percent(fold.x1, widthMm), top: percent(fold.y1, heightMm), height: percent(fold.y2 - fold.y1, heightMm), borderLeft: 1, borderStyle: 'dashed', borderColor: 'text.primary',
            }}
          />
        ))}
      </Box>
      {page.caption ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{page.caption}</Typography> : null}
    </Box>
  );
}

export default function PrintSheetsDialog({
  open, onClose, title = T.defaultTitle, note = null, fetchLayout, onPrint, initialCount = null,
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

  // The latest `fetchLayout` without being a dependency: a parent that passes a new arrow function at each render must not make the preview fetch again, nor clear an error.
  const fetchRef = useRef(fetchLayout);
  fetchRef.current = fetchLayout;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setErrors({});
    fetchRef.current(options)
      .then((next) => { if (!cancelled) setLayout(next); })
      .catch((err) => {
        if (cancelled) return;
        setLayout(null);
        setErrors({ [(err && err.field) || 'form']: (err && err.message) || T.previewFailed });
      });
    return () => { cancelled = true; };
  }, [open, options]);

  const chooseMode = (next) => {
    setMode(next);
    if (!PER_SHEET[next].includes(perSheet)) {
      const kept = PER_SHEET[next][PER_SHEET[next].length - 1];
      setPerSheet(kept);
      if (!countTouched) setCount(String(kept));
    }
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
      setErrors({ [(err && err.field) || 'form']: (err && err.message) || T.printFailed });
    } finally {
      setBusy(false);
    }
  }

  const previewed = layout ? layout.pages.slice(0, PREVIEWED_PAGES) : [];

  return (
    <FormDialog open={open} onClose={onClose} title={title} submitLabel={T.submit} onSubmit={print} submitBusy={busy} submitDisabled={Boolean(errors.count || errors.perSheet || errors.flip || errors.mode)} maxWidth="md" sheet>
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <FormControl error={Boolean(errors.mode)}>
          <FormLabel id="print-mode">{T.mode}</FormLabel>
          <RadioGroup aria-labelledby="print-mode" value={mode} onChange={(e) => chooseMode(e.target.value)} sx={{ flexDirection: { xs: 'column', sm: 'row' } }}>
            {MODES.map((m) => <FormControlLabel key={m.value} value={m.value} control={<Radio />} label={m.label} sx={{ minHeight: 44 }} />)}
          </RadioGroup>
          {errors.mode ? <FormHelperText>{errors.mode}</FormHelperText> : null}
        </FormControl>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField
            select size="small" label={T.perSheet} value={perSheet} onChange={(e) => choosePerSheet(Number(e.target.value))}
            error={Boolean(errors.perSheet)} helperText={errors.perSheet || T.perSheetHelp}
          >
            {PER_SHEET[mode].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </TextField>
          <TextField
            size="small" label={T.count} value={count} onChange={(e) => { setCount(e.target.value); setCountTouched(true); }}
            error={Boolean(errors.count)} helperText={errors.count || T.countHelp} slotProps={{ htmlInput: { inputMode: 'numeric', style: { fontSize: 16 } } }}
          />
        </Box>
        {mode === 'recto-verso' ? (
          <TextField
            select size="small" label={T.flip} value={flip} onChange={(e) => setFlip(e.target.value)}
            error={Boolean(errors.flip)} helperText={errors.flip || T.flipHelp}
          >
            {FLIPS.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
          </TextField>
        ) : null}
        {note ? <Typography variant="body2" color="text.secondary">{note}</Typography> : null}
        {errors.form ? <Typography variant="body2" color="error" role="alert">{errors.form}</Typography> : null}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{T.preview}</Typography>
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 2 }} aria-live="polite">
            {previewed.map((page) => <SheetPreview key={page.number} page={page} />)}
          </Stack>
          {layout ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {[layout.description, T.pages(layout.pageCount, previewed.length)].filter(Boolean).join(' · ')}
            </Typography>
          ) : null}
        </Box>
      </Stack>
    </FormDialog>
  );
}
