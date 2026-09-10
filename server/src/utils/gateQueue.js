// The waiting room between the guest's thumb and the house (specs/guest-gate-access.md §4.3).
//
// The Sowel plugin holds a request open for 25 s asking "anything to do?". Rather than have it poll
// the table on a timer — which would trade a busy loop for latency either way — the pending pollers
// park a promise here, and the guest's press wakes exactly one of them. Nothing is stored: on a
// restart the pollers reconnect and the table is still the source of truth.
//
// In-process by design. There is one guestFlow, single-node, and a second instance would need a
// shared bus for a gate that has one motor.

const waiters = new Set();

/**
 * Resolves as soon as `notify()` is called, or with `null` after `timeoutMs`.
 * `null` is the normal answer, not an error: it is how a long-poll ends quietly.
 */
function waitForWork(timeoutMs) {
  return new Promise((resolve) => {
    const waiter = { resolve: null, timer: null };
    const settle = (value) => {
      if (!waiters.has(waiter)) return;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      resolve(value);
    };
    waiter.resolve = settle;
    waiter.timer = setTimeout(() => settle(null), Math.max(0, Number(timeoutMs) || 0));
    // The timer is deliberately NOT unref'd. It looked tidy — "a long-poll should never be the
    // reason node stays up" — but an unref'd timer means the promise can never settle once nothing
    // else holds the event loop: node exits, and the awaiting caller is simply abandoned. The
    // shutdown path calls drain() instead, which settles every waiter at once, so a graceful stop
    // is immediate and no request is left hanging.
    waiters.add(waiter);
  });
}

/** Wakes one waiting poller, if any. Returns true when someone was actually woken. */
function notify() {
  for (const waiter of waiters) {
    waiter.resolve(true);
    return true;
  }
  return false;
}

/** Wakes everyone — used on shutdown so no request hangs on a closing server. */
function drain() {
  const count = waiters.size;
  for (const waiter of Array.from(waiters)) waiter.resolve(null);
  return count;
}

function pendingCount() {
  return waiters.size;
}

module.exports = { waitForWork, notify, drain, pendingCount };
