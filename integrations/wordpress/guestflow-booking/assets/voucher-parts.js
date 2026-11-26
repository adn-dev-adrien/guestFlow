/**
 * What the two gift voucher blocks share (build-free plain ES): the purchase tunnel and « Utiliser un bon cadeau »
 * ask for the same proof of work, count with the same stepper and say amounts and durations the same way.
 * Nothing here decides a price, a total or a limit: every figure drawn comes from GuestFlow.
 *
 *   GFBooking.voucherMoney(cents)        « 150 € », « 12,50 € » — a whole amount without its cents
 *   GFBooking.voucherDuration(minutes)   « 2 h », « 1 h 30 », « 45 min »
 *   GFBooking.voucherStepper(opts)       − n + counter, ≥ 44 px: { value, min, max, step, format(n), name, onChange(n) } → node (with .set(n)); `step` is the server's, never a rule of the page
 *   GFBooking.voucherExtrasFold(opts)    « Ajouter au bon » (specs/gift-voucher-campaigns.md rule 64): the extra time and the add-ons in one fold, closed by default, each line with the price
 *                                        GuestFlow gives for its quantity. { extraTime, addOns, onExtraTime(minutes), onAddOn(articleRef, qty), title?, foot? } → node with .update(extrasCents):
 *                                        a number shows « + Y € » once something is chosen, null shows « … » (the price is being asked), undefined shows nothing. Every amount is
 *                                        looked up in the server's `prices`; the page multiplies and adds nothing. `.updateExtraTimePrices(prices)` swaps the extra-time table for the
 *                                        one the server priced at a chosen start (`null` brings the offer's back); a step with `cents: null` has no price before a slot is chosen.
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
    var digits = Number(cents || 0) % 100 === 0 ? 0 : 2;
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
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

  var CHEVRON = '<svg class="gf-fold-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var PLUS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  function priceAt(prices, key, value) {
    for (var i = 0; i < prices.length; i++) { if (prices[i][key] === value) return prices[i].cents == null ? null : prices[i].cents; }
    return null;
  }

  GF.voucherExtrasFold = function (o) {
    var extra = o.extraTime && o.extraTime.prices && o.extraTime.prices.length ? o.extraTime : null;
    var offeredExtraPrices = extra ? extra.prices : null;
    var extraPrices = offeredExtraPrices;
    var addOns = (o.addOns || []).filter(function (a) { return a.prices && a.prices.length; });
    var available = addOns.length + (extra ? 1 : 0);
    if (!available) return null;

    var state = { extra: 0, qty: {} };
    var extrasCents;
    var firsts = addOns.map(function (a) { return a.prices[0].cents; });
    if (extra && extra.prices[0].cents != null) firsts.push(extra.prices[0].cents);
    var cheapest = firsts.length ? Math.min.apply(null, firsts) : null;
    var bodyId = GF.uid('gf-gv-fold');

    var names = GF.el('span', { class: 'gf-fold-names' });
    var gain = GF.el('b', { class: 'gf-fold-y' });
    var sub = GF.el('span', { class: 'gf-fold-sub' }, names, gain);
    var badge = GF.el('span', { class: 'gf-fold-count', hidden: 'hidden' });
    var head = GF.el('button', { type: 'button', class: 'gf-fold-head', 'aria-expanded': 'false', 'aria-controls': bodyId },
      GF.el('span', { class: 'gf-fold-icon', 'aria-hidden': 'true', html: PLUS }),
      GF.el('span', { class: 'gf-fold-text' }, GF.el('span', { class: 'gf-fold-title' }, o.title || GF.t('gvExtrasTitle')), sub),
      badge,
      GF.el('span', { class: 'gf-fold-chev-wrap', 'aria-hidden': 'true', html: CHEVRON }));
    var pad = GF.el('div', { class: 'gf-fold-pad' });
    var inner = GF.el('div', { class: 'gf-fold-inner', inert: 'inert' }, pad);
    var body = GF.el('div', { class: 'gf-fold-body', id: bodyId, role: 'region' }, inner);
    var node = GF.el('div', { class: 'gf-fold' }, head, body);
    head.addEventListener('click', function () {
      var open = !node.classList.contains('is-open');
      node.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) inner.removeAttribute('inert'); else inner.setAttribute('inert', 'inert');
    });

    function unitText(unitLabel) { return unitLabel === 'par personne' ? GF.t('gvUnitPerson') : GF.t('gvUnitEach'); }

    var lines = [];
    function line(label, subText, stepper) {
      var small = GF.el('small', { class: 'gf-fold-line-sub' }, subText);
      var row = GF.el('div', { class: 'gf-gv-compose-row gf-fold-row' }, GF.el('div', { class: 'gf-gv-compose-label' }, label, small), stepper);
      pad.appendChild(row);
      return { row: row, small: small };
    }

    if (extra) {
      var xLast = offeredExtraPrices[offeredExtraPrices.length - 1].minutes;
      var xMax = extra.maxMinutes ? Math.min(extra.maxMinutes, xLast) : xLast;
      var xView = line(GF.t('gvExtraTime'), '', GF.el('span'));
      var xStep = GF.voucherStepper({
        value: 0, min: 0, max: xMax, step: extra.stepMinutes, name: GF.t('gvExtraTime'),
        format: function (n) { return n ? '+' + GF.voucherDuration(n) : '0'; },
        onChange: function (n) { state.extra = n; paintLine(xLine); paintHead(); if (o.onExtraTime) o.onExtraTime(n); },
      });
      xView.row.replaceChild(xStep, xView.row.lastChild);
      var xLine = {
        small: xView.small,
        text: function () {
          var step = GF.t('gvExtraTimeUnit', GF.voucherDuration(extra.stepMinutes));
          if (!state.extra) return extraPrices[0].cents == null ? step : GF.voucherMoney(extraPrices[0].cents) + ' ' + step;
          var cents = priceAt(extraPrices, 'minutes', state.extra);
          var line = '+' + GF.voucherDuration(state.extra) + (cents === null ? ' · ' + GF.t('gvExtrasBySlot') : ' = ' + GF.voucherMoney(cents));
          return extra.maxMinutes && state.extra >= xMax ? line + ' · ' + GF.t('gvExtrasMax', GF.voucherDuration(xMax)) : line;
        },
        chosen: function () { return state.extra > 0; },
        name: function () { return '+' + GF.voucherDuration(state.extra); },
      };
      lines.push(xLine);
    }
    addOns.forEach(function (a) {
      var aView = line(a.label, '', GF.el('span'));
      var aLine = {
        small: aView.small,
        text: function () {
          var n = state.qty[a.articleRef] || 0;
          if (!n) return GF.voucherMoney(a.prices[0].cents) + ' ' + unitText(a.unitLabel);
          var total = GF.voucherMoney(priceAt(a.prices, 'qty', n));
          var line = a.linear === false ? n + ' : ' + total : n + ' × ' + GF.voucherMoney(a.prices[0].cents) + ' = ' + total;
          return n >= Math.min(a.maxQty, a.prices[a.prices.length - 1].qty) ? line + ' · ' + GF.t('gvExtrasMax', String(n)) : line;
        },
        chosen: function () { return (state.qty[a.articleRef] || 0) > 0; },
        name: function () { var n = state.qty[a.articleRef]; return a.label + (n > 1 ? ' ×' + n : ''); },
      };
      var aStep = GF.voucherStepper({
        value: 0, min: 0, max: Math.min(a.maxQty, a.prices[a.prices.length - 1].qty), name: a.label,
        onChange: function (n) { state.qty[a.articleRef] = n; paintLine(aLine); paintHead(); if (o.onAddOn) o.onAddOn(a.articleRef, n); },
      });
      aView.row.replaceChild(aStep, aView.row.lastChild);
      lines.push(aLine);
    });
    pad.appendChild(GF.el('p', { class: 'gf-fold-foot' }, o.foot || GF.t('gvExtrasFoot')));

    function paintLine(l) {
      l.small.textContent = l.text();
      l.small.parentNode.parentNode.classList.toggle('is-on', l.chosen());
    }

    var lastCount = 0;
    function paintHead() {
      var chosen = lines.filter(function (l) { return l.chosen(); });
      badge.hidden = !chosen.length;
      badge.textContent = String(chosen.length);
      if (chosen.length !== lastCount && chosen.length) { badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop'); }
      lastCount = chosen.length;
      if (!chosen.length) {
        names.textContent = GF.t(available === 1 ? 'gvExtrasAvailableOne' : 'gvExtrasAvailable', String(available)) + (cheapest === null ? '' : ' · ' + GF.t('gvExtrasFrom', GF.voucherMoney(cheapest)));
        gain.textContent = '';
        return;
      }
      names.textContent = chosen.map(function (l) { return l.name(); }).join(', ');
      gain.textContent = extrasCents === undefined ? '' : (extrasCents === null ? '+ …' : '+ ' + GF.voucherMoney(extrasCents));
    }

    node.update = function (cents) { extrasCents = cents; paintHead(); };
    node.updateExtraTimePrices = function (prices) {
      if (!extra) return;
      extraPrices = prices && prices.length ? prices : offeredExtraPrices;
      paintLine(lines[0]);
    };
    lines.forEach(paintLine);
    paintHead();
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
