<?php
/**
 * Plugin Name: Domaine Solio — Lodging cards UX
 * Description: Adds a hover lift + whole-surface click to the home-page lodging cards
 *              (.gf-lodging gf-lodging-<pageId>). The actual link ALSO lives natively on the
 *              card image and title (custom link), so navigation survives even without this JS.
 *              No forced image size: the photo is a standard, freely editable Image block.
 */
if (!defined("ABSPATH")) { exit; }

add_action("wp_enqueue_scripts", function () {
    $css = <<<CSS
.gf-lodging{ cursor:pointer; transition:transform .15s ease, box-shadow .15s ease; }
.gf-lodging:hover{ transform:translateY(-3px); box-shadow:0 10px 26px rgba(0,0,0,.12); }
.gf-lodging:focus-visible{ outline:2px solid #5a6b48; outline-offset:3px; }
.gf-lodging a{ text-decoration:none; color:inherit; }
CSS;
    wp_register_style("gf-lodging-cards", false);
    wp_enqueue_style("gf-lodging-cards");
    wp_add_inline_style("gf-lodging-cards", $css);
});

add_action("wp_footer", function () {
    ?>
<script>
(function(){
  document.querySelectorAll(".gf-lodging").forEach(function(card){
    var m = (card.className || "").match(/gf-lodging-(\d+)/);
    if(!m) return;
    var url = "/?page_id=" + m[1];
    card.setAttribute("role","link");
    card.setAttribute("tabindex","0");
    // Whole-card click is a bonus; real <a> links on the image/title still work on their own.
    card.addEventListener("click", function(e){ if(e.target.closest("a")) return; window.location.href = url; });
    card.addEventListener("keydown", function(e){ if(e.key==="Enter" || e.key===" "){ e.preventDefault(); window.location.href = url; } });
  });
})();
</script>
    <?php
});
