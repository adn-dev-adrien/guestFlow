/**
 * Calendar block frontend (build-free, plain ES). Renders N month grids for one property, greying out
 * blocked dates fetched from the plugin REST proxy. Prev/next shift the window and refetch.
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isoOf(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function firstOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }

  var DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  function init(container) {
    var propertyId = parseInt(container.dataset.propertyId, 10) || 0;
    var months = parseInt(container.dataset.months, 10) || 2;
    if (!GF.configured || !propertyId) {
      container.innerHTML = '';
      container.appendChild(GF.el('div', { class: 'gf-error' }, GF.t('unavailable')));
      return;
    }
    var base = firstOfMonth(new Date());

    function monthGrid(monthDate, blocked) {
      var grid = GF.el('div', { class: 'gf-cal-grid' });
      DOW.forEach(function (d) { grid.appendChild(GF.el('div', { class: 'gf-cal-dow' }, d)); });
      var year = monthDate.getFullYear();
      var month = monthDate.getMonth();
      var firstDay = new Date(year, month, 1);
      var lead = (firstDay.getDay() + 6) % 7; // Monday-based
      for (var i = 0; i < lead; i++) grid.appendChild(GF.el('div', { class: 'gf-cal-day gf-empty-cell' }));
      var days = new Date(year, month + 1, 0).getDate();
      for (var d = 1; d <= days; d++) {
        var iso = isoOf(new Date(year, month, d));
        var isBlocked = !!blocked[iso];
        grid.appendChild(GF.el('div', {
          class: 'gf-cal-day ' + (isBlocked ? 'gf-blocked' : 'gf-free'),
          title: isBlocked ? GF.t('blocked') : GF.t('available'),
        }, String(d)));
      }
      var label = monthDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      return GF.el('div', { class: 'gf-cal-month' }, GF.el('div', { class: 'gf-cal-head' }, label), grid);
    }

    function draw(blocked) {
      container.innerHTML = '';
      var nav = GF.el('div', { class: 'gf-cal-head' },
        GF.el('button', { class: 'gf-cal-nav', type: 'button', 'aria-label': 'Précédent', onClick: function () { base = addMonths(base, -1); load(); } }, '‹'),
        GF.el('button', { class: 'gf-cal-nav', type: 'button', 'aria-label': 'Suivant', onClick: function () { base = addMonths(base, 1); load(); } }, '›')
      );
      container.appendChild(nav);
      var wrap = GF.el('div', { class: 'gf-cal-wrap' });
      for (var i = 0; i < months; i++) wrap.appendChild(monthGrid(addMonths(base, i), blocked));
      container.appendChild(wrap);
    }

    function load() {
      container.innerHTML = '';
      container.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('loading')));
      var from = isoOf(base);
      var to = isoOf(addMonths(base, months));
      GF.api('GET', '/properties/' + propertyId + '/availability?from=' + from + '&to=' + to).then(function (res) {
        if (res.status < 200 || res.status >= 300 || !res.body || !res.body.data) {
          container.innerHTML = '';
          container.appendChild(GF.el('div', { class: 'gf-error' }, GF.errorMessage(res)));
          return;
        }
        var blocked = {};
        (res.body.data.blockedDates || []).forEach(function (x) { blocked[x] = true; });
        draw(blocked);
      });
    }

    load();
  }

  document.querySelectorAll('[data-gf-calendar]').forEach(init);
})();
