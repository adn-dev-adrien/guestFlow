// specs/plugins-phase-1-sdk.md rule 58 (loop t26, the money-dialog contract) — the generative invariant harness of the client money
// dialogs. Not a test file: each `moneyDialogs.invariants.<family>.test.jsx` mocks the api module with `apiModule()`, gives an adapter
// (how to draw its dialog, what the operator can do in it, how its server prices a draft) and calls `runFamily`.
//
// A run is a seed: a small PRNG (mulberry32) draws an operator gesture, a server decision (answer a held request — success, 5xx, 408,
// 429, a 4xx refusal, a silent refusal — in any order, or never) or a pause, step after step. The fake server holds every preview and
// commit request until the harness settles it, and prices a draft the way the adapter says. After EVERY step the invariants are checked:
//   I1 every amount on screen comes from the answer to the draft on screen (or from what the operator typed, or from the stored data the
//      dialog opened with), or is « — »; while that draft is asked the latest answer may stay, dimmed; once its answer is there nothing
//      reads « — » where an amount is due;
//   I2 the commit is enabled only on a fresh answer for the draft on screen, with the tender lines covering the due (or the shortfall
//      chosen) and every question answered; a disabled commit sends nothing; a commit sends the draft, the tenders and the shortfall on
//      screen;
//   I3 nothing the operator typed is lost: the typed tender lines, the shortfall choice for the same due, the invoice tick, the address
//      and the draft fields survive answers, failures and remounts of their block;
//   I4 the focus is never on the page nor on the dialog's root (a focused control disabled or removed counts as lost, as in a browser);
//   I5 a failure says why, and offers « Réessayer » when retrying can help (5xx, 408, 429); a retry or an edit recovers, and an older
//      failure's words do not outlive the new answer;
//   I6 no React warning or error, before or after the dialog is unmounted.
// A failing seed is replayed and shrunk to a minimal list of steps, printed with the seed. `HARNESS_SEEDS=<n>` and `HARNESS_STEPS=<m>`
// widen a local run; the permanent suite keeps its fixed seeds within the CI budget.
import React, { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { vi } from 'vitest';

export const PREVIEW_DELAY = 200;

// ---------------------------------------------------------------------------------------------------------------- PRNG and money text
export function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (list) => list[int(list.length)],
    weighted(entries) {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let x = next() * total;
      for (const [value, w] of entries) { x -= w; if (x < 0) return value; }
      return entries[entries.length - 1][0];
    },
  };
}

const MONEY = /(-|−)?\d{1,3}(?:[   ]\d{3})*,\d{2}\s?€/g;
export const centsOfText = (text) => (String(text || '').match(MONEY) || []).map((m) => {
  const negative = /^[-−]/.test(m);
  const digits = m.replace(/[^\d,]/g, '').replace(',', '.');
  const cents = Math.round(Number(digits) * 100);
  return negative ? -cents : cents;
});
export const centsOfInput = (value) => {
  const text = String(value || '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d*)?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
};

// Every amount a payload can carry: `…Cents` fields as cents, other numbers as euros AND as cents (a fixture's euros and cents fields
// look alike), amounts written in its strings.
export function centsIn(value, into = new Set()) {
  const walk = (v, key) => {
    if (v == null) return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (/cents$/i.test(key || '')) into.add(Math.round(v));
      else { into.add(Math.round(v * 100)); into.add(Math.round(v)); }
      return;
    }
    if (typeof v === 'string') { centsOfText(v).forEach((c) => into.add(c)); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
    if (typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(value, '');
  return into;
}

// ---------------------------------------------------------------------------------------------------------------- the api module
// A module whose every function is a mock: the dialogs reach the fake server through it; a call no route answers is recorded and
// answered `{}` (so the run says which route an adapter forgot).
export function apiModule() {
  const fns = {};
  const handler = {
    get(_target, name) {
      if (name === '__esModule') return true;
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (!fns[name]) fns[name] = vi.fn(() => Promise.resolve({}));
      return fns[name];
    },
  };
  const api = new Proxy({}, handler);
  return { __esModule: true, default: api, api };
}

// ---------------------------------------------------------------------------------------------------------------- the fake server
const RETRYABLE = [500, 503, 408, 429];
export const OUTCOMES = {
  ok: { weight: 58 },
  e503: { weight: 9, status: 503 },
  e500: { weight: 3, status: 500 },
  e408: { weight: 3, status: 408 },
  e429: { weight: 3, status: 429 },
  e4xx: { weight: 9, status: 409 },
  silent: { weight: 6 },
};

class FakeServer {
  constructor(ctx) {
    this.ctx = ctx;
    this.requests = [];
    this.seq = 0;
    this.accepted = {};
    // The latest accepted success the dialog's hook may come back to without asking again (useLatestPreview, loop t26).
    this.settled = {};
  }

  install(api, routes) {
    this.routes = routes;
    Object.entries(routes).forEach(([name, route]) => {
      api[name].mockImplementation((...args) => this.call(name, route, args));
    });
  }

  call(name, route, args) {
    if (this.ctx.unmounted && route.kind !== 'read') this.ctx.afterUnmountCalls.push(name);
    if (route.kind === 'read') {
      const answer = typeof route.answer === 'function' ? route.answer(...args) : route.answer;
      if (route.kind === 'read') centsIn(answer, this.ctx.staticCents);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }
    this.seq += 1;
    const req = {
      id: this.seq, name, route, args, channel: (typeof route.channel === 'function' ? route.channel(...args) : route.channel) || name, kind: route.kind, state: 'pending', at: this.ctx.now, step: this.ctx.stepIndex,
      key: route.key ? route.key(...args) : null,
    };
    req.promise = new Promise((resolve, reject) => { req.resolve = resolve; req.reject = reject; });
    const signal = args.map((a) => a && a.signal).find(Boolean);
    if (signal) {
      const abort = () => {
        if (req.state !== 'pending') return;
        req.state = 'aborted';
        req.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort);
    }
    // What the screen shows when the request leaves: a preview asked while the screen holds no draft to ask is a request for nothing.
    if (route.kind === 'preview' && !this.ctx.unmounted) {
      const channel = (this.ctx.adapter.channels || []).find((c) => c.name === req.channel);
      if (channel && this.ctx.ready && channel.key(this.ctx) == null) {
        this.ctx.askedForNothing.push(req);
        if (process.env.HARNESS_DEBUG) process.stderr.write(`ASKED-FOR-NOTHING ${req.channel} key=${req.key} states=${JSON.stringify((this.ctx.adapter.channels || []).map((c) => [c.name, c.key(this.ctx), this.ctx.channelState(c, c.key(this.ctx)).kind]))}\n${this.requests.map((r) => `  #${r.id} ${r.channel} ${r.state}${r.orphan ? ' orphan' : ''} key=${r.key} step=${r.step}`).join('\n')}\n  step ${this.ctx.stepIndex} changedStep ${JSON.stringify(this.ctx.changedStep)}\n`);
      }
    }
    this.requests.push(req);
    if (route.kind === 'commit') this.ctx.onCommit(req);
    return req.promise;
  }

  // A commit the dialog hands to its host through a prop (the fiche saves, then settles): held like a request.
  // `failed`: what the host answers when it fails (a host that reports the failure itself and resolves, e.g. `null`); omitted, it rejects.
  prop(name, args, answer = { ok: true }, failed = undefined) {
    return this.call(name, { kind: 'commit', answer: () => answer, ...(failed !== undefined ? { failValue: failed } : {}) }, args);
  }

  pending() { return this.requests.filter((r) => r.state === 'pending'); }

  lastOf(channel) {
    for (let i = this.requests.length - 1; i >= 0; i -= 1) if (this.requests[i].channel === channel) return this.requests[i];
    return null;
  }

  settle(req, outcome) {
    if (req.state !== 'pending') return;
    const spec = OUTCOMES[outcome] || OUTCOMES.ok;
    const latest = this.lastOf(req.channel) === req;
    if (spec.status) {
      req.state = 'failed';
      req.status = spec.status;
      const retryable = RETRYABLE.includes(spec.status);
      // Each failure has its own words, none the prefix of another (« n° 1 » is in « n° 14 »).
      req.message = retryable ? `Service indisponible [${req.id}]` : `Refusé par le serveur [${req.id}]`;
      const error = Object.assign(new Error(req.message), { status: spec.status, code: retryable ? 'UNAVAILABLE' : 'REFUSED' });
      if (req.route.errorOf) Object.assign(error, req.route.errorOf(req, spec.status));
      if (this.lastOf(req.channel) === req && !req.orphan) this.settled[req.channel] = null;
      if ('failValue' in req.route) req.resolve(req.route.failValue); else req.reject(error);
      return;
    }
    const silent = outcome === 'silent' && typeof req.route.silent === 'function';
    req.state = 'ok';
    req.silent = silent;
    req.answer = silent ? req.route.silent(...req.args) : req.route.answer(...req.args);
    req.cents = centsIn(req.answer);
    if (latest && !req.orphan) { this.accepted[req.channel] = req; this.settled[req.channel] = req; }
    req.resolve(req.answer);
  }
}

// ---------------------------------------------------------------------------------------------------------------- DOM readers
export const scopeOf = (ctx) => (ctx.adapter.scope ? ctx.adapter.scope(ctx) : [...document.querySelectorAll('[role="dialog"]')]);

export function tenderBlocks(root = document.body) {
  const roots = new Set();
  root.querySelectorAll('[data-tender-line]').forEach((line) => roots.add(line.parentElement));
  return [...roots].map((block) => {
    const lines = [...block.querySelectorAll('[data-tender-line]')].map((line) => {
      const select = line.querySelector('select');
      const input = line.querySelector('[data-tender-amount]');
      const auto = /\breste\b/.test(line.textContent) && !/€/.test((input && input.parentElement && input.parentElement.textContent) || '');
      return { method: select ? select.value : null, value: input ? input.value : '', auto, input, disabled: Boolean(input && input.disabled) };
    });
    const dueText = [...block.querySelectorAll('p, span')].map((n) => n.textContent).find((t) => /^Dû\s/.test(t)) || '';
    const meter = block.querySelector('[data-tender-meter]');
    const pressed = block.querySelector('[data-shortfall][aria-pressed="true"]');
    return {
      block,
      lines,
      dueCents: centsOfText(dueText)[0] ?? null,
      meter: meter ? meter.textContent : '',
      covered: Boolean(meter && /^Reste 0,00/.test(meter.textContent)),
      over: Boolean(meter && /de trop/.test(meter.textContent)),
      short: Boolean(meter && /non couverts/.test(meter.textContent)),
      whole: Boolean(block.querySelector('[data-tender-whole]')),
      shortfall: pressed ? pressed.getAttribute('data-shortfall') : null,
      shortfallAsked: Boolean(block.querySelector('[data-shortfall]')),
    };
  });
}

const isHidden = (el) => {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
};
export const focusLost = (el) => !el || !el.isConnected || el.disabled === true || el.getAttribute('aria-disabled') === 'true' || isHidden(el);
const isDialogRoot = (el) => el.getAttribute('role') === 'dialog' || el.classList.contains('MuiDialog-container') || el.classList.contains('MuiDialog-root')
  || el.classList.contains('MuiDialog-paper') || el.classList.contains('MuiModal-root');

// Texts outside the tender blocks (their figures are checked against the due), outside inputs, outside an element the adapter names.
function moneyTexts(roots, ignore) {
  const out = [];
  roots.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('[data-tender-line], [data-tender-meter], [role="group"][aria-label*="pas couverts"], [data-harness-ignore]')) continue;
      if (ignore && parent.closest(ignore)) continue;
      if (isHidden(parent)) continue;
      const text = node.textContent;
      if (!MONEY.test(text)) { MONEY.lastIndex = 0; continue; }
      MONEY.lastIndex = 0;
      // A label split over several nodes (« Encaisser » + « 12,00 € ») is read whole from its element.
      out.push({ el: parent, text: parent.textContent });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the context
class Ctx {
  constructor(adapter, api) {
    this.adapter = adapter;
    this.api = api;
    this.now = 0;
    this.stepIndex = 0;
    this.server = new FakeServer(this);
    this.staticCents = new Set([0]);
    (adapter.staticCents || []).forEach((c) => this.staticCents.add(c));
    if (adapter.fixtures) centsIn(adapter.fixtures, this.staticCents);
    this.typed = new Map();
    this.tenderSnap = null;
    this.shortSnap = null;
    this.tickSnap = new Map();
    this.changedAt = {};
    this.changedStep = {};
    this.lastKeys = {};
    this.commits = [];
    this.focusedOnce = false;
    this.closed = false;
    this.done = false;
    this.unmounted = false;
    this.afterUnmountCalls = [];
    this.consoleErrors = [];
    this.askedForNothing = [];
    this.commitViolations = [];
    this.probeSig = null;
    this.state = {};
  }

  // The answer the screen holds for the draft on screen, or null: what a commit may send (I2).
  freshAnswer(name) {
    const channel = (this.adapter.channels || []).find((c) => c.name === name);
    const state = channel ? this.channelState(channel, channel.key(this)) : null;
    return state && state.kind === 'fresh' ? state.req : null;
  }

  onCommit(req) {
    // A commit sent by the click itself is judged against the button and the screen of that click; one a commit chains after its
    // answer (the booking's payment after its save) against what the adapter kept of the click.
    const fromClick = this.stepIndex === this.commitClickStep;
    this.commits.push({ req, snap: fromClick ? this.clickSnap : null, enabled: fromClick ? this.clickEnabled : true, step: this.stepIndex });
    req.freshAtClick = Object.fromEntries((this.adapter.channels || []).map((c) => [c.name, this.freshAnswer(c.name)]));
  }

  keys() {
    const out = {};
    (this.adapter.channels || []).forEach((channel) => { out[channel.name] = channel.key(this); });
    return out;
  }

  // What the screen should hold for the draft on screen, as the dialog's `useLatestPreview` decides it. Judged after the fact, by what
  // left: a request sent since the draft last changed answers it; nothing sent once the quiet time is over means the hook kept the
  // request already on its way for that draft, or came back to its latest accepted answer (loop t26) — or asked nothing (stale).
  channelState(channel, key) {
    if (key == null) return { kind: 'idle' };
    const name = channel.name;
    const all = this.server.requests.filter((r) => r.channel === name);
    const changed = this.changedStep[name] ?? -1;
    const quiet = this.now - (this.changedAt[name] ?? -Infinity) <= (channel.delay ?? PREVIEW_DELAY) + 20;
    const counts = (r) => r.state !== 'aborted' && !r.orphan;
    const last = all[all.length - 1];
    // The hook listens to its latest request only. For the draft on screen it decides — pending, answered or failed — unless the draft moved
    // after a failure: a draft back to a failed one is asked afresh (pending until that request leaves and answers).
    if (last && counts(last) && last.key === key) {
      if (last.state === 'pending') return { kind: 'pending', req: last };
      if (last.state === 'ok') return { kind: 'fresh', req: last };
      if (last.step < changed) return { kind: 'pending' };
      return { kind: 'failed', req: last, status: last.status };
    }
    // Back to the latest accepted answer — at once: what was asked since for another draft is dropped by the hook.
    const settled = this.server.settled[name];
    if (settled && settled.key === key && !settled.orphan) {
      all.filter((r) => r.state === 'pending' && r.id > settled.id && r.key !== key).forEach((r) => { r.orphan = true; });
      return { kind: 'fresh', req: settled };
    }
    if (quiet) return { kind: 'pending' };
    return { kind: 'stale', last };
  }
}

// The dialog under a `Profiler`: its commit phase calls the probe after every React commit of the dialog's tree.
export const probed = (ctx) => <Profiler id="money-dialog" onRender={() => probeCommit(ctx)}>{ctx.adapter.render(ctx)}</Profiler>;

// ---------------------------------------------------------------------------------------------------------------- time and gestures
// A handler's continuations (an answer, then its own awaits) run inside one `act`, so none of them updates React outside it.
const ticks = async (n = 12) => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };
export async function flush() {
  for (let i = 0; i < 3; i += 1) await act(async () => { await ticks(); });
}
export async function advance(ctx, ms) {
  await act(async () => {
    if (ms > 0) vi.advanceTimersByTime(ms);
  });
  ctx.now += ms;
  await flush();
}
const realSetTimeout = globalThis.setTimeout;
export async function realWait(ms) {
  await act(async () => { await new Promise((resolve) => { realSetTimeout(resolve, ms); }); });
}

// ---------------------------------------------------------------------------------------------------------------- invariants
// `HARNESS_IGNORE=<regex>` (local runs only) sets a class aside, to look past it on an old commit where it hides the others.
const IGNORE = process.env.HARNESS_IGNORE ? new RegExp(process.env.HARNESS_IGNORE) : null;
function violation(list, code, message) { if (!IGNORE || !IGNORE.test(`${code} ${message}`)) list.push({ code, message }); }

const blocksIn = (roots) => tenderBlocks(roots[0] ? roots[0].ownerDocument.body : document.body).filter((b) => roots.some((r) => r.contains(b.block)));
const commitButtonsOf = (ctx) => [].concat(ctx.adapter.commitButton ? ctx.adapter.commitButton(ctx) : []).filter(Boolean);

// What an amount on screen may be: the stored data, what the operator typed, the answer to the draft on screen (or, while that draft is
// asked, the latest answer, dimmed), and what the tender lines add up to.
function allowedCents(ctx, states, blocks) {
  const { adapter } = ctx;
  const allowed = new Set(ctx.staticCents);
  blocks.forEach((b) => b.lines.forEach((l) => { const c = centsOfInput(l.value); if (c != null) allowed.add(c); }));
  ctx.typed.forEach((value) => { const c = centsOfInput(value); if (c != null) { allowed.add(c); allowed.add(-c); } });
  (adapter.typedCents ? adapter.typedCents(ctx) : []).forEach((c) => allowed.add(c));
  (adapter.channels || []).forEach((channel) => {
    const state = states[channel.name];
    if (channel.figures === false) return;
    if (state.kind === 'fresh') state.req.cents.forEach((c) => allowed.add(c));
    if (state.kind === 'pending' && ctx.server.accepted[channel.name]) ctx.server.accepted[channel.name].cents.forEach((c) => allowed.add(c));
  });
  blocks.forEach((b) => {
    const total = b.lines.map((l) => centsOfInput(l.value) || 0).reduce((sum, c) => sum + c, 0);
    allowed.add(total);
    if (b.dueCents != null) { allowed.add(b.dueCents - total); allowed.add(total - b.dueCents); }
  });
  if (adapter.derivedCents) adapter.derivedCents(ctx, allowed).forEach((c) => allowed.add(c));
  return allowed;
}

// Why an enabled commit should not be (I2): a preview not answered for the draft on screen, lines that do not answer the due, a question
// left open.
function gateReasons(ctx, states, blocks, commit) {
  const { adapter } = ctx;
  const reasons = [];
  (adapter.channels || []).filter((c) => c.gates !== false).forEach((channel) => {
    const state = states[channel.name];
    const idleOk = channel.idleCommits !== false;
    if (state.kind === 'idle' && idleOk) return;
    if (state.kind !== 'fresh') reasons.push(`${channel.name} ${state.kind}`);
    else if (channel.refusal && channel.refusal(state.req.answer)) reasons.push(`${channel.name} answer refuses`);
  });
  // The lines a commit sends are those of its own form (the fiche shows the arrival block and a ledger row's form at once).
  blocks.filter((b) => b.block.closest('form') === commit.closest('form'))
    .filter((b) => !adapter.tendersOutsideCommit || !adapter.tendersOutsideCommit(b, commit)).forEach((b) => {
      if (b.lines.some((l) => l.disabled)) return;
      if (b.over) reasons.push('tender lines over the due');
      if (b.short && !b.whole && !b.shortfall) reasons.push('tender lines short, no shortfall chosen');
      if (b.short && b.whole) reasons.push('tender lines short of a whole due');
      if (b.lines.some((l) => !l.auto && l.value.trim() !== '' && centsOfInput(l.value) == null)) reasons.push('unreadable tender line');
    });
  if (adapter.requirements) adapter.requirements(ctx, commit).forEach((r) => reasons.push(r));
  return reasons;
}

// I2 and the commit label's I1 at EVERY React commit (a `Profiler` around the dialog calls this from its commit phase): a commit enabled for
// one frame on an answer of another draft, or a label naming such an amount, is caught even when the next effect takes it back before
// the step ends (loop t26 verifier).
export function probeCommit(ctx) {
  if (!ctx.ready || ctx.done || ctx.closed || ctx.unmounted) return;
  const roots = scopeOf(ctx);
  if (!roots.length) return;
  const buttons = commitButtonsOf(ctx);
  const sig = buttons.map((b) => `${b.disabled ? 0 : 1}:${b.textContent}`).join('|');
  if (sig === ctx.probeSig) return;
  ctx.probeSig = sig;
  // A draft that changed at this commit changed now: its quiet time starts here, as the step's own bookkeeping would say.
  trackKeys(ctx);
  const keys = ctx.keys();
  const states = {};
  (ctx.adapter.channels || []).forEach((channel) => { states[channel.name] = ctx.channelState(channel, keys[channel.name]); });
  ctx.states = states;
  const blocks = blocksIn(roots);
  let allowed = null;
  buttons.forEach((button) => {
    const label = button.textContent.trim();
    if (!button.disabled) {
      const reasons = gateReasons(ctx, states, blocks, button);
      if (reasons.length) ctx.commitViolations.push({ code: 'I2', message: `« ${label} » enabled at a React commit while ${reasons.join(', ')}` });
    }
    const cents = centsOfText(label);
    if (cents.length) {
      allowed = allowed || allowedCents(ctx, states, blocks);
      cents.filter((c) => !allowed.has(c)).forEach((c) => ctx.commitViolations.push({ code: 'I1', message: `« ${label} » named ${c / 100} € at a React commit — from no answer to the draft on screen (${describeStates(states)})` }));
    }
  });
}

export function checkInvariants(ctx) {
  const v = [];
  const { adapter } = ctx;
  const roots = scopeOf(ctx);
  if (ctx.done || ctx.closed || roots.length === 0) return v;
  const keys = ctx.keys();
  const states = {};
  (adapter.channels || []).forEach((channel) => { states[channel.name] = ctx.channelState(channel, keys[channel.name]); });
  ctx.states = states;

  // I1 — the amounts on screen.
  const blocks = blocksIn(roots);
  const allowed = allowedCents(ctx, states, blocks);
  const texts = moneyTexts(roots, adapter.ignore);
  const seen = new Set();
  texts.forEach(({ el, text }) => {
    if (seen.has(el)) return;
    seen.add(el);
    centsOfText(text).forEach((c) => {
      if (!allowed.has(c) && !allowed.has(-c)) violation(v, 'I1', `« ${text.trim().slice(0, 80)} » shows ${c / 100} € — from no answer to the draft on screen (${describeStates(states)})`);
    });
  });
  blocks.forEach((b) => {
    if (b.dueCents == null) return;
    const dues = adapter.dueOf ? adapter.dueOf(ctx, b) : null;
    if (dues && !dues.includes(b.dueCents) && process.env.HARNESS_DEBUG) process.stderr.write(`BLOCK ${b.block.textContent}\n`);
    if (dues && !dues.includes(b.dueCents)) violation(v, 'I1', `tender lines due ${b.dueCents / 100} € — the due on screen is ${dues.map((d) => d / 100).join(' or ') || 'unknown'}`);
  });
  if (adapter.nominal) {
    const { known, elements } = adapter.nominal(ctx);
    if (known) elements.filter(Boolean).forEach((el) => {
      if (/—/.test(el.textContent)) violation(v, 'I1', `« ${el.textContent.trim().slice(0, 60)} » reads « — » on the nominal path while the due is known`);
    });
  }

  // I2 — the commit.
  const commitButtons = commitButtonsOf(ctx);
  commitButtons.filter((commit) => !commit.disabled).forEach((commit) => {
    const reasons = gateReasons(ctx, states, blocks, commit);
    if (reasons.length) violation(v, 'I2', `« ${commit.textContent.trim()} » enabled while ${reasons.join(', ')}`);
  });
  ctx.commitViolations.splice(0).forEach((x) => violation(v, x.code, x.message));
  // Liveness (the ⇐ of I2) is judged once the screen is quiet: nothing on its way, the quiet time over.
  const quiet = ctx.server.pending().length === 0 && (adapter.channels || []).every((c) => ctx.now - (ctx.changedAt[c.name] ?? -Infinity) > (c.delay ?? PREVIEW_DELAY) + 20);
  if (commitButtons.length && adapter.liveness && quiet) {
    const why = adapter.liveness(ctx, blocks);
    if (why) violation(v, 'I2', why);
  }
  ctx.commits.filter((c) => !c.checked).forEach((c) => {
    c.checked = true;
    if (!c.enabled) violation(v, 'I2', `a commit was sent (${c.req.name}) from a disabled button`);
    else if (adapter.commitCheck) adapter.commitCheck(ctx, c.req, c.snap).forEach((m) => violation(v, 'I2', m));
  });

  // I3 — what the operator typed.
  ctx.typed.forEach((value, ident) => {
    const els = adapter.findTyped ? adapter.findTyped(ctx, ident) : [];
    if (els.length === 0) return;
    if (!els.some((el) => el.value === value)) violation(v, 'I3', `« ${ident} » typed « ${value} » now reads « ${els[0].value} »`);
  });
  if (ctx.tenderSnap) {
    // The lines as the operator left them: as many lines, the same methods, and every amount the operator typed as typed. An amount the
    // operator never typed (the default line of the whole due, a remainder) may follow a new due.
    const block = blocks[0];
    if (block) {
      const now = block.lines.map((l) => `${l.method}`).join('|');
      const then = ctx.tenderSnap.lines.map((l) => `${l.method}`).join('|');
      const lost = ctx.tenderSnap.lines.filter((l, i) => l.typed && (!block.lines[i] || block.lines[i].value !== l.value));
      if (now !== then || lost.length) {
        violation(v, 'I3', `tender lines left as [${ctx.tenderSnap.lines.map((l) => `${l.method}:${l.typed ? l.value : '…'}`).join(', ')}] now read [${block.lines.map((l) => `${l.method}:${l.value}`).join(', ')}]`);
      }
    }
  }
  if (ctx.shortSnap) {
    // The block the choice was made in (the fiche can show two); one drawn again in its place is the same block.
    const own = blocks.find((b) => b.block === ctx.shortSnap.block);
    const candidate = own || (blocks.length === 1 ? blocks[0] : null);
    const block = candidate && candidate.shortfallAsked ? candidate : null;
    if (block && block.dueCents === ctx.shortSnap.dueCents && block.shortfall !== ctx.shortSnap.kind) violation(v, 'I3', `shortfall « ${ctx.shortSnap.kind} » chosen for ${ctx.shortSnap.dueCents / 100} € now reads « ${block.shortfall} »`);
    if (block && block.dueCents !== ctx.shortSnap.dueCents && block.shortfall && block.shortfall === ctx.shortSnap.kind && !ctx.shortSnap.again) violation(v, 'I3', `shortfall chosen for ${ctx.shortSnap.dueCents / 100} € still pressed for a due of ${block.dueCents / 100} €`);
  }
  ctx.tickSnap.forEach((checked, ident) => {
    const box = adapter.findTick ? adapter.findTick(ctx, ident) : null;
    if (box && box.checked !== checked) violation(v, 'I3', `« ${ident} » ${checked ? 'ticked' : 'unticked'} now reads ${box.checked ? 'ticked' : 'unticked'}`);
  });

  // I4 — the focus.
  if (ctx.focusedOnce) {
    const active = document.activeElement;
    const from = ctx.focusBefore ? ` (was on « ${(ctx.focusBefore.textContent || ctx.focusBefore.getAttribute('aria-label') || ctx.focusBefore.tagName || '').trim().slice(0, 40)} »)` : '';
    if (!active || active === document.body) violation(v, 'I4', `focus on the page${from}`);
    else if (isDialogRoot(active)) violation(v, 'I4', `focus on the dialog root${from}`);
    else if (focusLost(active)) violation(v, 'I4', `focus on a ${active.disabled ? 'disabled' : 'hidden'} control « ${(active.textContent || active.getAttribute('aria-label') || '').trim().slice(0, 40)} »`);
  }

  // I4 — an answer never moves the focus onto another control (it may only keep it, or give it to the region around a control it removed).
  if (ctx.focusedOnce && ctx.lastAction && ctx.lastAction.kind === 'server') {
    const active = document.activeElement;
    const before = ctx.focusBefore;
    const control = (el) => el && el !== document.body && !el.hasAttribute('data-focus-anchor') && /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName);
    if (control(active) && active !== before && before && before.isConnected && !focusLost(before)) violation(v, 'I4', `an answer moved the focus from « ${(before.textContent || before.getAttribute('aria-label') || before.tagName).trim().slice(0, 30)} » to « ${(active.getAttribute('aria-label') || active.textContent || active.tagName).trim().slice(0, 30)} »`);
  }

  // I5 — failures say why and offer a way out; an older failure does not outlive the answer.
  const bodyText = roots.map((r) => r.textContent).join(' ');
  ctx.askedForNothing.splice(0).forEach((req) => violation(v, 'I5', `${req.channel} asked (${req.name}) while the screen holds no draft to ask`));
  (adapter.channels || []).forEach((channel) => {
    const state = states[channel.name];
    if (state.kind === 'failed' && channel.showsFailure !== false) {
      const { req } = state;
      const words = channel.failureWords ? channel.failureWords(req) : [req.message];
      if (!words.some((w) => (w instanceof RegExp ? w.test(bodyText) : bodyText.includes(w)))) violation(v, 'I5', `${channel.name} failed (${req.status}) with no reason on screen`);
      if (RETRYABLE.includes(req.status) && channel.retry !== false) {
        const retry = roots.flatMap((r) => [...r.querySelectorAll('button')]).find((b) => /^Réessayer$/.test(b.textContent.trim()) && !b.disabled);
        if (!retry) violation(v, 'I5', `${channel.name} failed (${req.status}) with no « Réessayer »`);
      }
      if (!RETRYABLE.includes(req.status)) {
        // A refusal is an answer: retrying the same draft gets the same words. Its reason shows without « Réessayer ».
        const alert = roots.flatMap((r) => [...r.querySelectorAll('[role="alert"]')]).find((a) => a.textContent.includes(req.message));
        if (alert && [...alert.querySelectorAll('button')].some((b) => /^Réessayer$/.test(b.textContent.trim()))) violation(v, 'I5', `${channel.name} refused (${req.status}) and offers « Réessayer » on its refusal`);
      }
    }
    if (state.kind === 'fresh') {
      ctx.server.requests.filter((r) => r.channel === channel.name && r.state === 'failed' && r.id < state.req.id).forEach((r) => {
        if (bodyText.includes(r.message)) violation(v, 'I5', `${channel.name}: the failure « ${r.message} » outlives the new answer`);
      });
    }
    // A failure's own words (« Prix indisponible », « Facture non vérifiée… ») belong to the draft that failed: on another draft — fresh,
    // idle, or asked anew — they are a failure that is no longer true. A retry of the failed draft keeps them through its request.
    const lastFailed = [...ctx.server.requests].reverse().find((r) => r.channel === channel.name && r.state === 'failed');
    const retrying = state.kind === 'pending' && lastFailed && lastFailed.key === ctx.lastKeys[channel.name] && !lastFailed.orphan;
    if (state.kind !== 'failed' && !retrying && channel.failureWords) {
      const fixed = channel.failureWords({ message: '\u0000' }).filter((w) => w instanceof RegExp);
      const shown = fixed.find((w) => w.test(bodyText));
      if (shown && !(adapter.otherFailures && adapter.otherFailures(ctx, channel.name))) violation(v, 'I5', `${channel.name}: « ${shown.source} » shown while the draft on screen has not failed (${state.kind})`);
    }
  });
  if (adapter.extraChecks) adapter.extraChecks(ctx, v);

  // I6 — console.
  ctx.consoleErrors.splice(0).forEach((m) => violation(v, 'I6', m));
  if (v.length && process.env.HARNESS_DEBUG) {
    process.stderr.write(`keys ${JSON.stringify(keys)} now ${ctx.now} changedAt ${JSON.stringify(ctx.changedAt)}\n${ctx.server.requests.map((r) => `  #${r.id} ${r.name} ${r.state} key=${r.key} at=${r.at}`).join('\n')}\n  accepted ${Object.entries(ctx.server.accepted).map(([k, r]) => `${k}:#${r.id}`).join(' ')}\n`);
  }
  return v;
}

function describeStates(states) {
  return Object.entries(states).map(([k, s]) => `${k}:${s.kind}`).join(' ');
}

// ---------------------------------------------------------------------------------------------------------------- generic gestures
// The focus moves inside `act`: MUI's fields keep their focused state in React.
export const focusOn = (el) => act(() => { el.focus(); });
// `beforeClick` moves a model the adapter keeps of the draft at the click itself — after the focus, whose own React commit still shows
// the draft before the gesture — so the per-commit probe judges each commit against the draft on screen.
export const press = async (ctx, el, beforeClick = null) => {
  if (!el) return false;
  const { fireEvent } = await import('@testing-library/react');
  ctx.clickEnabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  focusOn(el);
  if (document.activeElement === el) ctx.focusedOnce = true;
  if (beforeClick) beforeClick();
  await act(async () => { fireEvent.click(el); await ticks(); });
  return true;
};
export const typeInto = async (ctx, el, value, ident) => {
  if (!el || el.disabled || el.value === value) return false;
  const { fireEvent } = await import('@testing-library/react');
  focusOn(el);
  if (document.activeElement === el) ctx.focusedOnce = true;
  fireEvent.change(el, { target: { value } });
  if (ident) ctx.typed.set(ident, value);
  return true;
};
const buttonsIn = (roots) => roots.flatMap((r) => [...r.querySelectorAll('button')]);
export const findButton = (ctx, name) => buttonsIn(scopeOf(ctx)).find((b) => (name instanceof RegExp ? name.test(b.textContent.trim()) : b.textContent.trim() === name)
  || (b.getAttribute('aria-label') && (name instanceof RegExp ? name.test(b.getAttribute('aria-label')) : b.getAttribute('aria-label') === name)));
export const findButtons = (ctx, name) => buttonsIn(scopeOf(ctx)).filter((b) => (name instanceof RegExp ? name.test(b.textContent.trim()) : b.textContent.trim() === name)
  || (b.getAttribute('aria-label') && (name instanceof RegExp ? name.test(b.getAttribute('aria-label')) : b.getAttribute('aria-label') === name)));

export const fieldByLabel = (label, root = document) => [...root.querySelectorAll('[role="dialog"] input, [role="dialog"] textarea')]
  .find((i) => i.labels && i.labels[0] && i.labels[0].textContent.replace('*', '').trim() === label);
export const actionButton = (name) => [...document.querySelectorAll('[role="dialog"] .MuiDialogActions-root button')]
  .find((b) => (name instanceof RegExp ? name.test(b.textContent.trim()) : b.textContent.trim() === name));
export const typedIdent = (ctx, ident) => { const el = fieldByLabel(ident); return el ? [el] : []; };

// The gestures every dialog shares: « Réessayer », and an unmount/remount of the whole dialog (its held requests answered later).
export const retryOp = {
  weight: 3,
  applicable: (ctx) => Boolean(findButton(ctx, 'Réessayer')),
  run: (ctx) => press(ctx, findButton(ctx, 'Réessayer')),
};
export const remountOp = (readyCheck) => ({
  weight: 0.3,
  async run(ctx) {
    await act(async () => { ctx.view.unmount(); });
    ctx.typed.clear(); ctx.tenderSnap = null; ctx.shortSnap = null; ctx.tickSnap.clear(); ctx.focusedOnce = false;
    if (ctx.adapter.onRemount) ctx.adapter.onRemount(ctx);
    // A new mount knows none of the older one's requests: their late answers are not its own, and it asks its drafts afresh.
    ctx.server.requests.forEach((r) => { r.orphan = true; });
    ctx.server.accepted = {};
    ctx.server.settled = {};
    Object.keys(ctx.changedAt).forEach((name) => { ctx.changedAt[name] = ctx.now; });
    await act(async () => { ctx.view = render(probed(ctx)); });
    for (let i = 0; i < 60 && !readyCheck(ctx); i += 1) { await realWait(10); await advance(ctx, 50); }
    (ctx.adapter.channels || []).forEach((c) => { ctx.changedAt[c.name] = ctx.now; ctx.changedStep[c.name] = ctx.stepIndex; });
    return true;
  },
});

// The draft rows of a `SuggestedArticlesStep` (the counter, the visit): label, quantity as typed, offered.
export const articleRows = (title) => [...document.querySelectorAll(`ul[aria-label="${title}"] > li`)].filter((li) => li.querySelector('input'));
// The payment the tender lines on screen describe, as `TenderLines` reports it: the untyped last line left at 0 is no line.
export function tendersOnScreen(block) {
  if (!block) return null;
  const lines = block.lines.map((l, i) => {
    const row = block.block.querySelectorAll('[data-tender-line]')[i];
    const sw = row.querySelector('input[type="checkbox"]');
    return { method: l.method, cents: centsOfInput(l.value) ?? 0, internal: Boolean(sw && sw.checked && l.method === 'cash'), auto: l.auto };
  });
  return lines.filter((l, i) => !(i === lines.length - 1 && l.auto && l.cents === 0 && lines.length > 1));
}
export const tenderSig = (tenders, shortfall) => `${(tenders || []).map((t) => `${t.method}:${t.cents ?? t.amountCents}${t.internal ? 'i' : ''}`).join('+')}${shortfall ? `/${shortfall}` : ''}`;

const TENDER_VALUES = (rnd, due) => {
  const half = due ? Math.max(1, Math.round(due / 2)) : 500;
  return rnd.pick([
    '', String(Math.round(half / 100)), `${Math.floor(half / 100)},`, `${Math.floor(half / 100)},5`, (due ? due / 100 : 10).toFixed(2).replace('.', ','),
    String(rnd.int(40) + 1), `${rnd.int(30) + 1},${rnd.int(10)}`, '0', 'abc',
  ]);
};
// What the operator left in the lines: each line's method, its amount, and whether the operator typed that amount.
const snapTenders = (ctx, typedLine = null, removedLine = null, typedValue = null) => {
  const block = tenderBlocks(document.body).find((b) => scopeOf(ctx).some((r) => r.contains(b.block)));
  if (!block) return;
  const before = ctx.tenderSnap ? ctx.tenderSnap.lines.map((l) => l.typed) : [];
  if (removedLine != null) before.splice(removedLine, 1);
  ctx.tenderSnap = {
    lines: block.lines.map(({ method, value }, i) => ({ method, value, typed: i === typedLine ? String(typedValue ?? '').trim() !== '' : Boolean(before[i]) })),
    dueCents: block.dueCents,
  };
};
// The tender gestures every dialog with « Plusieurs moyens » lines shares.
export const TENDER_OPS = {
  tenderType: {
    weight: 6,
    applicable: (ctx) => tenderBlocks(document.body).some((b) => b.lines.some((l) => !l.disabled)),
    gen: (rnd, ctx) => {
      const block = tenderBlocks(document.body)[0];
      return { line: rnd.int(block.lines.length), value: TENDER_VALUES(rnd, block.dueCents) };
    },
    async run(ctx, { line, value }) {
      const block = tenderBlocks(document.body)[0];
      const target = block && block.lines[line];
      // A value equal to the one shown is no keystroke: React fires no change for it, and the operator typed nothing.
      if (!target || target.disabled || target.input.value === value) return false;
      const { fireEvent } = await import('@testing-library/react');
      focusOn(target.input);
      if (document.activeElement === target.input) ctx.focusedOnce = true;
      fireEvent.change(target.input, { target: { value } });
      await flush();
      snapTenders(ctx, line, null, value);
      return true;
    },
  },
  tenderAdd: {
    weight: 1,
    applicable: (ctx) => Boolean(findButton(ctx, 'Ajouter un moyen')),
    async run(ctx) {
      const ok = await press(ctx, findButton(ctx, 'Ajouter un moyen'));
      await flush();
      snapTenders(ctx);
      return ok;
    },
  },
  tenderRemove: {
    weight: 1,
    applicable: (ctx) => findButtons(ctx, 'Retirer cette ligne').some((b) => !b.disabled),
    gen: (rnd) => ({ at: rnd.int(4) }),
    async run(ctx, { at }) {
      const list = findButtons(ctx, 'Retirer cette ligne').filter((b) => !b.disabled);
      if (!list.length) return false;
      const button = list[at % list.length];
      const index = [...tenderBlocks(document.body)[0].block.querySelectorAll('[data-tender-line]')].findIndex((row) => row.contains(button));
      await press(ctx, button);
      await flush();
      snapTenders(ctx, null, index);
      return true;
    },
  },
  tenderMethod: {
    weight: 1,
    applicable: () => tenderBlocks(document.body).some((b) => b.lines.some((l) => !l.disabled)),
    gen: (rnd) => ({ line: rnd.int(3), method: rnd.pick(['card', 'cash', 'cheque', 'transfer']) }),
    async run(ctx, { line, method }) {
      const block = tenderBlocks(document.body)[0];
      const target = block && block.lines[line % block.lines.length];
      if (!target || target.disabled) return false;
      const select = block.block.querySelectorAll('[data-tender-line]')[line % block.lines.length].querySelector('select');
      const { fireEvent } = await import('@testing-library/react');
      focusOn(select);
      if (document.activeElement === select) ctx.focusedOnce = true;
      fireEvent.change(select, { target: { value: method } });
      await flush();
      snapTenders(ctx);
      return true;
    },
  },
  shortfall: {
    weight: 2,
    applicable: () => Boolean(document.querySelector('[data-shortfall]:not([disabled])')),
    gen: (rnd) => ({ kind: rnd.pick(['due', 'waived']) }),
    async run(ctx, { kind }) {
      const choice = document.querySelector(`[data-shortfall="${kind}"]`) || document.querySelector('[data-shortfall]');
      if (!choice || choice.disabled) return false;
      const block = tenderBlocks(document.body).find((b) => b.block.contains(choice));
      await press(ctx, choice);
      await flush();
      ctx.shortSnap = { kind: choice.getAttribute('data-shortfall'), dueCents: block ? block.dueCents : null, block: block ? block.block : null };
      return true;
    },
  },
};

// The server's gestures: answer a held request (any of them, in any order), or let time pass.
function serverGesture(rnd, ctx) {
  const pending = ctx.server.pending();
  if (!pending.length) return null;
  const at = rnd.int(pending.length);
  const req = pending[at];
  if (req.kind === 'commit') return { kind: 'server', at, outcome: rnd.weighted([['ok', 6], ['e503', 2], ['e4xx', 2]]) };
  const outcomes = Object.entries(OUTCOMES).filter(([name]) => name !== 'silent' || req.route.silent).map(([name, o]) => [name, o.weight]);
  return { kind: 'server', at, outcome: rnd.weighted(outcomes) };
}

// ---------------------------------------------------------------------------------------------------------------- one episode
async function perform(ctx, action) {
  ctx.stepIndex += 1;
  ctx.clickSnap = null;
  if (action.kind === 'time') { await advance(ctx, action.ms); return true; }
  if (action.kind === 'server') {
    const pending = ctx.server.pending();
    const req = pending[action.at % Math.max(pending.length, 1)];
    if (!req) return false;
    await act(async () => { ctx.server.settle(req, action.outcome); await ticks(); });
    await flush();
    if (req.kind === 'commit' && req.state === 'ok' && ctx.adapter.afterCommitOk) await ctx.adapter.afterCommitOk(ctx, req);
    trackKeys(ctx);
    await advance(ctx, action.then || 0);
    return true;
  }
  const op = ctx.ops[action.name];
  if (!op || (op.applicable && !op.applicable(ctx))) return false;
  // A dialog may tie a default to the payment lines (the invoice box follows the presence of a card line): the adapter is told the lines
  // before and after a gesture on them, to expect what the dialog does.
  const tenderGesture = TENDER_OPS[action.name] && ctx.adapter.onTenderGesture;
  const linesBefore = tenderGesture ? tendersOnScreen(tenderBlocks(document.body)[0]) : null;
  if (op.commit) {
    ctx.clickSnap = ctx.adapter.snapshot ? ctx.adapter.snapshot(ctx) : null;
    ctx.commitClickStep = ctx.stepIndex;
  }
  const done = await op.run(ctx, action.args || {});
  await flush();
  if (tenderGesture) ctx.adapter.onTenderGesture(ctx, linesBefore, tendersOnScreen(tenderBlocks(document.body)[0]));
  trackKeys(ctx);
  await advance(ctx, action.then || 0);
  return done !== false;
}

function trackKeys(ctx) {
  const keys = ctx.keys();
  Object.entries(keys).forEach(([name, key]) => {
    if (ctx.lastKeys[name] !== key) { ctx.changedAt[name] = ctx.now; ctx.changedStep[name] = ctx.stepIndex; ctx.lastKeys[name] = key; }
    // A draft that cannot be asked drops what is on its way: a late answer to it is never the screen's (useLatestPreview's sequence).
    if (key == null) {
      ctx.server.requests.filter((r) => r.channel === name && r.state === 'pending').forEach((r) => { r.orphan = true; });
    }

  });
}

function generate(rnd, ctx) {
  const roll = rnd.next();
  const then = rnd.pick([0, 0, 0, 60, PREVIEW_DELAY + 50, 1000]);
  if (roll < 0.36) {
    const g = serverGesture(rnd, ctx);
    if (g) return { ...g, then };
  }
  if (roll > 0.94) return { kind: 'time', ms: rnd.pick([60, PREVIEW_DELAY + 50, 1000]) };
  const available = Object.entries(ctx.ops).filter(([, op]) => !op.applicable || op.applicable(ctx));
  if (!available.length) return { kind: 'time', ms: PREVIEW_DELAY + 50 };
  const name = rnd.weighted(available.map(([n, op]) => [n, op.weight ?? 1]));
  const op = ctx.ops[name];
  return { kind: 'op', name, args: op.gen ? op.gen(rnd, ctx) : {}, then };
}

async function episode(adapter, api, { seed = 0, steps = 40, actions = null, stopAt = null }) {
  const ctx = new Ctx(adapter, api);
  ctx.ops = { ...(adapter.tenders === false ? {} : TENDER_OPS), ...adapter.ops };
  ctx.track = () => trackKeys(ctx);
  ctx.seed = seed;
  // One message is the harness's own: MUI starts a focus ripple once its lazily mounted ripple resolves (a promise outside `act`) when a
  // control is focused from script, as the harness does before each gesture. Every other warning or error counts.
  const harnessNoise = (args) => /not wrapped in act/.test(String(args[0])) && args.some((a) => /TouchRipple/.test(String(a)));
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => { if (harnessNoise(args)) return; ctx.consoleErrors.push(`console.error: ${args.map(String).join(' ').replace(/When testing[\s\S]*?browser\./, '').replace(/\s+/g, ' ').slice(0, 400)}`); });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => { ctx.consoleErrors.push(`console.warn: ${args.map(String).join(' ').slice(0, 300)}`); });
  // A browser moves the focus to the page when the focused control is disabled, hidden or removed (the « focus fixup »); jsdom keeps it on
  // the control. The observer is made before the dialog's, so a FocusKeeper sees the page as the browser would.
  const fixup = new MutationObserver(() => {
    const active = document.activeElement;
    if (active && active !== document.body && focusLost(active)) {
      act(() => { active.blur(); });
    }
  });
  fixup.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'style', 'hidden', 'class'] });
  // A rejection nobody handles is an error of the dialog (I6): a click whose request fails must catch it.
  const unhandled = (reason) => { ctx.consoleErrors.push(`unhandled rejection: ${String(reason && reason.message ? reason.message : reason).slice(0, 200)}`); };
  process.on('unhandledRejection', unhandled);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const performed = [];
  let failure = null;
  try {
    ctx.server.install(api, adapter.routes(ctx));
    await act(async () => { ctx.view = render(probed(ctx)); });
    for (let i = 0; i < 80 && !(adapter.ready ? adapter.ready(ctx) : true); i += 1) { await realWait(15); await advance(ctx, 50); }
    if (adapter.ready && !adapter.ready(ctx)) throw new Error(`${adapter.name}: the dialog never became ready`);
    if (adapter.setup) await adapter.setup(ctx);
    trackKeys(ctx);
    ctx.consoleErrors.splice(0);
    ctx.askedForNothing.splice(0);
    ctx.ready = true;
    const rnd = prng(seed);
    const plan = actions || [];
    const count = actions ? actions.length : steps;
    for (let i = 0; i < count; i += 1) {
      if (ctx.done) break;
      const action = actions ? plan[i] : generate(rnd, ctx);
      const focusBefore = document.activeElement;
      ctx.lastAction = action;
      const ran = await perform(ctx, action);
      if (!ran) continue;
      performed.push(action);
      trackKeys(ctx);
      ctx.focusBefore = focusBefore;
      if (process.env.HARNESS_TRACE) {
        const b = tenderBlocks(document.body)[0];
        process.stderr.write(`STEP ${performed.length} ${describeAction(action)} | ${b ? b.lines.map((l) => `${l.method}:${l.value}${l.auto ? '(auto)' : ''}`).join(' ') : '-'} | snap ${ctx.tenderSnap ? ctx.tenderSnap.lines.map((l) => `${l.method}:${l.value}${l.typed ? '*' : ''}`).join(' ') : '-'}\n`);
      }
      const v = checkInvariants(ctx);
      if (v.length) { failure = { violations: v, actions: performed.slice() }; break; }
      if (stopAt != null && performed.length >= stopAt) break;
    }
    if (!failure) {
      // Unmount with requests still held, then answer them: nothing may update an unmounted tree (I6).
      ctx.unmounted = true;
      await act(async () => { ctx.view.unmount(); });
      for (const req of ctx.server.pending()) await act(async () => { ctx.server.settle(req, 'ok'); });
      await advance(ctx, 2000);
      const after = ctx.consoleErrors.splice(0).map((m) => ({ code: 'I6', message: `after unmount: ${m}` }));
      if (after.length) failure = { violations: after, actions: performed.slice() };
    }
  } catch (e) {
    failure = { violations: [{ code: 'CRASH', message: String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e) }], actions: performed.slice() };
  } finally {
    fixup.disconnect();
    process.off('unhandledRejection', unhandled);
    try { cleanup(); } catch { /* the tree may already be gone */ }
    vi.clearAllTimers();
    vi.useRealTimers();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
  return failure;
}

// ---------------------------------------------------------------------------------------------------------------- shrinking
async function shrink(adapter, api, failure, budget = 120) {
  const codes = new Set(failure.violations.map((x) => x.code));
  const same = (f) => f && f.violations.some((x) => codes.has(x.code));
  let best = failure.actions;
  let bestFailure = failure;
  let tries = 0;
  for (let chunk = Math.max(1, Math.floor(best.length / 2)); chunk >= 1 && tries < budget; chunk = Math.floor(chunk / 2)) {
    for (let start = 0; start < best.length && tries < budget;) {
      const candidate = [...best.slice(0, start), ...best.slice(start + chunk)];
      tries += 1;
      const f = await episode(adapter, api, { actions: candidate });
      if (same(f)) { best = f.actions; bestFailure = f; } else start += chunk;
    }
  }
  return bestFailure;
}

export const describeAction = (a) => {
  if (a.kind === 'time') return `wait ${a.ms} ms`;
  if (a.kind === 'server') return `server: answer pending #${a.at} ${a.outcome}${a.then ? ` +${a.then} ms` : ''}`;
  return `${a.name}${a.args && Object.keys(a.args).length ? ` ${JSON.stringify(a.args)}` : ''}${a.then ? ` +${a.then} ms` : ''}`;
};

// ---------------------------------------------------------------------------------------------------------------- the run
const envInt = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);
export const harnessSeeds = (fixed) => {
  const n = envInt('HARNESS_SEEDS', 0);
  if (!n) return fixed;
  const base = envInt('HARNESS_SEED_BASE', 1);
  return Array.from({ length: n }, (_, i) => base + i);
};
export const harnessSteps = (fixed) => envInt('HARNESS_STEPS', fixed);
// The permanent suite keeps Vitest's budget; a widened local run (`HARNESS_SEEDS`) gets the time it needs.
// Budgets are about three times a family's single-worker time: the full client suite runs these files beside many others (CI shards).
export const harnessTimeout = (fixed = 120000) => (process.env.HARNESS_SEEDS ? 24 * 3600 * 1000 : fixed);

/**
 * Runs every seed of one dialog family; collects each failing seed's shrunk steps. With `HARNESS_REPORT=<file>` it appends one JSON line
 * per failure (the collection mode used to list every violation at once); otherwise the first failing seed fails the test.
 */
export async function runFamily(adapter, api, { seeds, steps }) {
  const failures = [];
  const collect = Boolean(process.env.HARNESS_REPORT);
  // A seed is a number, or `[seed, steps]` for a run that once failed at that length (kept in the permanent list as found).
  for (const entry of seeds) {
    const [seed, length] = Array.isArray(entry) ? entry : [entry, steps];
    const failure = await episode(adapter, api, { seed, steps: process.env.HARNESS_STEPS ? steps : length });
    if (!failure) continue;
    const shrunk = process.env.HARNESS_NO_SHRINK ? failure : await shrink(adapter, api, failure);
    const report = {
      family: adapter.name, seed, violations: shrunk.violations, steps: shrunk.actions.map(describeAction), actions: shrunk.actions,
    };
    failures.push(report);
    if (collect) {
      const fs = await import('fs');
      fs.appendFileSync(process.env.HARNESS_REPORT, `${JSON.stringify(report)}\n`);
    } else break;
  }
  return failures;
}

export const formatFailures = (failures) => failures.map((f) => [
  `${f.family} — seed ${f.seed}:`,
  ...f.violations.map((x) => `  ${x.code} ${x.message}`),
  '  minimal steps:',
  ...f.steps.map((s, i) => `    ${i + 1}. ${s}`),
].join('\n')).join('\n\n');
