// jsdom applies no @media rule, and MUI writes even its `xs` breakpoint as `@media (min-width:0px)`:
// this lists the declarations that reach an element, each with the media query it sits under, so a
// suite can pin a responsive style. Shared by the suites of the 2026-10-19 integration polish.
export function rulesFor(element) {
  const out = [];
  const visit = (rules, media) => {
    [...rules].forEach((rule) => {
      if (rule.cssRules && rule.media) { visit(rule.cssRules, rule.media.mediaText); return; }
      if (!rule.selectorText) return;
      let hit = false;
      try { hit = element.matches(rule.selectorText); } catch { hit = false; }
      if (hit) out.push({ media: media || '', style: rule.style });
    });
  };
  [...document.styleSheets].forEach((sheet) => visit(sheet.cssRules, ''));
  return out;
}

/** The value a property takes under the media query whose text contains `mediaPart`. */
export function valueUnder(element, property, mediaPart) {
  const hit = rulesFor(element).filter((r) => r.media.replace(/\s/g, '').includes(mediaPart.replace(/\s/g, '')))
    .map((r) => r.style.getPropertyValue(property)).filter(Boolean);
  return hit.length ? hit[hit.length - 1] : '';
}
