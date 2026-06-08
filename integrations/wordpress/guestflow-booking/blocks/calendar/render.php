<?php
/**
 * Server-rendered container for the availability calendar. Outputs only data attributes; the actual
 * grid is hydrated by view.js from the plugin REST proxy (prices/availability must always be live).
 *
 * @var array    $attributes
 * @var string   $content
 * @var WP_Block $block
 */

if (!defined('ABSPATH')) {
    exit;
}

$property_id = (int) ($attributes['propertyId'] ?? 0);
if ($property_id <= 0) {
    $property_id = (int) GF_Settings::instance()->get('default_property_id', 0);
}
$months = max(1, min(3, (int) ($attributes['monthsToShow'] ?? 2)));

$wrapper = get_block_wrapper_attributes(['class' => 'gf-block gf-calendar']);
?>
<div <?php echo $wrapper; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
     data-gf-calendar
     data-property-id="<?php echo esc_attr((string) $property_id); ?>"
     data-months="<?php echo esc_attr((string) $months); ?>">
    <div class="gf-loading"><?php echo esc_html__('Chargement…', 'guestflow-booking'); ?></div>
</div>
