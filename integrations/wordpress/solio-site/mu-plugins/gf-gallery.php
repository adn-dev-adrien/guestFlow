<?php
/**
 * Plugin Name: Domaine Solio — Photo grid + fullscreen lightbox
 * Description: Responsive photo grid (.gf-photos). Click a photo → fullscreen carousel/lightbox
 *              (arrows, dots/counter, keyboard, swipe). Drop-in mu-plugin.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_enqueue_scripts', function () {
    $css = <<<CSS
.gf-caps{ display:flex; flex-wrap:wrap; justify-content:center; align-items:flex-start; gap:26px 36px; max-width:980px; margin:26px auto 0; }
.gf-cap{ display:flex; flex-direction:column; align-items:center; gap:9px; color:#2f3a26; font-weight:500;
  font-size:.82rem; line-height:1.3; text-align:center; max-width:130px; }
.gf-cap svg{ flex:0 0 auto; width:44px; height:44px; stroke-width:1.3; }
@media (max-width:600px){ .gf-caps{ gap:18px 24px; } .gf-cap svg{ width:38px; height:38px; } .gf-cap{ font-size:.78rem; max-width:104px; } }
.gf-photos{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; max-width:1040px; margin:0 auto; }
.gf-photos button{ padding:0; margin:0; border:0; background:none; cursor:pointer; border-radius:12px; overflow:hidden; line-height:0; }
.gf-photos img{ width:100%; height:210px; object-fit:cover; display:block; transition:transform .35s ease; }
.gf-photos button:hover img{ transform:scale(1.06); }
@media (max-width:600px){ .gf-photos{ grid-template-columns:repeat(2,1fr); gap:8px; } .gf-photos img{ height:140px; } }

.gf-lb{ position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.93); display:none; align-items:center; justify-content:center; }
.gf-lb.is-open{ display:flex; }
.gf-lb img{ max-width:92vw; max-height:84vh; object-fit:contain; border-radius:6px; }
.gf-lb-close{ position:absolute; top:14px; right:20px; background:none; border:0; color:#fff; font-size:2.6rem; line-height:1; cursor:pointer; }
.gf-lb-prev,.gf-lb-next{ position:absolute; top:50%; transform:translateY(-50%); display:flex; align-items:center; justify-content:center;
  width:56px; height:56px; border:0; border-radius:50%; background:rgba(255,255,255,.14); color:#fff; font-size:2.2rem; cursor:pointer; }
.gf-lb-prev{ left:16px; } .gf-lb-next{ right:16px; }
.gf-lb-prev:hover,.gf-lb-next:hover{ background:rgba(255,255,255,.28); }
.gf-lb-counter{ position:absolute; bottom:18px; left:0; right:0; text-align:center; color:#fff; font-size:.95rem; letter-spacing:.5px; }
@media (max-width:600px){ .gf-lb-prev,.gf-lb-next{ width:46px; height:46px; font-size:1.8rem; } }
CSS;
    wp_register_style('gf-gallery', false);
    wp_enqueue_style('gf-gallery');
    wp_add_inline_style('gf-gallery', $css);
});

add_action('wp_footer', function () {
    ?>
<script>
(function(){
  var groups = document.querySelectorAll('[data-gf-photos]');
  if (!groups.length) return;

  // One shared lightbox for the whole page.
  var lb = document.createElement('div');
  lb.className = 'gf-lb';
  lb.innerHTML = '<button class="gf-lb-close" aria-label="Fermer">&times;</button>'
    + '<button class="gf-lb-prev" aria-label="Précédent">&#8249;</button>'
    + '<img alt="" />'
    + '<button class="gf-lb-next" aria-label="Suivant">&#8250;</button>'
    + '<div class="gf-lb-counter"></div>';
  document.body.appendChild(lb);
  var lbImg = lb.querySelector('img');
  var counter = lb.querySelector('.gf-lb-counter');
  var photos = [], idx = 0;

  function render(){ lbImg.src = photos[idx]; counter.textContent = (idx+1) + ' / ' + photos.length; }
  function openAt(list, i){ photos = list; idx = ((i%list.length)+list.length)%list.length; render(); lb.classList.add('is-open'); document.body.style.overflow='hidden'; }
  function close(){ lb.classList.remove('is-open'); document.body.style.overflow=''; }
  function go(d){ idx = ((idx+d)%photos.length+photos.length)%photos.length; render(); }

  groups.forEach(function(g){
    var btns = g.querySelectorAll('button[data-i]');
    var list = [...g.querySelectorAll('img')].map(function(im){ return im.getAttribute('data-full') || im.src; });
    btns.forEach(function(b){ b.addEventListener('click', function(){ openAt(list, parseInt(b.dataset.i,10)||0); }); });
  });

  lb.querySelector('.gf-lb-close').addEventListener('click', close);
  lb.querySelector('.gf-lb-prev').addEventListener('click', function(e){ e.stopPropagation(); go(-1); });
  lb.querySelector('.gf-lb-next').addEventListener('click', function(e){ e.stopPropagation(); go(1); });
  lb.addEventListener('click', function(e){ if (e.target === lb) close(); });
  document.addEventListener('keydown', function(e){ if(!lb.classList.contains('is-open')) return;
    if(e.key==='Escape') close(); else if(e.key==='ArrowLeft') go(-1); else if(e.key==='ArrowRight') go(1); });
  var x0=null;
  lb.addEventListener('touchstart', function(e){ x0=e.touches[0].clientX; }, {passive:true});
  lb.addEventListener('touchend', function(e){ if(x0===null) return; var dx=e.changedTouches[0].clientX-x0; if(Math.abs(dx)>40) go(dx<0?1:-1); x0=null; });
})();
</script>
    <?php
});
