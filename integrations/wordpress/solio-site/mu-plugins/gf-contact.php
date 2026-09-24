<?php
/**
 * Plugin Name: Domaine Solio — Contact page (map + cards)
 * Description: Styles the Contact / localisation page, injects a keyless Google Maps embed showing the
 *              "Domaine Solio" listing (name + rating), and wires the action cards: Adresse → directions
 *              to the Domaine's EXACT coordinates in the default nav app (Apple Plans / Google Maps),
 *              Téléphone → default phone app (tel:), E-mail → default mail app (mailto:). Dynamic markup
 *              is injected from JS so KSES can't strip it.
 */
if (!defined('ABSPATH')) { exit; }

// Exact arrival point of the Domaine (drives the DIRECTIONS — the postal address geocodes to the road).
if (!defined('GF_SOLIO_LATLNG')) define('GF_SOLIO_LATLNG', '45.1615892,4.6299588');
// Map display query — the verified Google listing, so the marker keeps the "Domaine Solio" name + rating.
if (!defined('GF_SOLIO_PLACE')) define('GF_SOLIO_PLACE', 'Domaine Solio, 215 côte de Japperenard, 07290 Satillieu');

add_action('wp_enqueue_scripts', function () {
    $css = <<<CSS
.gf-contact{ max-width:1040px; margin:0 auto; padding:34px 20px 58px; }
.gf-contact-intro{ text-align:center; margin-bottom:28px; }
.gf-contact-intro h1{ color:#2f3a26; margin:0 0 8px; }
.gf-contact-intro p{ color:#5a6b48; font-size:1.08rem; margin:0; }
.gf-contact-map{ width:100%; aspect-ratio:16/9; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(0,0,0,.12); background:#e8ece2; }
.gf-contact-map iframe{ width:100%; height:100%; border:0; display:block; }
.gf-contact-cards{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:28px; }
.gf-contact-card{ background:#eef2e8; border-radius:14px; padding:22px 16px; text-align:center; }
.gf-contact-card .gf-ci-ic{ font-size:1.7rem; display:block; margin-bottom:8px; }
.gf-contact-card h3{ margin:0 0 6px; font-size:.85rem; letter-spacing:.6px; text-transform:uppercase; color:#5a6b48; }
.gf-contact-card p{ margin:0; color:#2f3a26; font-weight:600; line-height:1.45; }
.gf-clickcard{ display:block; text-decoration:none; color:inherit; cursor:pointer; transition:transform .15s ease, box-shadow .15s ease; }
.gf-clickcard:hover{ transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,.10); }
.gf-route-cta{ display:inline-block; margin-top:10px; color:#5a6b48; font-weight:700; font-size:.9rem; }
@media (max-width:900px){ .gf-contact-cards{ grid-template-columns:repeat(2,1fr); } }
@media (max-width:520px){ .gf-contact-cards{ grid-template-columns:1fr; } .gf-contact-map{ aspect-ratio:4/3; } }
CSS;
    wp_register_style('gf-contact', false);
    wp_enqueue_style('gf-contact');
    wp_add_inline_style('gf-contact', $css);
});

add_action('wp_footer', function () {
    ?>
<script>
(function(){
  var LATLNG = <?php echo wp_json_encode(GF_SOLIO_LATLNG); ?>;
  var PLACE  = <?php echo wp_json_encode(GF_SOLIO_PLACE); ?>;

  // 1) Embedded map — keep the "Domaine Solio" named/rated listing.
  document.querySelectorAll('.gf-contact-map').forEach(function(el){
    if(el.querySelector('iframe')) return;
    var ifr = document.createElement('iframe');
    ifr.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(PLACE) + '&z=15&hl=fr&t=h&output=embed';
    ifr.loading = 'lazy';
    ifr.title = 'Carte — Domaine Solio';
    ifr.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    ifr.setAttribute('allowfullscreen', '');
    el.appendChild(ifr);
  });

  // 2) Address card → directions to the EXACT coordinates in the default navigation app.
  var routes = document.querySelectorAll('.gf-route');
  if(routes.length){
    var dest = encodeURIComponent(LATLNG || PLACE);
    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var url = isIOS
      ? 'https://maps.apple.com/?daddr=' + dest + '&dirflg=d'
      : 'https://www.google.com/maps/dir/?api=1&destination=' + dest;
    routes.forEach(function(a){ a.setAttribute('href', url); });
  }
})();
</script>
    <?php
});