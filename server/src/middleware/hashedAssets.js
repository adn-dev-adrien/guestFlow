/**
 * Serves the client build's `assets/` folder with a one-year immutable cache (specs/inte-performance.md
 * rule 7). Vite names every file there after its content, so a changed file is a new URL: without this
 * the browser revalidates each of the ~90 chunks of a page on every load (`max-age=0`). `index.html`
 * stays outside it and keeps being revalidated, which is how a release reaches an open browser.
 */
const express = require('express');
const path = require('path');

function hashedAssets(clientBuildDir) {
  return express.static(path.join(clientBuildDir, 'assets'), { maxAge: '1y', immutable: true, index: false });
}

module.exports = hashedAssets;
