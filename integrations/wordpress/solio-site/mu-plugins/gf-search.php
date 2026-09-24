<?php
/**
 * Plugin Name: Domaine Solio — Stay search bar
 * Description: Global date+adults search banner on every page. Submits to /disponibilites which
 *              lists the lodgings available for those dates. All availability/pricing is computed
 *              server-side by GuestFlow (/quote) and aggregated here (fat backend, thin client).
 */
if (!defined('ABSPATH')) { exit; }

/* Map GuestFlow propertyId -> { WordPress page, photo attachment id }. */
function gf_search_map() {
    return [
        1 => ['page' => 68, 'att' => 109], // Le Gîte du Domaine
        2 => ['page' => 69, 'att' => 110], // Aventura Lodge
    ];
}

function gf_search_results_url() {
    $p = get_page_by_path('disponibilites');
    return $p ? get_permalink($p->ID) : home_url('/disponibilites/');
}

/* ---- REST: server-side availability search across all properties ---- */
add_action('rest_api_init', function () {
    register_rest_route('gf-solio/v1', '/search', [
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => function ($r) {
            $from = sanitize_text_field((string) $r['from']);
            $to   = sanitize_text_field((string) $r['to']);
            $adults = max(1, (int) $r['adults']);
            $re = '/^\d{4}-\d{2}-\d{2}$/';
            if (!preg_match($re, $from) || !preg_match($re, $to) || $to <= $from) {
                return new WP_REST_Response(['error' => 'invalid_dates'], 422);
            }
            $client = class_exists('GF_Api_Client') ? GF_Api_Client::instance() : null;
            if (!$client) { return new WP_REST_Response(['error' => 'no_client'], 502); }

            $map = gf_search_map();
            $list = $client->get('/properties');
            $props = $list['body']['data'] ?? [];
            $nights = (int) round((strtotime($to) - strtotime($from)) / 86400);
            $out = [];

            foreach ($props as $p) {
                $id = (int) $p['id'];
                $m = $map[$id] ?? null;
                $capacityOk = ((int) ($p['maxAdults'] ?? 0)) >= $adults;

                $q = $client->post('/quote', [
                    'propertyId' => $id, 'startDate' => $from, 'endDate' => $to,
                    'adults' => $adults, 'teens' => 0, 'children' => 0, 'babies' => 0,
                    'options' => [], 'resources' => [],
                ]);
                $qb = $q['body']['data'] ?? null;
                $available   = $qb ? (bool) ($qb['available'] ?? false) : false;
                $minBreached = $qb ? (bool) ($qb['minNightsBreached'] ?? false) : false;
                $minNights   = $qb ? (int) ($qb['minNights'] ?? 0) : 0;
                $price       = $qb ? ($qb['totalStayPrice'] ?? $qb['finalPrice'] ?? null) : null;

                $ok = $capacityOk && $available && !$minBreached;
                $reason = !$capacityOk ? 'capacity' : (!$available ? 'unavailable' : ($minBreached ? 'minnights' : ''));

                $photo = $m ? wp_get_attachment_image_url($m['att'], 'large') : null;
                $url = $m ? add_query_arg(['from' => $from, 'to' => $to, 'adults' => $adults], get_permalink($m['page'])) : '#';

                $out[] = [
                    'id' => $id, 'name' => $p['name'], 'maxAdults' => (int) ($p['maxAdults'] ?? 0),
                    'available' => $ok, 'reason' => $reason, 'price' => $price,
                    'minNights' => $minNights, 'nights' => $nights, 'photo' => $photo, 'url' => $url,
                ];
            }
            usort($out, function ($a, $b) { return ($b['available'] ? 1 : 0) - ($a['available'] ? 1 : 0); });
            return new WP_REST_Response(['data' => [
                'from' => $from, 'to' => $to, 'adults' => $adults, 'nights' => $nights, 'properties' => $out,
            ]], 200);
        },
    ]);
});

/* ---- Banner + results containers injected via the_content ---- */
function gf_search_bar_html() {
    $from = isset($_GET['from']) ? esc_attr(sanitize_text_field($_GET['from'])) : '';
    $to   = isset($_GET['to']) ? esc_attr(sanitize_text_field($_GET['to'])) : '';
    $adults = isset($_GET['adults']) ? max(1, (int) $_GET['adults']) : 2;
    $results = esc_url(gf_search_results_url());
    ob_start(); ?>
<div class="gf-searchbar" data-results="<?php echo $results; ?>">
  <form class="gf-sb-inner" onsubmit="return false;">
    <div class="gf-sb-field">
      <label>Arrivée</label>
      <input type="date" class="gf-sb-from" value="<?php echo $from; ?>">
    </div>
    <div class="gf-sb-field">
      <label>Départ</label>
      <input type="date" class="gf-sb-to" value="<?php echo $to; ?>">
    </div>
    <div class="gf-sb-field">
      <label>Adultes</label>
      <div class="gf-sb-step">
        <button type="button" data-d="-1" aria-label="Moins d'adultes">−</button>
        <span class="gf-sb-adults"><?php echo (int) $adults; ?></span>
        <button type="button" data-d="1" aria-label="Plus d'adultes">+</button>
      </div>
    </div>
    <button type="submit" class="gf-sb-go">Voir les logements disponibles</button>
  </form>
</div>
<?php return ob_get_clean();
}

add_filter('the_content', function ($content) {
    static $done = false;
    if ($done || is_admin() || !is_page() || !is_main_query() || !in_the_loop()) { return $content; }
    // Redesign 2026-09: the search bar lives only on the availability page — everywhere
    // else the single call to action is the "Réserver" button.
    if (!is_page('disponibilites')) { return $content; }
    // Hidden on the lodging detail pages (own booking widget) and on Contact.
    $excluded = array_values(array_map(function ($m) { return (int) $m['page']; }, gf_search_map()));
    $contact = get_page_by_path('contact');
    if ($contact) { $excluded[] = (int) $contact->ID; }
    if (in_array((int) get_the_ID(), $excluded, true)) { return $content; }
    $done = true;
    $bar = gf_search_bar_html();
    $tail = '';
    if (is_page('disponibilites')) {
        $tail = '<div class="gf-results-head"></div><div class="gf-results"></div>';
    }
    return $bar . $content . $tail;
}, 20);

/* ---- Assets ---- */
add_action('wp_enqueue_scripts', function () {
    $css = <<<CSS
.gf-searchbar{ background:#2f3a26; padding:14px 16px; margin:0 0 6px; }
.gf-searchbar *, .gf-searchbar *::before, .gf-searchbar *::after{ box-sizing:border-box; }
.gf-sb-inner{ max-width:1000px; margin:0 auto; display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
.gf-sb-field{ display:flex; flex-direction:column; gap:4px; }
.gf-sb-field label{ color:#dfe7d3; font-size:.78rem; font-weight:600; letter-spacing:.02em; }
.gf-sb-field input[type=date]{ border:1px solid #d7dccf; border-radius:8px; padding:9px 10px; font-size:1rem; min-width:150px; background:#fff; color:#2f3a26; }
.gf-sb-step{ display:inline-flex; align-items:center; border:1px solid #d7dccf; border-radius:8px; overflow:hidden; background:#fff; }
.gf-sb-step button{ width:38px; height:40px; border:0; background:#f3f5ef; cursor:pointer; font-size:1.2rem; color:#2f3a26; }
.gf-sb-step span{ min-width:42px; text-align:center; font-weight:700; color:#2f3a26; }
.gf-sb-go{ background:#fff; color:#2f3a26; border:0; border-radius:8px; padding:0 18px; height:40px; font-weight:700; cursor:pointer; }
.gf-sb-go:hover{ background:#eef2e8; }
@media (max-width:600px){
  .gf-sb-inner{ gap:10px; }
  .gf-sb-field{ flex:1 1 100%; min-width:0; }
  .gf-sb-field input[type=date]{ width:100%; min-width:0; max-width:100%; -webkit-appearance:none; appearance:none; }
  .gf-sb-field input[type=date]::-webkit-date-and-time-value{ margin:0; text-align:left; }
  .gf-sb-field input[type=date]::-webkit-datetime-edit{ padding:0; }
  .gf-sb-go{ width:100%; }
}

/* Floating overlay centered in the lower half of the hero image (tablet/desktop only) */
.gf-hero-rel{ position:relative; }
@media (min-width:768px){
  .gf-searchbar.gf-sb-overlay{
    position:absolute; left:50%; top:74%; transform:translate(-50%,-50%);
    width:min(900px,92%); margin:0; padding:18px 22px; border-radius:16px;
    background:rgba(47,58,38,.92); box-shadow:0 16px 46px rgba(0,0,0,.4); z-index:6;
  }
  .gf-searchbar.gf-sb-overlay .gf-sb-inner{ max-width:none; justify-content:center; }
}

.gf-results-head{ max-width:1000px; margin:22px auto 0; padding:0 16px; color:#5a6b48; font-weight:700; text-align:center; }
.gf-results{ max-width:1000px; margin:14px auto 32px; padding:0 16px; display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:20px; }
.gf-results > p{ grid-column:1/-1; text-align:center; color:#2f3a26; }
.gf-rc{ background:#f4f1ea; border-radius:14px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 4px 16px rgba(0,0,0,.06); }
.gf-rc img{ width:100%; height:190px; object-fit:cover; }
.gf-rc-body{ padding:16px; display:flex; flex-direction:column; gap:8px; flex:1; }
.gf-rc-body h3{ margin:0; color:#2f3a26; }
.gf-rc-price{ color:#5a6b48; font-weight:800; font-size:1.15rem; }
.gf-rc-price .gf-rc-meta{ color:#8a8f80; font-weight:500; font-size:.85rem; }
.gf-rc-meta{ color:#8a8f80; font-size:.9rem; }
.gf-rc-btn{ margin-top:auto; background:#5a6b48; color:#fff !important; text-align:center; padding:11px; border-radius:8px; text-decoration:none; font-weight:700; }
.gf-rc-btn:hover,.gf-rc-btn:visited,.gf-rc-btn:focus{ background:#4c5b3d; color:#fff !important; }
.gf-rc.is-off{ opacity:.62; }
.gf-rc-off{ margin-top:auto; background:#cdd3c2; color:#3a4430; text-align:center; padding:11px; border-radius:8px; font-weight:700; }
CSS;
    wp_register_style('gf-search', false);
    wp_enqueue_style('gf-search');
    wp_add_inline_style('gf-search', $css);

    wp_register_script('gf-search', '', [], null, true);
    wp_enqueue_script('gf-search');
    wp_add_inline_script('gf-search', 'window.GF_SEARCH=' . wp_json_encode([
        'rest'    => esc_url_raw(rest_url('gf-solio/v1')),
        'results' => esc_url_raw(gf_search_results_url()),
    ]) . ';', 'before');
    wp_add_inline_script('gf-search', gf_search_js());
});

function gf_search_js() {
    return <<<'JS'
(function(){
  var CFG = window.GF_SEARCH || {};
  var REST = CFG.rest || '/wp-json/gf-solio/v1';
  function euro(n){ return (Math.round((Number(n)||0)*100)/100).toFixed(2).replace('.',',')+' €'; }
  function fdate(s){ var p=(s||'').split('-'); return p.length===3 ? p[2]+'/'+p[1]+'/'+p[0] : s; }

  // --- Float the banner over the hero image (lower half), desktop/tablet only ---
  function placeBanner(){
    var bar = document.querySelector('.gf-searchbar');
    if(!bar) return;
    var content = bar.closest('.entry-content, .wp-block-post-content');
    if(!content) return;
    var hero = content.querySelector(':scope > figure.wp-block-image, :scope > .wp-block-cover');
    var desktop = window.matchMedia('(min-width:768px)').matches;
    if(hero && desktop){
      hero.classList.add('gf-hero-rel');
      if(bar.parentElement !== hero){ hero.appendChild(bar); }
      bar.classList.add('gf-sb-overlay');
    } else if(hero){
      // mobile with a hero: show the bar right BELOW the hero image (never above it)
      bar.classList.remove('gf-sb-overlay');
      hero.classList.remove('gf-hero-rel');
      if(hero.nextElementSibling !== bar){ hero.insertAdjacentElement('afterend', bar); }
    } else {
      bar.classList.remove('gf-sb-overlay');
      if(content.firstElementChild !== bar){ content.insertBefore(bar, content.firstElementChild); }
    }
  }
  placeBanner();
  window.addEventListener('resize', placeBanner);

  // --- Banner behaviour (every page) ---
  document.querySelectorAll('.gf-searchbar').forEach(function(bar){
    var adultsEl = bar.querySelector('.gf-sb-adults');
    bar.querySelectorAll('.gf-sb-step button').forEach(function(b){
      b.addEventListener('click', function(){
        var v = Math.max(1, (parseInt(adultsEl.textContent,10)||1) + parseInt(b.getAttribute('data-d'),10));
        adultsEl.textContent = v;
      });
    });
    bar.querySelector('.gf-sb-go').addEventListener('click', function(){
      var from = bar.querySelector('.gf-sb-from').value;
      var to   = bar.querySelector('.gf-sb-to').value;
      var ad   = parseInt(adultsEl.textContent,10) || 1;
      if(!from || !to){ alert("Choisissez vos dates d'arrivée et de départ."); return; }
      if(to <= from){ alert("La date de départ doit être après l'arrivée."); return; }
      var base = bar.getAttribute('data-results') || CFG.results;
      window.location.href = base + (base.indexOf('?')>-1?'&':'?') + 'from='+from+'&to='+to+'&adults='+ad;
    });
  });

  // --- Results rendering (only on /disponibilites) ---
  var box = document.querySelector('.gf-results');
  if(!box) return;
  var qs = new URLSearchParams(location.search);
  var from = qs.get('from'), to = qs.get('to'), adults = parseInt(qs.get('adults'),10)||2;
  if(!from || !to){
    box.innerHTML = '<p>Choisissez vos dates dans le bandeau ci-dessus pour voir les logements disponibles.</p>';
    return;
  }
  box.innerHTML = '<p>Recherche des disponibilités…</p>';
  fetch(REST + '/search?from='+from+'&to='+to+'&adults='+adults)
    .then(function(r){ return r.json(); })
    .then(function(j){
      var d = j && j.data;
      if(!d){ box.innerHTML = '<p>Une erreur est survenue. Merci de réessayer.</p>'; return; }
      var head = document.querySelector('.gf-results-head');
      if(head){ head.textContent = 'Du '+fdate(from)+' au '+fdate(to)+' · '+d.nights+' nuit'+(d.nights>1?'s':'')+' · '+adults+' adulte'+(adults>1?'s':''); }
      box.innerHTML = '';
      var avail = d.properties.filter(function(p){ return p.available; });
      if(!avail.length){
        var none=document.createElement('p');
        none.textContent="Aucun logement disponible pour ces dates. Essayez d'autres dates.";
        box.appendChild(none);
      }
      d.properties.forEach(function(p){
        var card = document.createElement('div');
        card.className = 'gf-rc' + (p.available?'':' is-off');
        var html = '';
        if(p.photo){ html += '<img src="'+p.photo+'" alt="'+p.name+'">'; }
        html += '<div class="gf-rc-body"><h3>'+p.name+'</h3>';
        if(p.available){
          html += '<div class="gf-rc-price">'+euro(p.price)+' <span class="gf-rc-meta">/ '+p.nights+' nuit'+(p.nights>1?'s':'')+'</span></div>';
          html += '<a class="gf-rc-btn" href="'+p.url+'">Réserver</a>';
        } else {
          var msg = p.reason==='capacity' ? ('Jusqu’à '+p.maxAdults+' adultes')
                  : (p.reason==='minnights' ? ('Séjour minimum : '+p.minNights+' nuits')
                  : 'Complet sur ces dates');
          html += '<div class="gf-rc-meta">'+msg+'</div><div class="gf-rc-off">Indisponible</div>';
        }
        html += '</div>';
        card.innerHTML = html;
        box.appendChild(card);
      });
    })
    .catch(function(){ box.innerHTML = '<p>Erreur de chargement. Merci de réessayer.</p>'; });
})();
JS;
}
