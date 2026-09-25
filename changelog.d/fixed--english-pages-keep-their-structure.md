- Site: the English lodging pages had lost the booking drawer's styling entirely — the floating
  "Book" button with its nightly price stopped floating and fell into the page, and the drawer's
  contents spilled into the content. The seven pictograms under the hero showed their text with no
  icon, the breadcrumb was missing from all five inner pages, and the structured data lost the node
  that describes each lodging as rentable. One cause behind all of it: the page configuration is
  indexed on French addresses, so an English page matched nothing and everything hanging off it
  vanished silently. The English pages now resolve their structure through their French twin — the
  structure only, so the French title and description can never reach an English page.
- Site: the redirect that applies a visitor's chosen language is no longer cacheable either. The one
  that records the choice was fixed first and this one was missed, so a browser could keep serving an
  English reader the French page from its own cache.
