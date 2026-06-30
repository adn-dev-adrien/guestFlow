<?php
/**
 * Server-rendered container for the booking wizard. The property can be preselected via the block
 * attribute, the `?property=ID` query param (Q4 — the properties block links here), or the default.
 *
 * @var array    $attributes
 * @var string   $content
 * @var WP_Block $block
 */

if (!defined('ABSPATH')) {
    exit;
}

$property_id = (int) ($attributes['propertyId'] ?? 0);
if ($property_id <= 0 && isset($_GET['property'])) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
    $property_id = (int) $_GET['property']; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
}
if ($property_id <= 0) {
    $property_id = (int) GF_Settings::instance()->get('default_property_id', 0);
}
$show_options = !isset($attributes['showOptions']) || (bool) $attributes['showOptions'];
$pay_online = !empty($attributes['payOnline']);

$wrapper = get_block_wrapper_attributes(['class' => 'gf-block gf-booking-block']);
?>
<div <?php echo $wrapper; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
     data-gf-booking
     data-property-id="<?php echo esc_attr((string) $property_id); ?>"
     data-show-options="<?php echo $show_options ? '1' : '0'; ?>"
     data-pay-online="<?php echo $pay_online ? '1' : '0'; ?>">
    <div class="gf-loading"><?php echo esc_html__('Chargement…', 'guestflow-booking'); ?></div>
</div>
