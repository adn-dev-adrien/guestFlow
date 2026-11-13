// specs/guest-app.md rule 51 (2026-11-12) — from 900 px the shell keeps an 84 px column for the navigation rail. The
// bare screens (entry, « Ce code n'est pas reconnu », lookup) have no rail: their shell must stay one column, or the
// whole screen is squeezed into the rail's 84 px (seen on a Mac, Safari and Chromium alike).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const APP = fs.readFileSync(path.resolve(__dirname, '../App.jsx'), 'utf8');

const columnsOf = (selector) => {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let found = null;
  while ((m = re.exec(CSS))) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) {
      const c = m[2].match(/grid-template-columns:\s*([^;]+)/);
      if (c) found = c[1].trim();
    }
  }
  return found;
};

describe('rule 51: the bare shell on a wide screen', () => {
  it('the shell with a rail has the rail column', () => {
    expect(columnsOf('.app.wide .shell')).toBe('84px minmax(0,1fr)');
  });

  it('the bare shell is one column, declared after the rail layout so it wins', () => {
    expect(columnsOf('.app.wide .shell.bare')).toBe('minmax(0,1fr)');
    expect(CSS.indexOf('.app.wide .shell.bare')).toBeGreaterThan(CSS.indexOf('.app.wide .shell{'));
  });

  it('the screens without the app shell render in the bare shell', () => {
    expect(APP).toMatch(/className="shell bare"/);
  });
});
