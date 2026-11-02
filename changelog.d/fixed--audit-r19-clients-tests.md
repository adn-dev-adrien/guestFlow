- **Clients — the late-answer guards are now pinned by tests** (audit R19-S1, `specs/clients.md`
  rule 17). Two client tests cover the orders the suite missed: client A's stay list answering after
  client B's sheet has loaded, and A's deletion succeeding after B's confirmation opened. Removing
  either guard now fails the suite. No behaviour change.
