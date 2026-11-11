import '@testing-library/jest-dom';

// Same jsdom focus fix as GuestFlow's client (client/src/setupTests.js): MUI's FocusTrap calls
// `.focus()` on the previous `relatedTarget`, which jsdom sets to the Document.
const relatedTarget = Object.getOwnPropertyDescriptor(FocusEvent.prototype, 'relatedTarget');
Object.defineProperty(FocusEvent.prototype, 'relatedTarget', {
  ...relatedTarget,
  get() {
    const target = relatedTarget.get.call(this);
    return target instanceof Document ? null : target;
  },
});
