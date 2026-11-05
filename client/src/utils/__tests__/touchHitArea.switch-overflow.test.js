// specs/ds-components.md rule 30 (audit R22-C7) — on touch only the height of a switch's input sticks out: its sides
// stay clipped, so it cannot scroll a container sideways nor take taps meant for the row's text.
import theme from '../../theme';
import { COARSE_POINTER } from '../touchHitArea';

test('rule 30: the switch root clips its sides and lets the 44 px height out', () => {
  expect(theme.components.MuiSwitch.styleOverrides.root[COARSE_POINTER]).toEqual({ overflowX: 'clip', overflowY: 'visible' });
  expect(theme.components.MuiSwitch.styleOverrides.input[COARSE_POINTER]).toMatchObject({ height: 44 });
});
