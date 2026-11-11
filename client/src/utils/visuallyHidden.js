/**
 * Style object for text read by screen readers only (MUI `sx`). Sizes are explicit pixel strings: in
 * `sx`, a bare `width: 1` means 100% and `margin: -1` means -8px, which widens the document.
 */
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
