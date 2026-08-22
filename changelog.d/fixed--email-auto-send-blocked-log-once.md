- The daily 08:00 email pass no longer floods the server log while automatic sending is off. Because
  a blocked pass deliberately gives the day's slot back — so that authorising automatic sending at
  14:00 takes effect at 14:01 rather than tomorrow — it was retried, and logged, every minute from
  08:00 to midnight: around 960 identical lines a day, on the setting's default state. The retry
  stays; the line is now printed once a day. (specs/no-automatic-email-without-approval.md rule 9,
  +4 server tests.)
