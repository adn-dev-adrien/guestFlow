<?php
/**
 * Plugin Name: Domaine Solio — Capacity badge icons
 * Description: Injects coloured room/bed/bathroom pictograms into the .gf-cap badges from JS (robust
 *              against KSES, which strips inline <svg> from post content on save). Bed geometry
 *              mirrors the GuestFlow BedIcon (single = 1 pillow & narrower, double = 2 pillows & wider).
 *              The Gites de France badge shows an ear of wheat — the epi the rating is counted in —
 *              rather than a leaf.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_footer', function () {
    ?>
<script>
(function(){
  var caps = document.querySelectorAll('.gf-cap');
  if(!caps.length) return;
  var C = '#5a6b48';
  function bed(type){
    var single = type === 'single';
    var vbW = single ? 30 : 42;
    var w = Math.round(20 * vbW / 28);
    var pillows = single
      ? '<rect x="9" y="8" width="12" height="6" rx="3"/>'
      : '<rect x="8" y="8" width="12" height="6" rx="3"/><rect x="22" y="8" width="12" height="6" rx="3"/>';
    return '<svg width="'+w+'" height="20" viewBox="0 0 '+vbW+' 28" fill="none" stroke="'+C+'" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">'
      + '<rect x="2.5" y="5" width="'+(vbW-5)+'" height="5" rx="2"/>'
      + pillows
      + '<rect x="2.5" y="13" width="'+(vbW-5)+'" height="9" rx="2"/>'
      + '<path d="M4 22v5M'+(vbW-4)+' 22v5"/></svg>';
  }
  function door(){
    return '<svg width="17" height="20" viewBox="0 0 24 28" fill="none" stroke="'+C+'" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'
      + '<path d="M5 26V3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v23"/><path d="M3 26h18"/>'
      + '<circle cx="15.5" cy="14.5" r="1.2" fill="'+C+'" stroke="none"/></svg>';
  }
  function shower(){
    return '<svg width="19" height="20" viewBox="0 0 24 28" fill="none" stroke="'+C+'" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">'
      + '<path d="M12 3v3"/>'
      + '<path d="M5 11C5 7 9 6 12 6C15 6 19 7 19 11Z"/>'
      + '<path d="M9 14l-1 3.5M12 15l-1 4M15 14l-1 3.5"/></svg>';
  }
  function toilet(){
    return '<svg width="17" height="20" viewBox="0 0 24 28" fill="none" stroke="'+C+'" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">'
      + '<rect x="6" y="3.5" width="12" height="6" rx="1.5"/>'
      + '<path d="M7 11h10v1a5 5 0 0 1-10 0z"/>'
      + '<path d="M9.5 17l-1.5 6.5h8L14.5 17"/></svg>';
  }
  function people(){
    return '<svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="'+C+'" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">'
      + '<circle cx="10.5" cy="9" r="3.4"/>'
      + '<path d="M4 23c0-3.6 2.9-6.5 6.5-6.5S17 19.4 17 23"/>'
      + '<circle cx="19.5" cy="10" r="2.7"/>'
      + '<path d="M18.5 16.6c3.2.3 5.5 3 5.5 6.4"/></svg>';
  }
  function tent(){
    return '<svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="'+C+'" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">'
      + '<path d="M14 4.5L2.5 24h23z"/>'
      + '<path d="M14 24l-3.8-8M14 24l3.8-8"/>'
      + '<path d="M1.5 24h25"/></svg>';
  }
  function epi(){
    // Un grain = une amande : deux courbes symetriques entre le point d'attache et la pointe.
    // Dessiner des formes fines et nettement separees est ce qui empeche l'epi de se refermer
    // en une masse pleine une fois le trait epaissi.
    function grain(ax, ay, tx, ty, bulge){
      var dx = tx - ax, dy = ty - ay, len = Math.sqrt(dx * dx + dy * dy);
      var nx = -dy / len * bulge, ny = dx / len * bulge;
      var mx = (ax + tx) / 2, my = (ay + ty) / 2;
      return '<path d="M' + ax.toFixed(1) + ' ' + ay.toFixed(1)
        + 'Q' + (mx + nx).toFixed(1) + ' ' + (my + ny).toFixed(1) + ' ' + tx.toFixed(1) + ' ' + ty.toFixed(1)
        + 'Q' + (mx - nx).toFixed(1) + ' ' + (my - ny).toFixed(1) + ' ' + ax.toFixed(1) + ' ' + ay.toFixed(1) + 'Z"/>';
    }
    var g = grain(14, 13.2, 14, 5.6, 2.0);                 // le grain de tete
    [[24.2, 6.2, 4.3], [19.2, 5.9, 4.1], [14.4, 5.4, 3.9]].forEach(function(p){
      g += grain(14, p[0], 14 - p[1], p[0] - p[2], 1.8);
      g += grain(14, p[0], 14 + p[1], p[0] - p[2], 1.8);
    });
    return '<svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="' + C
      + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">'
      + '<path d="M14 26.8V13.2"/>' + g + '</svg>';
  }
  caps.forEach(function(cap){
    if(cap.querySelector('svg')) return;
    var t = (cap.textContent || '').toLowerCase();
    var svg = null;
    if(t.indexOf('personne') >= 0) svg = people();
    else if(t.indexOf('glamping') >= 0 || t.indexOf('tente') >= 0) svg = tent();
    else if(t.indexOf('épis') >= 0 || t.indexOf('gîtes de france') >= 0) svg = epi();
    else if(t.indexOf('chambre') >= 0) svg = door();
    else if(t.indexOf('lit simple') >= 0 || t.indexOf('lits simples') >= 0) svg = bed('single');
    else if(t.indexOf('lit double') >= 0 || t.indexOf('lits doubles') >= 0) svg = bed('double');
    else if(t.indexOf('salle') >= 0) svg = shower();          // salle d'eau / salles d'eau
    else if(t.indexOf('toilette') >= 0 || t.indexOf('wc') >= 0) svg = toilet();
    if(svg) cap.insertAdjacentHTML('afterbegin', svg);
  });
})();
</script>
    <?php
});
