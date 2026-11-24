/**
 * ChoiceDialog — a modal « pick one of N consequences »: an explanation on top, then one radio card per outcome, each with its figure
 * (specs/manual-price-on-placement-change.md §6). Built on `FormDialog`: fullScreen under `sm`, stacked 44 px actions, no transition
 * under `prefers-reduced-motion`. Escape and a click outside call `onCancel`, like the cancel button: the dialog never ends on an
 * outcome nobody chose.
 *
 * Props:
 *   open, title, intro (ReactNode shown above the choices)
 *   choices:      Array<{ value, label, figure?, caption?, disabledReason? }>   a choice with `disabledReason` shows it and cannot be picked
 *   defaultValue: the value preselected each time the dialog opens (falls back to the first enabled choice)
 *   onConfirm:    (value) => void
 *   onCancel:     () => void
 *   confirmLabel ('Appliquer'), cancelLabel ('Annuler'), ariaLabel (radiogroup label, defaults to `title`)
 */
import React, { useEffect, useState } from 'react';
import { Box, Radio, RadioGroup, Typography } from '@mui/material';
import FormDialog from './FormDialog';

const firstEnabled = (choices, wanted) => {
  const enabled = (choices || []).filter((c) => !c.disabledReason);
  return (enabled.find((c) => c.value === wanted) || enabled[0] || {}).value ?? null;
};

export default function ChoiceDialog({
  open, title, intro, choices, defaultValue, onConfirm, onCancel,
  confirmLabel = 'Appliquer', cancelLabel = 'Annuler', ariaLabel,
}) {
  const [selected, setSelected] = useState(() => firstEnabled(choices, defaultValue));
  // Preselected on each opening only: a parent re-rendering new `choices` must not undo the operator's pick.
  useEffect(() => {
    if (open) setSelected(firstEnabled(choices, defaultValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <FormDialog
      open={open}
      onClose={onCancel}
      title={title}
      cancelLabel={cancelLabel}
      submitLabel={confirmLabel}
      submitDisabled={selected == null}
      onSubmit={() => onConfirm(selected)}
    >
      {intro}
      <RadioGroup
        aria-label={ariaLabel || title}
        value={selected ?? ''}
        onChange={(e) => {
          const choice = choices.find((c) => String(c.value) === e.target.value);
          if (choice) setSelected(choice.value);
        }}
        sx={{ display: 'grid', gap: 1, mt: 2 }}
      >
        {choices.map((choice) => {
          const on = choice.value === selected;
          const disabled = Boolean(choice.disabledReason);
          return (
            <Box
              key={choice.value}
              component="label"
              sx={{
                display: 'grid', gridTemplateColumns: 'auto 1fr auto', columnGap: 1, alignItems: 'center',
                minHeight: 44, px: 1, py: 1, borderRadius: '10px', border: '1.5px solid',
                borderColor: on ? 'primary.main' : 'divider',
                bgcolor: on ? 'rgba(47,93,70,0.06)' : 'background.paper',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                transition: 'border-color .15s, background-color .15s',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            >
              <Radio value={String(choice.value)} disabled={disabled} size="small" />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{choice.label}</Typography>
              {choice.figure != null && (
                <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{choice.figure}</Typography>
              )}
              {(choice.disabledReason || choice.caption) && (
                <Typography
                  variant="caption"
                  color={disabled ? 'error.main' : 'text.secondary'}
                  sx={{ gridColumn: '2 / 4', fontVariantNumeric: 'tabular-nums' }}
                >
                  {choice.disabledReason || choice.caption}
                </Typography>
              )}
            </Box>
          );
        })}
      </RadioGroup>
    </FormDialog>
  );
}
