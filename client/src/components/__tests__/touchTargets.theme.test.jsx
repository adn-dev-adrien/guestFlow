// specs/ds-components.md rule 21 — review #8: 370 icon buttons and 107 small buttons under 44 px on
// mobile. On a finger-driven screen (pointer: coarse) the theme lifts every IconButton, Button,
// Checkbox and Radio to 44 px, except the icon buttons inside a text field. jsdom has no pointer
// media: these tests read the rules the theme emits; the e2e spec measures them on a touch screen.
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { Button, Checkbox, IconButton, Radio, ToggleButton, ToggleButtonGroup } from '@mui/material';
import theme from '../../theme';
import CollapsibleSection from '../CollapsibleSection';
import PlatformColorPicker from '../PlatformColorPicker';

const emittedCss = () => [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');

function coarseRuleFor(className) {
  const el = document.querySelector(`.${className}`);
  const own = [...el.classList].find((c) => c.startsWith('css-'));
  const css = emittedCss();
  const at = css.indexOf('@media (pointer: coarse)', css.indexOf(`.${own}`));
  return at === -1 ? '' : css.slice(at, css.indexOf('}}', at) + 2);
}

test('rule 21 — a small icon button, a small button, a checkbox, a radio and a toggle button grow to 44 px on touch', () => {
  render(
    <ThemeProvider theme={theme}>
      <IconButton size="small" aria-label="x">x</IconButton>
      <Button size="small">Reporter</Button>
      <Checkbox size="small" />
      <Radio size="small" />
      <ToggleButtonGroup value="a" size="small"><ToggleButton value="a">Mois</ToggleButton></ToggleButtonGroup>
    </ThemeProvider>,
  );
  expect(coarseRuleFor('MuiIconButton-root')).toMatch(/:not\(:is\(\.MuiInputAdornment-root, ?\.MuiAutocomplete-endAdornment\) \*\)\{min-width:\s*44px;\s*min-height:\s*44px/);
  expect(coarseRuleFor('MuiButton-root')).toMatch(/min-height:\s*44px/);
  expect(coarseRuleFor('MuiCheckbox-root')).toMatch(/min-width:\s*44px;\s*min-height:\s*44px/);
  expect(coarseRuleFor('MuiRadio-root')).toMatch(/min-width:\s*44px;\s*min-height:\s*44px/);
  expect(coarseRuleFor('MuiToggleButton-root')).toMatch(/min-height:\s*44px/);
});

// The first version zeroed the min size inside adornments, which beat QuantityField's own 44 × 44
// steppers (« Diminuer » / « Augmenter ») on touch: the theme must leave them alone, not shrink them.
test('rule 21 — the icon buttons of a text field are left as the field sizes them', () => {
  const rule = theme.components.MuiIconButton.styleOverrides.root['@media (pointer: coarse)'];
  expect(JSON.stringify(rule)).not.toMatch(/"minWidth":0|"minHeight":0/);
  expect(Object.keys(rule)).toEqual(['&:not(:is(.MuiInputAdornment-root, .MuiAutocomplete-endAdornment) *)']);
});

// Second sweep (390 px, touch): the « Voir les N options » toggle (31 px) and the platform colour
// swatch (24 px) were the remaining controls under 44 px that the theme cannot reach.
function coarseBlockOf(el) {
  const own = [...el.classList].filter((c) => c.startsWith('css-')).pop();
  const css = emittedCss();
  const at = css.indexOf('@media (pointer: coarse)', css.indexOf(`.${own}`));
  return at === -1 ? '' : css.slice(at, at + 400);
}

test('rule 21 — the collapsible section toggle is 44 px high on touch', () => {
  const { getByText } = render(
    <ThemeProvider theme={theme}>
      <CollapsibleSection title="Repas" toggleLabel="Voir les 3 options">x</CollapsibleSection>
    </ThemeProvider>,
  );
  expect(coarseBlockOf(getByText('Voir les 3 options').closest('.MuiButtonBase-root'))).toMatch(/min-height:\s*44px/);
});

test('rule 21 — the colour swatch gets a 44 × 44 hit area on touch', () => {
  const { getByRole } = render(
    <ThemeProvider theme={theme}>
      <PlatformColorPicker color="#123456" onChange={() => {}} size={24} />
    </ThemeProvider>,
  );
  expect(coarseBlockOf(getByRole('button', { name: 'Changer la couleur' }))).toMatch(/::after\{content:"";position:absolute;inset:-10px/);
});
