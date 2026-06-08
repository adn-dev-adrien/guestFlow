<?php
/**
 * Server-rendered container for the properties list. Cards are hydrated by view.js from the proxy.
 *
 * @var array    $attributes
 * @var string   $content
 * @var WP_Block $block
 */

if (!defined('ABSPATH')) {
    exit;
}

$columns = max(2, min(4, (int) ($attributes['columns'] ?? 3)));
$booking_page = trim((string) ($attributes['bookingPageUrl'] ?? ''));
if ($booking_page === '') {
    $booking_page = (string) GF_Settings::instance()->get('booking_page_url', '');
}

$wrapper = get_block_wrapper_attributes(['class' => 'gf-block gf-properties-block']);
?>
<div <?php echo $wrapper; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
     data-gf-properties
     data-columns="<?php echo esc_attr((string) $columns); ?>"
     data-booking-page="<?php echo esc_url($booking_page); ?>">
    <div class="gf-loading"><?php echo esc_html__('Chargement…', 'guestflow-booking'); ?></div>
</div>
