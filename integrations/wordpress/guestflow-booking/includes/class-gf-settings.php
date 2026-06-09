<?php
/**
 * Settings (Réglages → GuestFlow) + option storage. Holds the GuestFlow API base URL, the API key
 * (masked; a wp-config constant takes precedence), cache TTLs, the default property, and the booking
 * page URL. The API key is read ONLY here / by the API client — never enqueued to the browser.
 *
 * Q1: if GUESTFLOW_API_KEY is defined in wp-config.php it wins and the option field is disabled.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Settings
{
    private static ?GF_Settings $instance = null;

    public static function instance(): GF_Settings
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function boot(): void
    {
        add_action('admin_menu', [$this, 'add_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_ajax_gf_test_connection', [$this, 'ajax_test_connection']);
    }

    public function defaults(): array
    {
        return [
            'api_base_url'           => '',
            'api_key'                => '',
            'cache_ttl'              => 600,
            'availability_cache_ttl' => 300,
            'default_property_id'    => 0,
            'booking_page_url'       => '',
        ];
    }

    public function all(): array
    {
        $stored = get_option(GF_BOOKING_OPTION, []);
        return wp_parse_args(is_array($stored) ? $stored : [], $this->defaults());
    }

    public function get(string $key, $fallback = null)
    {
        $all = $this->all();
        return array_key_exists($key, $all) ? $all[$key] : $fallback;
    }

    public function get_base_url(): string
    {
        return untrailingslashit(trim((string) $this->get('api_base_url', '')));
    }

    /** wp-config constant wins (Q1); otherwise the stored option. */
    public function get_api_key(): string
    {
        if (defined('GUESTFLOW_API_KEY') && trim((string) GUESTFLOW_API_KEY) !== '') {
            return trim((string) GUESTFLOW_API_KEY);
        }
        return trim((string) $this->get('api_key', ''));
    }

    public function key_from_constant(): bool
    {
        return defined('GUESTFLOW_API_KEY') && trim((string) GUESTFLOW_API_KEY) !== '';
    }

    public function is_configured(): bool
    {
        return $this->get_base_url() !== '' && $this->get_api_key() !== '';
    }

    // ----- admin UI -----

    public function add_menu(): void
    {
        add_options_page(
            __('GuestFlow Booking', 'guestflow-booking'),
            __('GuestFlow', 'guestflow-booking'),
            'manage_options',
            'guestflow-booking',
            [$this, 'render_page']
        );
    }

    public function register_settings(): void
    {
        register_setting('gf_booking', GF_BOOKING_OPTION, [
            'type'              => 'array',
            'sanitize_callback' => [$this, 'sanitize'],
            'default'           => $this->defaults(),
        ]);
    }

    public function sanitize($input): array
    {
        $input = is_array($input) ? $input : [];
        $current = $this->all();
        $out = $this->defaults();

        $out['api_base_url']           = esc_url_raw(trim((string) ($input['api_base_url'] ?? '')));
        $out['cache_ttl']              = max(0, (int) ($input['cache_ttl'] ?? 600));
        $out['availability_cache_ttl'] = max(0, (int) ($input['availability_cache_ttl'] ?? 300));
        $out['default_property_id']    = max(0, (int) ($input['default_property_id'] ?? 0));
        $out['booking_page_url']       = esc_url_raw(trim((string) ($input['booking_page_url'] ?? '')));

        // Key field: empty submission keeps the existing key (the field is masked); a non-empty
        // value replaces it. When the constant is set, the option key is irrelevant.
        $submitted_key = trim((string) ($input['api_key'] ?? ''));
        $out['api_key'] = $submitted_key !== '' ? $submitted_key : (string) ($current['api_key'] ?? '');

        // Settings changed → drop cached responses so the new config takes effect immediately.
        $this->flush_cache();

        return $out;
    }

    private function flush_cache(): void
    {
        global $wpdb;
        $like = $wpdb->esc_like('_transient_gf_cache_') . '%';
        $like_to = $wpdb->esc_like('_transient_timeout_gf_cache_') . '%';
        $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $like, $like_to));
    }

    public function render_page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $o = $this->all();
        $constant = $this->key_from_constant();
        $has_key = $this->get_api_key() !== '';
        ?>
        <div class="wrap">
            <h1><?php echo esc_html__('GuestFlow Booking', 'guestflow-booking'); ?></h1>

            <?php if (!$this->is_configured()) : ?>
                <div class="notice notice-warning"><p>
                    <?php echo esc_html__("Configuration incomplète : renseignez l'URL de l'API et la clé pour activer les blocs.", 'guestflow-booking'); ?>
                </p></div>
            <?php endif; ?>

            <form action="options.php" method="post">
                <?php settings_fields('gf_booking'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="gf_api_base_url"><?php echo esc_html__("URL de l'API GuestFlow", 'guestflow-booking'); ?></label></th>
                        <td>
                            <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[api_base_url]" id="gf_api_base_url" type="url"
                                   class="regular-text" placeholder="https://guestflow.exemple.com"
                                   value="<?php echo esc_attr($o['api_base_url']); ?>" />
                            <p class="description"><?php echo esc_html__("Base du serveur GuestFlow, sans /public/v1.", 'guestflow-booking'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_api_key"><?php echo esc_html__("Clé d'API", 'guestflow-booking'); ?></label></th>
                        <td>
                            <?php if ($constant) : ?>
                                <input type="password" class="regular-text" value="********" disabled />
                                <p class="description"><?php echo esc_html__("Définie via la constante GUESTFLOW_API_KEY dans wp-config.php (prioritaire).", 'guestflow-booking'); ?></p>
                            <?php else : ?>
                                <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[api_key]" id="gf_api_key" type="password"
                                       class="regular-text" autocomplete="off"
                                       placeholder="<?php echo $has_key ? esc_attr('••••••••  (' . esc_html__('inchangée', 'guestflow-booking') . ')') : ''; ?>" />
                                <p class="description"><?php echo esc_html__("Collez la clé PUBLIC_API_KEY de GuestFlow (server/.env.local). Laissez vide pour conserver l'actuelle.", 'guestflow-booking'); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_default_property"><?php echo esc_html__('Logement par défaut (ID)', 'guestflow-booking'); ?></label></th>
                        <td><input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[default_property_id]" id="gf_default_property" type="number" min="0" value="<?php echo esc_attr((string) $o['default_property_id']); ?>" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_booking_page"><?php echo esc_html__('Page de réservation', 'guestflow-booking'); ?></label></th>
                        <td>
                            <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[booking_page_url]" id="gf_booking_page" type="url" class="regular-text"
                                   value="<?php echo esc_attr($o['booking_page_url']); ?>" placeholder="https://exemple.com/reserver" />
                            <p class="description"><?php echo esc_html__("Les cartes de logements pointent vers cette page avec ?property=ID.", 'guestflow-booking'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_cache_ttl"><?php echo esc_html__('Cache lecture (s)', 'guestflow-booking'); ?></label></th>
                        <td><input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[cache_ttl]" id="gf_cache_ttl" type="number" min="0" value="<?php echo esc_attr((string) $o['cache_ttl']); ?>" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_avail_ttl"><?php echo esc_html__('Cache disponibilités (s)', 'guestflow-booking'); ?></label></th>
                        <td><input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[availability_cache_ttl]" id="gf_avail_ttl" type="number" min="0" value="<?php echo esc_attr((string) $o['availability_cache_ttl']); ?>" /></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>

            <hr />
            <h2><?php echo esc_html__('Test de connexion', 'guestflow-booking'); ?></h2>
            <p>
                <button type="button" class="button" id="gf-test-connection"><?php echo esc_html__('Tester la connexion', 'guestflow-booking'); ?></button>
                <span id="gf-test-result" style="margin-left:8px;"></span>
            </p>
            <script>
            (function () {
                var btn = document.getElementById('gf-test-connection');
                var out = document.getElementById('gf-test-result');
                if (!btn) return;
                btn.addEventListener('click', function () {
                    out.textContent = <?php echo wp_json_encode(__('Test en cours…', 'guestflow-booking')); ?>;
                    var body = new FormData();
                    body.append('action', 'gf_test_connection');
                    body.append('_ajax_nonce', <?php echo wp_json_encode(wp_create_nonce('gf_test_connection')); ?>);
                    fetch(<?php echo wp_json_encode(admin_url('admin-ajax.php')); ?>, { method: 'POST', credentials: 'same-origin', body: body })
                        .then(function (r) { return r.json(); })
                        .then(function (j) { out.textContent = (j && j.data && j.data.message) ? j.data.message : '?'; })
                        .catch(function () { out.textContent = <?php echo wp_json_encode(__('Échec du test.', 'guestflow-booking')); ?>; });
                });
            })();
            </script>
        </div>
        <?php
    }

    public function ajax_test_connection(): void
    {
        check_ajax_referer('gf_test_connection');
        if (!current_user_can('manage_options')) {
            wp_send_json_error(['message' => __('Non autorisé.', 'guestflow-booking')], 403);
        }
        if (!$this->is_configured()) {
            wp_send_json_error(['message' => __("Clé ou URL d'API non configurée.", 'guestflow-booking')]);
        }
        $res = GF_Api_Client::instance()->get('/properties');
        if ($res['status'] >= 200 && $res['status'] < 300) {
            $count = is_array($res['body']['data'] ?? null) ? count($res['body']['data']) : 0;
            wp_send_json_success(['message' => sprintf(
                /* translators: %d: number of properties */
                __('Connexion réussie — %d logement(s).', 'guestflow-booking'),
                $count
            )]);
        }
        if ($res['status'] === 401) {
            wp_send_json_error(['message' => __("Échec d'authentification : clé invalide.", 'guestflow-booking')]);
        }
        wp_send_json_error(['message' => sprintf(
            /* translators: %d: HTTP status code */
            __('Serveur injoignable ou erreur (code %d).', 'guestflow-booking'),
            (int) $res['status']
        )]);
    }
}
