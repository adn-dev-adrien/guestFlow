- **Calendar — scrolling past the preloaded months no longer stalls.** On the dashboard and the
  Calendrier page, scrolling down (or up) sometimes stopped loading months: the calendar sat at its end
  and the whole page scrolled instead, until you scrolled back up a little. It happened whenever a month
  was shorter than the loading margin (an empty month on mobile) or a fast wheel flick jumped over it.
  The next month is now requested again as soon as the previous one is displayed.
