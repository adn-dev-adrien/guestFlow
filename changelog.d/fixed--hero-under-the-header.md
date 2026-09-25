- Site: on the home page the hero image sat below the header instead of sliding under it, and was
  cropped by the height of the bar. It survived on the other pages only by accident — the breadcrumb
  precedes the hero there, so a WordPress layout rule that zeroes the first block's top margin did
  not apply. The banner is now transparent over the hero everywhere.
- Site: the language switcher's link carries a new parameter. A visitor whose browser cached the
  permanent redirect the switcher briefly answered could no longer switch language at all — the click
  never reached the site, so nothing was remembered. No header can purge a cached redirect; only an
  address the browser has never seen can. Links already shared with the old parameter keep working.
