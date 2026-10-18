// specs/plugins-phase-p-productisation.md rule 39 — on a touch screen an inline link-button (a client's
// name, « Fiche ») gets a 44 px hit area without moving the layout, and toggle buttons are in sentence
// case and 44 px on both sides.
import theme from '../../theme';
import { COARSE_POINTER, TOUCH_TARGET, touchHitArea } from '../touchHitArea';

test('rule 39: the hit area is at least 44 × 44, centred, only under a finger', () => {
  const area = touchHitArea[COARSE_POINTER];
  expect(TOUCH_TARGET).toBe(44);
  expect(area.position).toBe('relative');
  expect(area['&::after']).toMatchObject({ position: 'absolute', width: 'max(100%, 44px)', height: 'max(100%, 44px)', transform: 'translate(-50%, -50%)' });
});

test('rule 39: every link-button and toggle of the theme follows it', () => {
  expect(theme.components.MuiLink.styleOverrides.root['&.MuiLink-button']).toEqual(touchHitArea);
  const toggle = theme.components.MuiToggleButton.styleOverrides.root;
  expect(toggle.textTransform).toBe('none');
  expect(toggle[COARSE_POINTER]).toEqual({ minHeight: 44, minWidth: 44 });
});
