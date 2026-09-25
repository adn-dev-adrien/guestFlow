- WordPress plugin 1.12.2: on an English page the booking drawer listed its options, its price units
  and its refusals in French. The browser's own calls to the plugin carry no page, so the plugin could
  not tell which language the visitor was reading and asked GuestFlow in French — then cached that
  answer. Every call now states the language, and the plugin applies it in one place, before any
  handler.
- Site: the drawer's own retouches of a few price lines were written in French and fired on English
  pages too, because what triggers them is the option's title — which stays French until an English
  one is filled in. They now come from the site dictionary: « per person · sliding scale » instead of
  « per participant · tarif dégressif ».
