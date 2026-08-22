- **The update dialog gets to the point.** It used to render the whole changelog — for 2.2.0, about a
  hundred lines of prose standing between the operator and the « Installer » button, which is prose
  nobody reads and a migration warning nobody sees. Every release now publishes a short digest,
  written in French, and that is all the dialog shows; the full detail stays one click away behind
  « Tout le changelog ». Releases published before this change carry no digest and display exactly as
  they used to, with no toggle. The guard rail sits on the publishing side: a version whose digest is
  missing, still a TODO, or longer than six lines cannot be released at all.
  (specs/self-update-and-releases.md rule 20c, +6 server tests, +6 client tests.)
