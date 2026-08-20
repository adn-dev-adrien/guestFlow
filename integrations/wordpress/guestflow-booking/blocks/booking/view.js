/**
 * Booking wizard frontend (build-free, plain ES) — unified widget (specs/wp-booking-widget-redesign.md).
 * Embeds the availability calendar (the ONLY way to pick dates — the date fields are read-only),
 * stepper controls for the party and every quantity, and one uniform list of options + resources.
 * Loads property detail + options + resources, shows a LIVE quote (computed server-side via the
 * plugin proxy → GuestFlow pricing engine), then submits a booking request (a draft devis, never a
 * confirmed reservation).
 *
 * No pricing/availability logic lives here: the quote and the availability flag come from the server.
 * The client-side blocked-range guard is a UX convenience; `/quote`'s `available` stays authoritative.
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;

  var MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayIso() { return isoOf(new Date()); }
  function addDaysIso(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  function frDate(s) { var d = new Date(s + 'T00:00:00'); return d.getDate() + ' ' + MONTHS_FR[d.getMonth()] + ' ' + d.getFullYear(); }

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  function init(container) {
    var propertyId = parseInt(container.dataset.propertyId, 10) || 0;
    var showOptions = container.dataset.showOptions !== '0';
    var payOnline = container.dataset.payOnline === '1';

    // Returning from the Qonto payment page → show the live confirmation status instead of the wizard.
    // The per-devis capability token travels in the return URL so the status poll can authorise itself.
    var returnedDevisId = parseInt(queryParam('gf_payment'), 10) || 0;
    if (returnedDevisId) {
      renderStatus(container, returnedDevisId, queryParam('gf_token') || '');
      return;
    }

    if (!GF.configured || !propertyId) {
      container.innerHTML = '';
      container.appendChild(GF.el('div', { class: 'gf-error' }, GF.t('unavailable')));
      return;
    }
    container.innerHTML = '';
    container.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('loading')));

    Promise.all([
      GF.api('GET', '/properties/' + propertyId),
      showOptions ? GF.api('GET', '/properties/' + propertyId + '/options') : Promise.resolve({ status: 200, body: { data: { ungrouped: [], groups: [] } } }),
      showOptions ? GF.api('GET', '/properties/' + propertyId + '/resources') : Promise.resolve({ status: 200, body: { data: [] } }),
    ]).then(function (r) {
      if (r[0].status < 200 || r[0].status >= 300 || !r[0].body || !r[0].body.data) {
        container.innerHTML = '';
        container.appendChild(GF.el('div', { class: 'gf-error' }, GF.errorMessage(r[0])));
        return;
      }
      build(container, propertyId, r[0].body.data, (r[1].body && r[1].body.data) || {}, (r[2].body && r[2].body.data) || [], payOnline);
    });
  }

  // Success-page view: poll the booking-request status until the payment confirms (the webhook/poll on
  // the GuestFlow side converts the devis → reservation + sends the confirmation email). Read-only.
  function renderStatus(container, devisId, token) {
    container.innerHTML = '';
    var box = GF.el('div', { class: 'gf-booking' });
    container.appendChild(box);
    var tries = 0;
    var MAX_TRIES = 20;

    function waiting() {
      box.innerHTML = '';
      box.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('confirmingPayment')));
    }

    function recap(d) {
      box.innerHTML = '';
      box.appendChild(GF.el('div', { class: 'gf-success' }, GF.t(d.status === 'conflict' ? 'paymentConflict' : 'paymentConfirmed')));
      if (d.propertyName || d.startDate) {
        var lines = GF.el('div', { class: 'gf-summary' });
        lines.appendChild(GF.el('div', { class: 'gf-summary-line' }, GF.el('strong', {}, GF.t('stayRecap')), GF.el('span', {}, d.propertyName || '')));
        if (d.startDate) lines.appendChild(GF.el('div', { class: 'gf-summary-line' }, GF.el('span', {}, GF.t('startDate') + ' → ' + GF.t('endDate')), GF.el('span', {}, d.startDate + ' → ' + d.endDate)));
        var recapTotal = d.totalStayPrice != null ? d.totalStayPrice : d.finalPrice; // tax-inclusive when the server provides it
        if (recapTotal != null) lines.appendChild(GF.el('div', { class: 'gf-summary-line gf-summary-total' }, GF.el('span', {}, GF.t('total')), GF.el('span', {}, GF.euro(recapTotal))));
        // Online-deposit flow: only the acompte was collected — surface the solde still due. The server
        // includes this block only when the balance is unpaid.
        var depositFlow = d.payment && d.payment.mode === 'deposit' && d.payment.balanceAmount;
        if (depositFlow) {
          if (d.payment.depositAmount != null) lines.appendChild(GF.el('div', { class: 'gf-summary-line' }, GF.el('span', {}, GF.t('depositPaid')), GF.el('span', {}, GF.euro(d.payment.depositAmount))));
          var solLabel = d.payment.balanceDueDate ? GF.t('balanceDueBefore', d.payment.balanceDueDate) : GF.t('balance');
          lines.appendChild(GF.el('div', { class: 'gf-summary-line' }, GF.el('span', {}, solLabel), GF.el('span', {}, GF.euro(d.payment.balanceAmount))));
        }
        box.appendChild(lines);
        if (depositFlow) box.appendChild(GF.el('div', { class: 'gf-inline-info' }, GF.t('balanceEmailFollows')));
      }
    }

    function poll() {
      var qs = token ? ('?token=' + encodeURIComponent(token)) : '';
      GF.api('GET', '/booking-requests/' + devisId + '/status' + qs).then(function (res) {
        var d = (res.body && res.body.data) || {};
        if (d.status === 'confirmed' || d.status === 'conflict') { recap(d); return; }
        waiting();
        tries++;
        if (tries < MAX_TRIES) { setTimeout(poll, 3000); return; }
        box.innerHTML = '';
        box.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('paymentPending')));
      });
    }

    waiting();
    poll();
  }

  function build(container, propertyId, detail, options, resources, payOnline) {
    var f = {}; // field refs
    var debounceTimer = null;
    var lastQuote = null;

    // ---- state (steppers render FROM this, never from input values) ----
    var state = {
      start: null, end: null,
      checkInTime: detail.defaultCheckIn || '16:00',
      checkOutTime: detail.defaultCheckOut || '10:00',
      adults: 2, teens: 0, children: 0, babies: 0, babyBeds: 0,
      opt: {}, res: {},
      // Cancellation insurance (specs/cancellation-insurance.md §3.4): null = not answered yet.
      // Never pre-set — the visitor must choose, and the submit stays locked until they do.
      insurance: null,
    };

    // The « Lit bébé » resource is couchage, not a supplement line: it feeds the devis `babyBeds`
    // field via the conditional baby-beds stepper (spec §3.12), exactly like the previous popup.
    var babyRes = null;
    var supplements = (resources || []).filter(function (x) {
      var n = (x.name || '').toLowerCase();
      if (n.indexOf('lit bébé') >= 0 || n.indexOf('lit bebe') >= 0) { babyRes = x; return false; }
      return true;
    });

    // Hide ONLY the time-derived auto-options (arrival/departure are driven by the date/time
    // fields, not a quantity). Paid add-ons (bed/bathroom linen, breakfast, …) stay selectable.
    // See specs/wordpress-plugin.md.
    // `baby_bed` joins them (specs/baby-bed-supplement.md §3.5 rule 18): the cot supplement is
    // derived from the baby-beds stepper below, so offering it as a tickable line would let the
    // visitor order it twice.
    var HIDDEN_AUTO = { early_check_in: 1, late_check_out: 1, baby_bed: 1 };
    function selectable(list) {
      return (list || []).filter(function (o) { return !HIDDEN_AUTO[o.autoOptionType]; });
    }
    // The options payload is grouped server-side (specs/option-categories.md §4.4):
    // `{ ungrouped, groups: [{ category, options }] }`. Tolerate a bare array so a stale proxy
    // cache from before the change still renders (everything then lands in the flat list).
    var pickable = selectable(Array.isArray(options) ? options : (options && options.ungrouped));
    var optionGroups = (!Array.isArray(options) && options && options.groups ? options.groups : [])
      .map(function (g) { return { category: g.category, options: selectable(g.options) }; })
      .filter(function (g) { return g.options.length > 0; });
    // The insurance travels in its own key, already excluded from ungrouped/groups server-side
    // (specs/cancellation-insurance.md §3.3 rule 18). Absent (unconfigured, or a stale proxy cache
    // from before the change) → no block and no mandatory question, the funnel behaves as before.
    var insurance = (!Array.isArray(options) && options && options.cancellationInsurance) || null;
    // Which categories the visitor has unfolded. Collapsed by default (rule 15).
    var openGroups = {};

    function persons() { return (state.adults || 0) + (state.teens || 0) + (state.children || 0); }

    // ---- availability (blocked nights), loaded forward as the visitor navigates ----
    var blocked = {};
    var loadedTo = null; // ISO date up to which blockedDates are known
    function isBlocked(d) { return !!blocked[d]; }
    function rangeHasBlocked(a, b) { var c = a; while (c < b) { if (isBlocked(c)) return true; c = addDaysIso(c, 1); } return false; }

    function ensureAvailability(untilIso) {
      if (loadedTo && untilIso <= loadedTo) return Promise.resolve();
      var from = loadedTo || todayIso();
      return GF.api('GET', '/properties/' + propertyId + '/availability?from=' + from + '&to=' + untilIso).then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data) {
          (res.body.data.blockedDates || []).forEach(function (x) { blocked[x] = true; });
          loadedTo = untilIso;
        }
      });
    }

    // ---- calendar (range select — the ONLY way to set the dates, spec §3.1-4) ----
    var calBase = firstOfMonth(new Date());
    var calMonths = GF.el('div', { class: 'gf-cal-wrap' });
    var calHint = GF.el('div', { class: 'gf-cal-hint' });
    var calBox = GF.el('div', { class: 'gf-cal-box' },
      GF.el('div', { class: 'gf-cal-topbar' },
        GF.el('button', { class: 'gf-cal-nav', type: 'button', 'aria-label': 'Mois précédent', onClick: function () { navCal(-1); } }, '‹'),
        GF.el('strong', {}, GF.t('selectDates')),
        GF.el('button', { class: 'gf-cal-nav', type: 'button', 'aria-label': 'Mois suivant', onClick: function () { navCal(1); } }, '›')
      ),
      calMonths, calHint
    );

    function navCal(dir) {
      var next = addMonths(calBase, dir);
      if (next < firstOfMonth(new Date())) return; // past months hold nothing selectable
      calBase = next;
      renderCal();
    }

    function renderCal() {
      var windowEnd = isoOf(addMonths(calBase, 2));
      ensureAvailability(windowEnd).then(function () {
        calMonths.innerHTML = '';
        for (var i = 0; i < 2; i++) calMonths.appendChild(monthGrid(addMonths(calBase, i)));
        setHint(state.start && !state.end ? GF.t('pickDeparture') : (!state.start ? GF.t('pickArrival') : ''));
      });
    }

    function setHint(msg, isError) {
      calHint.textContent = msg || '';
      calHint.className = 'gf-cal-hint' + (isError ? ' gf-cal-hint-error' : '');
    }

    function monthGrid(monthDate) {
      var year = monthDate.getFullYear();
      var month = monthDate.getMonth();
      var grid = GF.el('div', { class: 'gf-cal-grid' });
      DOW.forEach(function (d) { grid.appendChild(GF.el('div', { class: 'gf-cal-dow' }, d)); });
      var lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-based
      for (var i = 0; i < lead; i++) grid.appendChild(GF.el('div', { class: 'gf-cal-day gf-empty-cell' }));
      var days = new Date(year, month + 1, 0).getDate();
      var today = todayIso();
      for (var d = 1; d <= days; d++) {
        var ds = year + '-' + pad(month + 1) + '-' + pad(d);
        var pickingStart = (!state.start || state.end);
        var disabled = ds < today || (pickingStart ? isBlocked(ds) : (ds < state.start || rangeHasBlocked(state.start, ds)));
        var cls = 'gf-cal-day';
        if (state.start && ds === state.start) cls += ' gf-edge';
        if (state.end && ds === state.end) cls += ' gf-edge';
        if (state.start && state.end && ds > state.start && ds < state.end) cls += ' gf-range';
        var btn = GF.el('button', {
          type: 'button', class: cls, disabled: disabled ? 'disabled' : null,
          onClick: (function (iso) { return function () { onPick(iso); }; })(ds),
        }, String(d));
        grid.appendChild(btn);
      }
      var label = MONTHS_FR[month] + ' ' + year;
      return GF.el('div', { class: 'gf-cal-month' }, GF.el('div', { class: 'gf-cal-title' }, label), grid);
    }

    function onPick(ds) {
      if (state.start && !state.end && ds === state.start) { state.start = null; afterDatesChange(); return; }
      if (!state.start || state.end) { state.start = ds; state.end = null; afterDatesChange(); return; }
      if (ds <= state.start) { state.start = ds; state.end = null; afterDatesChange(); return; }
      if (rangeHasBlocked(state.start, ds)) { state.start = ds; state.end = null; afterDatesChange(); setHint(GF.t('rangeBlocked'), true); return; }
      state.end = ds;
      afterDatesChange();
    }

    function afterDatesChange() {
      f.startDisplay.value = state.start ? frDate(state.start) : '—';
      f.endDisplay.value = state.end ? frDate(state.end) : '—';
      renderCal();
      scheduleQuote();
    }

    // ---- read-only date recap + time selects (spec §3.3, §3.5) ----
    f.startDisplay = GF.el('input', { type: 'text', class: 'gf-ro', readonly: 'readonly', tabindex: '-1', 'aria-readonly': 'true', value: '—' });
    f.endDisplay = GF.el('input', { type: 'text', class: 'gf-ro', readonly: 'readonly', tabindex: '-1', 'aria-readonly': 'true', value: '—' });
    f.checkInTime = GF.el('input', { type: 'time', value: state.checkInTime, onInput: function () { state.checkInTime = f.checkInTime.value; scheduleQuote(); } });
    f.checkOutTime = GF.el('input', { type: 'time', value: state.checkOutTime, onInput: function () { state.checkOutTime = f.checkOutTime.value; scheduleQuote(); } });

    var datesRow = GF.el('div', { class: 'gf-row' },
      GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('startDate')), f.startDisplay),
      GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('endDate')), f.endDisplay),
      GF.el('div', { class: 'gf-field gf-field-time' }, GF.el('label', {}, GF.t('checkInTime')), f.checkInTime),
      GF.el('div', { class: 'gf-field gf-field-time' }, GF.el('label', {}, GF.t('checkOutTime')), f.checkOutTime)
    );

    // ---- stepper (− n +), the single quantity control of the widget (spec §3.6-7, ≥44px) ----
    function stepper(get, set, min, max) {
      var val = GF.el('span', { class: 'gf-step-val' }, String(get()));
      function apply(v) { set(v); val.textContent = String(v); scheduleQuote(); }
      var dec = GF.el('button', { type: 'button', class: 'gf-step-btn', 'aria-label': '−', onClick: function () { apply(Math.max(min, get() - 1)); } }, '−');
      var inc = GF.el('button', {
        type: 'button', class: 'gf-step-btn', 'aria-label': '+',
        onClick: function () {
          var mx = (typeof max === 'function') ? max() : (max == null ? 99 : max);
          apply(Math.min(mx, get() + 1));
        },
      }, '+');
      return GF.el('span', { class: 'gf-step' }, dec, val, inc);
    }

    // Uniform row: [title + subtitle] … [price italic] [stepper] — one layout for guests, options
    // and resources (spec §3.7). `note`/`desc` render under the row when provided.
    function line(title, subtitle, priceText, control, extras) {
      var main = GF.el('div', { class: 'gf-line-main' },
        GF.el('div', { class: 'gf-line-title' }, title),
        subtitle ? GF.el('div', { class: 'gf-line-sub' }, subtitle) : null
      );
      var head = GF.el('div', { class: 'gf-line-head' },
        main,
        priceText ? GF.el('span', { class: 'gf-line-price' }, priceText) : null,
        control
      );
      var wrap = GF.el('div', { class: 'gf-line' }, head);
      (extras || []).forEach(function (x) { if (x) wrap.appendChild(x); });
      return wrap;
    }

    // ---- Voyageurs (spec §3.6) ----
    // The cot supplement's unit price, straight from the catalogue the API serves — the plugin never
    // hardcodes an amount (specs/baby-bed-supplement.md §3.5 rule 17). 0 / absent = this logement
    // does not charge for cots, and the row keeps its « selon disponibilité » wording.
    var babyBedPrice = (function () {
      var all = Array.isArray(options) ? options : [].concat(
        (options && options.ungrouped) || [],
        ((options && options.groups) || []).reduce(function (acc, g) { return acc.concat(g.options || []); }, [])
      );
      for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].autoOptionType === 'baby_bed') return Number(all[i].price || 0);
      }
      return 0;
    })();
    var babyBedsSub = babyBedPrice > 0
      ? GF.t('babyBedsSubPriced', GF.euro(babyBedPrice))
      : GF.t('babyBedsSub');

    var babyBedsHolder = GF.el('div', {});
    function renderBabyBeds() {
      babyBedsHolder.innerHTML = '';
      if (state.babies > 0 && babyRes) {
        babyBedsHolder.appendChild(line(GF.t('babyBedsLabel'), babyBedsSub, null,
          stepper(function () { return state.babyBeds; }, function (v) { state.babyBeds = Math.min(v, state.babies); }, 0, function () { return state.babies; })));
      } else {
        state.babyBeds = 0;
      }
    }

    // Capacity — ONE total for everyone over 2, babies apart (GuestFlow
    // specs/property-capacity-single-total.md §3 rule 13). Capping the steppers here is what stops a
    // visitor composing an occupancy the API would reject with 409 OVER_CAPACITY at submit time.
    // 0 = capacity not configured → no cap.
    var maxGuests = Number(detail.maxGuests || detail.maxAdults || 0);
    var maxBabies = Number(detail.maxBabies || 0);
    // The widget opens on 2 adults — a 1-guest property would start over capacity.
    if (maxGuests && state.adults > maxGuests) state.adults = maxGuests;
    function guestCap(get) {
      return function () {
        if (!maxGuests) return 99;
        return get() + Math.max(0, maxGuests - persons());
      };
    }
    var capacityNote = maxGuests
      ? GF.t('capacity') + ' : ' + maxGuests + ' ' + GF.t('guestsUnit')
        + (maxBabies ? ' · ' + maxBabies + ' ' + GF.t('babiesUnit') : '')
      : null;

    var guestsBox = GF.el('div', { class: 'gf-section' },
      GF.el('div', { class: 'gf-section-title' }, GF.t('travelers')),
      capacityNote ? GF.el('div', { class: 'gf-line-sub' }, capacityNote) : null,
      GF.el('div', { class: 'gf-lines' },
        line(GF.t('adults'), null, null, stepper(function () { return state.adults; }, function (v) { state.adults = v; renderSupplements(); }, 1, guestCap(function () { return state.adults; }))),
        line(GF.t('teens'), GF.t('teensAges'), null, stepper(function () { return state.teens; }, function (v) { state.teens = v; renderSupplements(); }, 0, guestCap(function () { return state.teens; }))),
        line(GF.t('children'), GF.t('childrenAges'), null, stepper(function () { return state.children; }, function (v) { state.children = v; renderSupplements(); }, 0, guestCap(function () { return state.children; }))),
        line(GF.t('babies'), GF.t('babiesAges'), null, stepper(function () { return state.babies; }, function (v) { state.babies = v; if (state.babyBeds > v) state.babyBeds = v; renderBabyBeds(); }, 0, function () { return maxBabies; })),
        babyBedsHolder
      )
    );

    // ---- Options & suppléments — ONE uniform list (spec §3.7-14) ----
    var supplementsList = GF.el('div', { class: 'gf-lines' });
    var groupsHolder = GF.el('div', {});
    var supplementsBox = (pickable.length || supplements.length || optionGroups.length)
      ? GF.el('div', { class: 'gf-section' }, GF.el('div', { class: 'gf-section-title' }, GF.t('supplements')), supplementsList, groupsHolder)
      : null;

    function priceText(item) {
      if (!item.price) return null;
      return GF.euro(item.price) + (item.priceUnitLabel ? ' · ' + item.priceUnitLabel : '');
    }

    // One selectable option row. `onChange` lets a category refresh its picked count without
    // re-rendering the whole list (which would steal focus mid-click).
    function optionLine(o, onChange) {
      if (!(o.id in state.opt)) state.opt[o.id] = 0;
      var progressive = o.priceType === 'per_participant_progressive';
      if (progressive && state.opt[o.id] > Math.max(1, persons())) state.opt[o.id] = Math.max(1, persons());
      var titleGroup = [o.title || ''];
      var extras = [];
      if (o.description) {
        var descBox = GF.el('div', { class: 'gf-line-desc', style: 'display:none' }, o.description);
        extras.push(descBox);
        titleGroup.push(GF.el('button', {
          type: 'button', class: 'gf-info-btn', title: o.description, 'aria-label': GF.t('moreInfo'),
          onClick: (function (box) { return function () { box.style.display = box.style.display === 'none' ? 'block' : 'none'; }; })(descBox),
        }, 'ⓘ'));
      }
      // No « à planifier » note on options — it belongs to host-scheduled resources only (spec §3.9).
      var max = progressive ? function () { return Math.max(1, persons()); } : null;
      return line(
        GF.el('span', {}, titleGroup),
        o.quantityLabel || null,
        priceText(o),
        stepper(
          function () { return state.opt[o.id]; },
          function (v) { state.opt[o.id] = v; if (onChange) onChange(); },
          0,
          max
        ),
        extras
      );
    }

    // A collapsible category (specs/option-categories.md §3 rules 15-16). Options the visitor has
    // already picked render ABOVE the fold and stay visible when the section is closed — a folded
    // section must never hide a charge.
    function renderGroup(group) {
      // Pinned = picked by the visitor, OR flagged `alwaysVisible` in the catalogue (rule 9bis) —
      // that's how « Petit déjeuner » keeps showing even though it now sits inside a category.
      function isPinned(o) { return o.alwaysVisible === true || (state.opt[o.id] || 0) > 0; }
      var open = Boolean(openGroups[group.category]);

      // The count is what's actually SELECTED — an always-visible line nobody picked must not
      // inflate it.
      function selectedCount() {
        return group.options.filter(function (o) { return (state.opt[o.id] || 0) > 0; }).length;
      }
      var countNode = GF.el('span', { class: 'gf-group-count' }, selectedCount() ? String(selectedCount()) : '');
      var head = GF.el('button', {
        type: 'button',
        class: 'gf-group-head',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': GF.t('categoryAria', group.category),
      },
        GF.el('span', { class: 'gf-group-title' }, group.category),
        countNode,
        GF.el('span', { class: 'gf-group-chevron' })
      );

      var pinnedBox = GF.el('div', { class: 'gf-lines' });
      var bodyLines = GF.el('div', { class: 'gf-lines' });
      var body = GF.el('div', { class: 'gf-group-body' + (open ? ' is-open' : '') }, bodyLines);
      var toggle = GF.el('button', { type: 'button', class: 'gf-group-toggle' }, '');

      // One node per option, built once. Picking a line MOVES its node between the pinned box and
      // the folded body instead of re-rendering the group — a re-render would rebuild the stepper
      // the visitor is clicking and steal its focus.
      var nodes = {};
      group.options.forEach(function (o) { nodes[o.id] = optionLine(o, sync); });

      // Re-home the lines in the category's own order, so one that becomes pinned lands in its
      // right place rather than at the end. Only nodes actually out of position are touched —
      // re-inserting a node that is already correct would blur whatever is focused inside it.
      function place(container, list) {
        list.forEach(function (o, i) {
          var node = nodes[o.id];
          if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
        });
      }
      function sync() {
        // Moving a node across parents blurs whatever is focused inside it — which is exactly what
        // happens to the « + » button on the click that takes a line from 0 to 1. Restore it, or a
        // keyboard user loses their place mid-interaction.
        var active = document.activeElement;
        var refocus = active && pinnedBox.parentNode && pinnedBox.parentNode.contains(active) ? active : null;
        place(pinnedBox, group.options.filter(isPinned));
        place(bodyLines, group.options.filter(function (o) { return !isPinned(o); }));
        if (refocus && document.activeElement !== refocus) refocus.focus();
        var n = selectedCount();
        countNode.textContent = n ? String(n) : '';
        syncToggle();
      }

      function syncToggle() {
        var pinnedCount = group.options.filter(isPinned).length;
        var restCount = group.options.length - pinnedCount;
        // Nothing left to reveal → no affordance, rather than a button opening an empty box.
        if (restCount === 0) { toggle.style.display = 'none'; return; }
        toggle.style.display = '';
        toggle.textContent = openGroups[group.category]
          ? GF.t('collapse')
          : (pinnedCount ? GF.t('showOthers', restCount) : GF.t('showCategory', restCount));
      }
      function flip() {
        openGroups[group.category] = !openGroups[group.category];
        var nowOpen = Boolean(openGroups[group.category]);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        body.className = 'gf-group-body' + (nowOpen ? ' is-open' : '');
        syncToggle();
      }
      head.addEventListener('click', flip);
      toggle.addEventListener('click', flip);
      sync();

      return GF.el('div', { class: 'gf-group' }, head, pinnedBox, body, toggle);
    }

    function renderSupplements() {
      supplementsList.innerHTML = '';
      pickable.forEach(function (o) { supplementsList.appendChild(optionLine(o)); });
      supplements.forEach(function (r) {
        if (!(r.id in state.res)) state.res[r.id] = 0;
        var extras = [];
        if (r.showsSchedulingNote) extras.push(GF.el('div', { class: 'gf-line-note' }, GF.t('toBeScheduled')));
        supplementsList.appendChild(line(
          r.name || '',
          r.quantityLabel || null,
          priceText(r),
          stepper(function () { return state.res[r.id]; }, function (v) { state.res[r.id] = v; }, 0),
          extras
        ));
      });
      groupsHolder.innerHTML = '';
      optionGroups.forEach(function (g) { groupsHolder.appendChild(renderGroup(g)); });
    }

    // ---- Assurance annulation — its own block, with a mandatory Oui/Non choice (spec §3.4) ----
    // Rendered between the supplements and the price summary: the visitor sees what the stay costs
    // to insure just before committing, and cannot submit without answering.
    var insuranceAmount = GF.el('span', { class: 'gf-line-price' }, insurance ? insurance.priceLabel : '');
    var insuranceNotice = GF.el('div', {});
    var insuranceYes = null;
    var insuranceNo = null;
    var insuranceBox = null;
    if (insurance) {
      var paintInsurance = function () {
        insuranceYes.className = 'gf-choice' + (state.insurance === true ? ' gf-choice-on' : '');
        insuranceNo.className = 'gf-choice' + (state.insurance === false ? ' gf-choice-on' : '');
        insuranceYes.setAttribute('aria-pressed', state.insurance === true ? 'true' : 'false');
        insuranceNo.setAttribute('aria-pressed', state.insurance === false ? 'true' : 'false');
      };
      var answer = function (value) {
        return function () {
          if (state.insurance === value) return;
          state.insurance = value;
          insuranceNotice.innerHTML = '';
          paintInsurance();
          recompute();
        };
      };
      insuranceYes = GF.el('button', { type: 'button', class: 'gf-choice', onClick: answer(true) }, GF.t('insuranceYes'));
      insuranceNo = GF.el('button', { type: 'button', class: 'gf-choice', onClick: answer(false) }, GF.t('insuranceNo'));
      insuranceBox = GF.el('div', { class: 'gf-section gf-insurance' },
        GF.el('div', { class: 'gf-section-title' }, insurance.title || GF.t('insuranceTitle')),
        insurance.description ? GF.el('div', { class: 'gf-line-sub' }, insurance.description) : null,
        GF.el('div', { class: 'gf-insurance-price' }, insuranceAmount),
        GF.el('div', { class: 'gf-choices' }, insuranceYes, insuranceNo),
        insuranceNotice
      );
      paintInsurance();
    }

    var summary = GF.el('div', { class: 'gf-summary' });
    var warn = GF.el('div', {});

    // Contact + message + honeypot
    f.firstName = GF.el('input', { type: 'text', autocomplete: 'given-name' });
    f.lastName = GF.el('input', { type: 'text', autocomplete: 'family-name' });
    f.email = GF.el('input', { type: 'email', autocomplete: 'email' });
    f.phone = GF.el('input', { type: 'tel', autocomplete: 'tel' });
    f.message = GF.el('textarea', { rows: '3' });
    f.hp = GF.el('input', { type: 'text', tabindex: '-1', autocomplete: 'off' });

    var contact = GF.el('div', {},
      GF.el('div', { class: 'gf-row' },
        GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('firstName') + ' *'), f.firstName),
        GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('lastName') + ' *'), f.lastName)
      ),
      GF.el('div', { class: 'gf-row' },
        GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('email') + ' *'), f.email),
        GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('phone') + ' *'), f.phone)
      ),
      GF.el('div', { class: 'gf-row' }, GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('message')), f.message)),
      GF.el('div', { class: 'gf-hp' }, GF.el('label', {}, 'Ne pas remplir', f.hp))
    );

    var submitLabel = payOnline ? GF.t('payOnline') : GF.t('sendRequest');
    f.submit = GF.el('button', { class: 'gf-btn', type: 'button', disabled: 'disabled', onClick: submit }, submitLabel);
    var feedback = GF.el('div', {});

    var form = GF.el('div', { class: 'gf-booking' },
      GF.el('h3', { class: 'gf-booking-name' }, detail.name || ''),
      calBox, datesRow, guestsBox, supplementsBox, insuranceBox, summary, warn, contact, f.submit, feedback
    );
    container.innerHTML = '';
    container.appendChild(form);

    function gatherStay() {
      var opts = [];
      Object.keys(state.opt).forEach(function (id) {
        if (state.opt[id] > 0) opts.push({ optionId: parseInt(id, 10), quantity: state.opt[id] });
      });
      // « Oui » = one insurance line. The server prices it; the site never computes an amount.
      if (insurance && state.insurance === true) {
        opts.push({ optionId: insurance.optionId, quantity: 1 });
      }
      var ress = [];
      Object.keys(state.res).forEach(function (id) {
        if (state.res[id] > 0) ress.push({ resourceId: parseInt(id, 10), quantity: state.res[id] });
      });
      return {
        propertyId: propertyId,
        startDate: state.start,
        endDate: state.end,
        checkInTime: state.checkInTime,
        checkOutTime: state.checkOutTime,
        adults: state.adults,
        children: state.children,
        teens: state.teens,
        babies: state.babies,
        babyBeds: state.babyBeds,
        options: opts,
        resources: ress,
      };
    }

    function scheduleQuote() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recompute, 400);
    }

    function recompute() {
      var stay = gatherStay();
      if (!stay.startDate || !stay.endDate) {
        summary.innerHTML = '';
        summary.appendChild(GF.el('div', { class: 'gf-empty' }, GF.t('pickArrival')));
        warn.innerHTML = '';
        f.submit.disabled = true;
        lastQuote = null;
        return;
      }
      summary.innerHTML = '';
      summary.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('loading')));
      GF.api('POST', '/quote', stay).then(function (res) {
        if (res.status < 200 || res.status >= 300 || !res.body || !res.body.data) {
          summary.innerHTML = '';
          summary.appendChild(GF.el('div', { class: 'gf-error' }, GF.errorMessage(res)));
          f.submit.disabled = true;
          lastQuote = null;
          return;
        }
        var q = res.body.data;
        // Min-nights breach: clear the departure and steer back to the calendar (spec §3.4).
        if (q.minNightsBreached) {
          state.end = null;
          f.endDisplay.value = '—';
          renderCal();
          setHint(GF.t('minNights', q.minNights), true);
          summary.innerHTML = '';
          summary.appendChild(GF.el('div', { class: 'gf-empty' }, GF.t('pickDeparture')));
          warn.innerHTML = '';
          f.submit.disabled = true;
          lastQuote = null;
          return;
        }
        lastQuote = q;
        drawSummary(q);
      });
    }

    function drawSummary(q) {
      summary.innerHTML = '';
      function sline(label, value, cls) { return GF.el('div', { class: 'gf-summary-line ' + (cls || '') }, GF.el('span', {}, label), GF.el('span', {}, value)); }
      summary.appendChild(sline(q.nights + ' ' + GF.t('nights'), GF.euro(q.accommodationTotal)));
      (q.options || []).forEach(function (o) {
        summary.appendChild(sline(o.title + ' ×' + o.quantity, o.offered ? GF.t('offered') : GF.euro(o.total)));
      });
      (q.resources || []).forEach(function (r) {
        summary.appendChild(sline((r.name || '') + ' ×' + r.quantity, r.offered ? GF.t('offered') : GF.euro(r.total)));
      });
      if (q.touristTax && q.touristTax.total) summary.appendChild(sline(GF.t('touristTax'), GF.euro(q.touristTax.total)));
      // Headline total = totalStayPrice (tax-INCLUSIVE) — what the guest actually pays online.
      // finalPrice is tax-exclusive; showing it as "Total" under a tax line understated the charge.
      summary.appendChild(sline(GF.t('total'), GF.euro(q.totalStayPrice != null ? q.totalStayPrice : q.finalPrice), 'gf-summary-total'));
      // Deposit mode (server-decided): the site charges the acompte now, the solde is emailed later. The
      // server OMITS the deposit/balance blocks in full mode, so these lines only appear when relevant.
      var depositMode = q.payment && q.payment.mode === 'deposit';
      if (depositMode && q.deposit && q.deposit.amount) {
        summary.appendChild(sline(GF.t('depositNow'), GF.euro(q.deposit.amount)));
        if (q.balance && q.balance.amount) {
          var balLabel = q.balance.dueDate ? GF.t('balanceDueBefore', q.balance.dueDate) : GF.t('balance');
          summary.appendChild(sline(balLabel, GF.euro(q.balance.amount)));
        }
      }
      // Button reflects what the guest pays now (« Payer l'acompte » vs « Payer en ligne »).
      if (payOnline) f.submit.textContent = depositMode ? GF.t('payDeposit') : GF.t('payOnline');

      // The insurance amount is priced by the server for THIS stay, taken or not (spec §3.3
      // rule 19), so the visitor decides on a real amount rather than on a percentage.
      if (insurance) {
        var ins = q.cancellationInsurance;
        insuranceAmount.textContent = (ins && ins.amount != null)
          ? GF.euro(ins.amount)
          : insurance.priceLabel;
      }

      warn.innerHTML = '';
      var ok = true;
      if (q.available === false) { warn.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('datesUnavailable'))); ok = false; }
      f.submit.disabled = !ok;
    }

    function submit() {
      feedback.innerHTML = '';
      if (!lastQuote) return;
      // The insurance answer is mandatory (spec §3.4 rule 23). Refused ON CLICK — the same way the
      // required contact fields are — rather than by greying the button out: a disabled button
      // never gets to say why it is inert.
      if (insurance && state.insurance === null) {
        insuranceNotice.innerHTML = '';
        insuranceNotice.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('insuranceRequired')));
        if (insuranceBox && insuranceBox.scrollIntoView) insuranceBox.scrollIntoView({ block: 'center' });
        return;
      }
      var stay = gatherStay();
      var first = f.firstName.value.trim(), last = f.lastName.value.trim(), email = f.email.value.trim(), phone = f.phone.value.trim();
      if (!first || !last || !email || !phone) {
        feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('requiredFields')));
        return;
      }
      var body = Object.assign({}, stay, {
        guest: { firstName: first, lastName: last, email: email, phone: phone },
        message: f.message.value.trim(),
        _hp: f.hp.value,
      });
      f.submit.disabled = true;
      f.submit.textContent = payOnline ? GF.t('preparingPayment') : GF.t('sending');
      GF.api('POST', '/booking-requests', body).then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data) {
          if (payOnline) { startPayment(res.body.data.requestId, res.body.data.publicToken); return; }
          container.innerHTML = '';
          container.appendChild(GF.el('div', { class: 'gf-success' }, GF.t('requestSent', res.body.data.reference || '')));
          return;
        }
        f.submit.disabled = false;
        f.submit.textContent = submitLabel;
        feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.errorMessage(res)));
      });
    }

    // Use case 2: create/reuse the Qonto FULL link for the just-created devis and send the visitor to
    // the hosted payment page. Qonto returns them to this same page with ?gf_payment=<id>&gf_token=<t>
    // (the status view above then polls until confirmed). Amount + availability are enforced
    // server-side; the per-devis token authorises both the pay call and the return-page status poll.
    function startPayment(devisId, token) {
      if (!devisId || !token) { paymentError(); return; }
      var returnPath = window.location.pathname + '?gf_payment=' + devisId + '&gf_token=' + encodeURIComponent(token);
      GF.api('POST', '/booking-requests/' + devisId + '/pay', { returnPath: returnPath, token: token }).then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data && res.body.data.paymentUrl) {
          feedback.innerHTML = '';
          feedback.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('redirectingPayment')));
          window.location.href = res.body.data.paymentUrl;
          return;
        }
        paymentError(res);
      });
    }

    function paymentError(res) {
      f.submit.disabled = false;
      f.submit.textContent = submitLabel;
      feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, res ? GF.errorMessage(res) : GF.t('genericError')));
    }

    renderBabyBeds();
    renderSupplements();
    renderCal();
    recompute();
  }

  document.querySelectorAll('[data-gf-booking]').forEach(init);
})();
