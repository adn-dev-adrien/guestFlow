<?php
/**
 * Server-rendered container for « Réserver une séance » (specs/site-outside-resource-booking.md rule 1).
 * Everything else — the activity, the code of a gift voucher, the duration, the date, the slots, the recap,
 * the contact and the payment — is drawn by view.js from the plugin's REST proxy; this file only provides the mount point.
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
