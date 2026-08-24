- **Money sold on a settled arrival complement no longer disappears**
  (specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 3bis). On a reservation whose arrival
  complement was already collected, adding a 30 € option raised the « total du séjour » by 30 € while
  the échéances stayed put: the engine freezes a collected complement, so the sale could not go
  there — and the mid-stay routing that would have sent it to the departure was gated on the stay
  having started, so it went nowhere at all. Collecting the arrival complement now **closes** it, at
  any date, exactly like the start of the stay does: whatever is sold afterwards lands in the
  end-of-stay complement, and every euro of the stay is claimed by an échéance again.
- **The end-of-stay complement card shows the sale immediately.** It rendered the stored amount, so
  an option added on a settled complement vanished from the screen until the next save. It now renders
  the live quote — same amount, same lines, same « Calcul auto » hint as what the save will write.
