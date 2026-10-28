/**
 * « Catégorie » of the option editor — a free-text field with the labels already in use as one-tap
 * suggestions, so « Boissons » and « Boisson » do not diverge by a typo
 * (specs/option-categories.md §3 rule 6, specs/options-resources-ux.md rule 13). Typing a new label is how
 * a category is created. « Toujours visible » appears once the option belongs to a category (rule 9bis).
 *
 * Props: form, setForm, suggestions (string[] — the category labels of the catalogue)
 */
import React from 'react';
import { Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';

const SHORT = 28;

export default function CategoryField({ form, setForm, suggestions = [] }) {
  const current = String(form.category || '').trim();
  const grouped = Boolean(current);
  return (
    <Box>
      <TextField
        label="Catégorie"
        fullWidth
        value={form.category || ''}
        onChange={(e) => setForm({ ...form, category: e.target.value })}
        helperText="Regroupe l’option dans un menu dépliant (vide : aucun regroupement)."
      />
      {suggestions.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }} role="group" aria-label="Catégories existantes">
          {suggestions.map((label) => (
            <Button
              key={label}
              size="small"
              title={label}
              aria-pressed={current === label}
              onClick={() => setForm({ ...form, category: label })}
              sx={{
                borderRadius: 99, minHeight: 32, textTransform: 'none', fontWeight: 500,
                border: '1px', borderStyle: current === label ? 'solid' : 'dashed', borderColor: current === label ? 'primary.main' : 'divider',
                color: current === label ? 'primary.main' : 'text.primary',
              }}
            >
              {label.length > SHORT ? `${label.slice(0, SHORT - 2)}…` : label}
            </Button>
          ))}
        </Box>
      )}
      {grouped && (
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox checked={Boolean(form.alwaysVisible)} onChange={(e) => setForm({ ...form, alwaysVisible: e.target.checked })} />}
          label={(
            <Box>
              <Typography variant="body2">Toujours visible</Typography>
              <Typography variant="caption" color="text.secondary">
                L’option reste affichée même quand le menu est replié et qu’elle n’est pas sélectionnée.
              </Typography>
            </Box>
          )}
        />
      )}
    </Box>
  );
}
