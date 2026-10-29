// specs/ds-components.md rule 29 — switches, clickable chips, inline links and the sidebar rows reach 44 px on touch.
import theme from '../../theme';
import { COARSE_POINTER, touchHitArea } from '../touchHitArea';

test('rule 29: the switch input, the clickable chip, the link and the list row follow the touch target', () => {
  expect(theme.components.MuiSwitch.styleOverrides.input[COARSE_POINTER]).toMatchObject({ height: 44 });
  expect(theme.components.MuiChip.styleOverrides.clickable).toEqual(touchHitArea);
  expect(theme.components.MuiLink.styleOverrides.root).toEqual(touchHitArea);
  expect(theme.components.MuiListItemButton.styleOverrides.root[COARSE_POINTER]).toEqual({ minHeight: 44 });
});
