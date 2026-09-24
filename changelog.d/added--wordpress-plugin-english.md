- WordPress plugin 1.12.0: the booking widget serves the language of the page it sits on. It tells
  GuestFlow which language to answer in, and its own 124 interface strings are translated into
  English (`languages/guestflow-booking-en_GB`). Calendar month names follow the language; amounts
  stay in the French convention in both, matching the quote PDF attached to the confirmation. The
  terms open in the page's language, and the visitor's own choice still wins and is still
  remembered.
- WordPress plugin: the response cache is now keyed by language. Without it the first visitor of a
  ten-minute window decided which language every later one read.
