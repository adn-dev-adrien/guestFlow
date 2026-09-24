<?php
/**
 * Plugin Name: Domaine Solio — Sticky header
 * Description: Keeps the site banner / burger menu pinned at the top while scrolling. The sticky must
 *              live on the template-part WRAPPER (its inner .gf-header was sticky within a too-short
 *              parent, so it never pinned). On scroll the translucent hero gradient swaps to a solid
 *              brand background so the white nav stays readable over page content. The reservation
 *              popup (.gf-modal, z-index 99999) sits above the header (z-index 1000), so it naturally
 *              covers it.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_enqueue_scripts', function () {
    $css = <<<CSS
.wp-site-blocks > header.wp-block-template-part{ position:sticky; top:0; z-index:1000; }
.wp-site-blocks > header.wp-block-template-part.gf-stuck .gf-header{
  background:rgba(26,34,22,.97);
  box-shadow:0 2px 14px rgba(0,0,0,.20);
  transition:background .25s ease, box-shadow .25s ease;
}
CSS;
    wp_register_style('gf-sticky-header', false);
    wp_enqueue_style('gf-sticky-header');
    wp_add_inline_style('gf-sticky-header', $css);
});

add_action('wp_footer', function () {
    ?>
<script>
(function(){
  var wrap = document.querySelector('.wp-site-blocks > header.wp-block-template-part');
  if(!wrap) return;
  function upd(){ wrap.classList.toggle('gf-stuck', window.scrollY > 24); }
  upd();
  window.addEventListener('scroll', upd, { passive:true });
})();
</script>
    <?php
});