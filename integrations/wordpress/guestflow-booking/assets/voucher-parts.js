/**
 * What the two gift voucher blocks share (build-free plain ES): the purchase tunnel and « Utiliser un bon cadeau »
 * ask for the same proof of work, count with the same stepper and say amounts and durations the same way.
 * Nothing here decides a price, a total or a limit: every figure drawn comes from GuestFlow.
 *
 *   GFBooking.voucherMoney(cents)        « 150 € », « 12,50 € » — a whole amount without its cents
 *   GFBooking.voucherDuration(minutes)   « 2 h », « 1 h 30 », « 45 min »
 *   GFBooking.voucherStepper(opts)       − n + counter, ≥ 44 px: { value, min, max, step, format(n), name, onChange(n) } → node (with .set(n)); `step` is the server's, never a rule of the page
 *   GFBooking.voucherInactive(res)       true when GuestFlow says the gift voucher plugin is off (specs/gift-voucher-campaigns.md rule 40)
 *   GFBooking.voucherHide(container)     the block renders nothing
 *   GFBooking.voucherGo(url)             leave for another page (the bank, the booking engine): one place, so a suite can watch it
 *
 * `GFBooking.voucherProof()` is the proof of work of the public voucher calls (specs/gift-vouchers.md rule 15) and
 * returns one holder per block:
 *   wake()                     start the work if none is ready (the form is in front of the visitor)
 *   observe(root)              wake on first focus, touch or sight of `root`
 *   attach(body, hooks)        → Promise<body> with `challenge` + `nonce` set once solved; `hooks.solving()` runs
 *                              when the visitor has to wait for the work, `hooks.sending()` just before the call
 *   spend()                    a challenge is spent by one request, whatever the answer: prepare the next one
 *
 * The same challenge route as the booking request, solved in a Web Worker with the page as fallback.
 * GuestFlow verifies the proof; this file only produces it.
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;

  var CHALLENGE_MIN_MS = 3200;
  var CHALLENGE_REFRESH_MS = 14 * 60 * 1000;

  function solveOnPage(c, finish) {
    if (!window.GFPow) { finish(null); return; }
    var start = 0;
    (function slice() {
      var nonce = window.GFPow.search(String(c.salt), Number(c.difficulty), start, 4000);
      if (nonce !== null) { finish(nonce); return; }
      start += 4000;
      setTimeout(slice, 0);
    })();
  }

  function solveChallenge(c) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(nonce) { if (!done) { done = true; resolve(nonce); } }
      try {
        var worker = new Worker(GF.powWorkerUrl);
        worker.onmessage = function (e) { worker.terminate(); finish(e.data && e.data.nonce); };
        worker.onerror = function () { worker.terminate(); solveOnPage(c, finish); };
        worker.postMessage({ salt: c.salt, difficulty: c.difficulty });
      } catch (e) {
        solveOnPage(c, finish);
      }
    });
  }

  GF.voucherMoney = function (cents) {
    var v = Number(cents || 0) / 100;
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
    } catch (e) { return v + ' €'; }
  };

  GF.voucherDuration = function (minutes) {
    var m = Math.max(0, Number(minutes) || 0);
    if (m < 60) return m + ' ' + GF.t('gvMinShort');
    var rest = m % 60;
    var hours = Math.floor(m / 60) + ' ' + GF.t('gvHourShort');
    return rest === 0 ? hours : hours + ' ' + (rest < 10 ? '0' + rest : rest);
  };

  GF.voucherStepper = function (o) {
    var value = o.value || 0;
    var step = o.step || 1;
    var show = o.format || String;
    var val = GF.el('span', { class: 'gf-step-val', 'aria-live': 'polite' }, show(value));
    var dec = GF.el('button', { type: 'button', class: 'gf-step-btn', 'aria-label': GF.t('stepRemove', o.name || '') }, '−');
    var inc = GF.el('button', { type: 'button', class: 'gf-step-btn', 'aria-label': GF.t('stepAdd', o.name || '') }, '+');
    var node = GF.el('span', { class: 'gf-step', role: 'group', 'aria-label': o.name || null }, dec, val, inc);
    function paint() {
      val.textContent = show(value);
      dec.disabled = value <= o.min;
      inc.disabled = o.max != null && value + step > o.max;
    }
    function apply(n) {
      value = Math.max(o.min, o.max != null ? Math.min(o.max, n) : n);
      paint();
      if (o.onChange) o.onChange(value);
    }
    dec.addEventListener('click', function () { apply(value - step); });
    inc.addEventListener('click', function () { apply(value + step); });
    node.set = function (n) { value = n; paint(); };
    paint();
    return node;
  };

  GF.voucherInactive = function (res) {
    return !!(res && res.body && res.body.error === 'PLUGIN_INACTIVE');
  };

  GF.voucherGo = function (url) { window.location.assign(url); };

  GF.voucherHide = function (container) {
    container.innerHTML = '';
    container.hidden = true;
    container.style.display = 'none';
  };

  GF.voucherProof = function () {
    var proof = null;

    function prepare() {
      var entry = { receivedAt: Date.now(), solved: false };
      entry.promise = GF.api('GET', '/booking-requests/challenge').then(function (res) {
        var c = res.status >= 200 && res.status < 300 && res.body && res.body.data;
        if (!c || !c.salt) return null;
        entry.receivedAt = Date.now();
        return solveChallenge(c).then(function (nonce) { return nonce ? { challenge: c, nonce: nonce } : null; });
      }).then(function (p) { entry.solved = true; return p; });
      proof = entry;
      return entry;
    }

    function current() {
      if (!proof || Date.now() - proof.receivedAt > CHALLENGE_REFRESH_MS) prepare();
      return proof;
    }

    return {
      wake: function () { current(); },
      observe: function (root) {
        var wake = function () { current(); };
        root.addEventListener('focusin', wake);
        root.addEventListener('pointerdown', wake);
        if (window.IntersectionObserver) {
          new IntersectionObserver(function (entries) {
            if (entries.some(function (en) { return en.isIntersecting; })) wake();
          }).observe(root);
        }
      },
      attach: function (body, hooks) {
        var entry = current();
        if (!entry.solved && hooks && hooks.solving) hooks.solving();
        return entry.promise.then(function (p) {
          delete body.challenge;
          delete body.nonce;
          if (p) { body.challenge = p.challenge; body.nonce = p.nonce; }
          if (hooks && hooks.sending) hooks.sending();
          var wait = p ? Math.max(0, entry.receivedAt + CHALLENGE_MIN_MS - Date.now()) : 0;
          return new Promise(function (resolve) { setTimeout(resolve, wait); });
        }).then(function () { return body; });
      },
      spend: function () { prepare(); },
    };
  };
})();
