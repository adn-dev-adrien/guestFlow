<?php
/**
 * Server-rendered container for « Utiliser un bon cadeau » (specs/gift-voucher-campaigns.md rule 23).
 * Everything else — the code field, the contents of the voucher, the slots, the recap, the confirmation —
 * is drawn by view.js from the plugin's REST proxy; this file only provides the mount point.
 *
 * @var array    $attributes
 * @var string   $content
 * @var WP_Block $block
 */

if (!defined('ABSPATH')) {
    exit;
}

$wrapper = get_block_wrapper_attributes(['class' => 'gf-block gf-gift-voucher-block gf-gift-voucher-use-block']);
?>
<div <?php echo $wrapper; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?> data-gf-gift-voucher-use>
    <div class="gf-loading"><?php echo esc_html__('Chargement…', 'guestflow-booking'); ?></div>
</div>
