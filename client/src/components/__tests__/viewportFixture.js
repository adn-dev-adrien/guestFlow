// A viewport width for useMediaQuery under jsdom, which has no matchMedia: answers the min-width /
// max-width queries MUI builds from its breakpoints. Shared by the suites of
// specs/ui-review-2026-10-19-operations.md; call `resetViewport()` in afterEach.
export function setViewport(width) {
  window.matchMedia = (query) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    };
  };
}

export function resetViewport() {
  delete window.matchMedia;
}
