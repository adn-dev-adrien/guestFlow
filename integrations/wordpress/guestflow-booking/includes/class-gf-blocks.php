<?php
/**
 * Block registration (build-free). Registers shared style + the `gf-runtime` script (which carries the
 * localized `window.GFBooking` config: the plugin REST base, the wp_rest nonce, the default property,
 * the booking page URL, and the i18n strings), then per-block editor/view scripts and the three blocks
 * via their block.json. No npm build: every JS file ships as plain ES.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Blocks
{
    private static ?GF_Blocks $instance = null;
    private const BLOCKS = ['calendar', 'booking', 'properties'];

    public static function instance(): GF_Blocks
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function boot(): void
    {
        add_action('init', [$this, 'register']);
    }

    public function register(): void
    {
        $ver = GF_BOOKING_VERSION;

        // Shared style (editor + front).
        wp_register_style('guestflow-style', GF_BOOKING_URL . 'assets/style.css', [], $ver);

        // Runtime holder for the localized config; every block script depends on it.
        wp_register_script('gf-runtime', GF_BOOKING_URL . 'assets/runtime.js', [], $ver, true);
        wp_localize_script('gf-runtime', 'GFBooking', $this->runtime_config());

        foreach (self::BLOCKS as $name) {
            wp_register_script(
                "guestflow-{$name}-editor",
                GF_BOOKING_URL . "blocks/{$name}/editor.js",
                ['wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-i18n', 'gf-runtime'],
                $ver,
                true
            );
            wp_register_script(
                "guestflow-{$name}-view",
                GF_BOOKING_URL . "blocks/{$name}/view.js",
                ['gf-runtime'],
                $ver,
                true
            );
            register_block_type(GF_BOOKING_DIR . "blocks/{$name}");
        }
    }

    private function runtime_config(): array
    {
        $s = GF_Settings::instance();
        return [
            'restUrl'           => esc_url_raw(rest_url('guestflow/v1')),
            'nonce'             => wp_create_nonce('wp_rest'),
            'defaultPropertyId' => (int) $s->get('default_property_id', 0),
            'bookingPageUrl'    => (string) $s->get('booking_page_url', ''),
            'configured'        => $s->is_configured(),
            'i18n'              => [
                'loading'         => __('Chargement…', 'guestflow-booking'),
                'unavailable'     => __('Réservation temporairement indisponible.', 'guestflow-booking'),
                'genericError'    => __('Une erreur est survenue. Réessayez plus tard.', 'guestflow-booking'),
                'noAvailability'  => __('Aucune disponibilité sur cette période.', 'guestflow-booking'),
                'blocked'         => __('Indisponible', 'guestflow-booking'),
                'available'       => __('Disponible', 'guestflow-booking'),
                'nights'          => __('nuit(s)', 'guestflow-booking'),
                'from'            => __('à partir de', 'guestflow-booking'),
                'perNight'        => __('/ nuit', 'guestflow-booking'),
                'adults'          => __('Adultes', 'guestflow-booking'),
                'children'        => __('Enfants', 'guestflow-booking'),
                'teens'           => __('Ados', 'guestflow-booking'),
                'babies'          => __('Bébés', 'guestflow-booking'),
                'startDate'       => __('Arrivée', 'guestflow-booking'),
                'endDate'         => __('Départ', 'guestflow-booking'),
                'options'         => __('Options', 'guestflow-booking'),
                'total'           => __('Total', 'guestflow-booking'),
                'deposit'         => __('Acompte', 'guestflow-booking'),
                'balance'         => __('Solde', 'guestflow-booking'),
                'touristTax'      => __('Taxe de séjour', 'guestflow-booking'),
                'datesUnavailable' => __('Ces dates ne sont plus disponibles.', 'guestflow-booking'),
                'minNights'       => __('Séjour trop court (minimum %d nuits).', 'guestflow-booking'),
                'firstName'       => __('Prénom', 'guestflow-booking'),
                'lastName'        => __('Nom', 'guestflow-booking'),
                'email'           => __('E-mail', 'guestflow-booking'),
                'phone'           => __('Téléphone', 'guestflow-booking'),
                'message'         => __('Message', 'guestflow-booking'),
                'getQuote'        => __('Voir le devis', 'guestflow-booking'),
                'sendRequest'     => __('Envoyer la demande', 'guestflow-booking'),
                'sending'         => __('Envoi…', 'guestflow-booking'),
                'requestSent'     => __('Demande envoyée ! Référence : %s. Nous vous recontactons rapidement.', 'guestflow-booking'),
                'bookNow'         => __('Réserver', 'guestflow-booking'),
                'capacity'        => __('Capacité', 'guestflow-booking'),
                'persons'         => __('personnes', 'guestflow-booking'),
                'requiredFields'  => __('Merci de renseigner tous les champs obligatoires.', 'guestflow-booking'),
                // Online payment flow (specs/public-online-payment.md)
                'payOnline'       => __('Payer en ligne', 'guestflow-booking'),
                'preparingPayment' => __('Préparation du paiement…', 'guestflow-booking'),
                'redirectingPayment' => __('Redirection vers le paiement sécurisé…', 'guestflow-booking'),
                'confirmingPayment' => __('Confirmation de votre paiement en cours…', 'guestflow-booking'),
                'paymentConfirmed' => __('Paiement confirmé — votre réservation est validée !', 'guestflow-booking'),
                'paymentPending'  => __('Paiement en attente. Si vous venez de payer, patientez quelques instants.', 'guestflow-booking'),
                'paymentConflict' => __('Paiement reçu et réservation enregistrée. Nous revenons vers vous très vite pour confirmer les détails.', 'guestflow-booking'),
                'stayRecap'       => __('Votre séjour', 'guestflow-booking'),
                // Online-deposit flow (specs/public-online-deposit.md)
                'payDeposit'      => __('Payer l’acompte', 'guestflow-booking'),
                'depositNow'      => __('Acompte à payer maintenant', 'guestflow-booking'),
                'depositPaid'     => __('Acompte réglé', 'guestflow-booking'),
                'balanceDueBefore' => __('Solde à régler avant le %s', 'guestflow-booking'),
                'balanceEmailFollows' => __('Un email vous sera envoyé pour régler le solde à l’échéance.', 'guestflow-booking'),
            ],
        ];
    }
}
