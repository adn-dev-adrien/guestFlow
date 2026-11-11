// specs/ds-components.md rule 21, specs/plugins-phase-p-productisation.md rule 39 — a control that
// must stay small on screen (an inline link, a text « Détail », a compact chip) gets an invisible
// hit area of at least 44 × 44 on a finger-driven screen, centred on it, without moving the layout.
export const COARSE_POINTER = '@media (pointer: coarse)';
export const TOUCH_TARGET = 44;

export const touchHitArea = Object.freeze({
  [COARSE_POINTER]: {
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: `max(100%, ${TOUCH_TARGET}px)`,
      height: `max(100%, ${TOUCH_TARGET}px)`,
      transform: 'translate(-50%, -50%)',
    },
  },
});
