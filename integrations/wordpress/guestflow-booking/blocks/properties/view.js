/**
 * Properties block frontend (build-free, plain ES). Renders cards from the proxy property list, then
 * enriches each card with the "à partir de X €/nuit" teaser from the property detail (cached upstream).
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;

  function bookingLink(base, id) {
    if (!base) return null;
    return base + (base.indexOf('?') === -1 ? '?' : '&') + 'property=' + encodeURIComponent(id);
  }

  function init(container) {
    var columns = parseInt(container.dataset.columns, 10) || 3;
    var bookingPage = container.dataset.bookingPage || '';
    if (!GF.configured) {
      container.innerHTML = '';
      container.appendChild(GF.el('div', { class: 'gf-error' }, GF.t('unavailable')));
      return;
    }
    container.innerHTML = '';
    container.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('loading')));

    GF.api('GET', '/properties').then(function (res) {
      if (res.status < 200 || res.status >= 300 || !res.body || !res.body.data) {
        container.innerHTML = '';
        container.appendChild(GF.el('div', { class: 'gf-error' }, GF.errorMessage(res)));
        return;
      }
      var list = res.body.data;
      container.innerHTML = '';
      if (!list.length) {
        container.appendChild(GF.el('div', { class: 'gf-empty' }, GF.t('noAvailability')));
        return;
      }
      var grid = GF.el('div', { class: 'gf-props' });
      grid.style.setProperty('--gf-cols', columns);
      list.forEach(function (p) {
        var capacity = (p.maxAdults || 0) + (p.maxChildren || 0) + (p.maxBabies || 0);
        var priceEl = GF.el('div', { class: 'gf-prop-price' }, '');
        var link = bookingLink(bookingPage, p.id);
        var card = GF.el('div', { class: 'gf-prop-card' },
          GF.el('div', { class: 'gf-prop-name' }, p.name || ''),
          GF.el('div', { class: 'gf-prop-meta' }, GF.t('capacity') + ' : ' + capacity + ' ' + GF.t('persons')),
          priceEl,
          link ? GF.el('a', { class: 'gf-btn', href: link }, GF.t('bookNow')) : null
        );
        grid.appendChild(card);
        // Enrich with the "from €X/night" teaser from the detail endpoint.
        GF.api('GET', '/properties/' + p.id).then(function (dr) {
          if (dr.status >= 200 && dr.status < 300 && dr.body && dr.body.data && dr.body.data.fromPricePerNight) {
            priceEl.textContent = GF.t('from') + ' ' + GF.euro(dr.body.data.fromPricePerNight) + ' ' + GF.t('perNight');
          }
        });
      });
      container.appendChild(grid);
    });
  }

  document.querySelectorAll('[data-gf-properties]').forEach(init);
})();
