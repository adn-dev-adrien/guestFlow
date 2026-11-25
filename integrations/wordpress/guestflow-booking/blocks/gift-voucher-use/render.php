<?php
/**
 * Server-rendered container for « Utiliser un bon cadeau », the alias of « Réserver une séance » (specs/site-outside-resource-booking.md rule 18):
 * a page that already holds this block keeps working, and it draws the same tunnel (blocks/session-booking/view.js).
 *
 * @var array    $attributes
 * @var string   $content
 * @var WP_Block $block
 */

if (!defined('ABSPATH')) {
    exit;
}

$wrapper = get_block_wrapper_attributes(['class' => 'gf-block gf-session-block']);
?>
<div <?php echo $wrapper; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?> data-gf-session-booking>
    <div class="gf-loading"><?php echo esc_html__('Chargement…', 'guestflow-booking'); ?></div>
</div>
