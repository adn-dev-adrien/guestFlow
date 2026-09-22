<?php
/**
 * Server-side HTTP client to the GuestFlow public API (`/public/v1`). The ONLY place the API key is
 * read and attached (as `Authorization: Bearer`). Relays bytes — it never interprets prices or
 * availability. The key is never logged or returned to the caller.
 *
 * Every method returns ['status' => int, 'body' => array]. Transport failures map to 503/502 with a
 * generic body so nothing leaks to the visitor.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Api_Client
{
    private const TIMEOUT = 8;
    private static ?GF_Api_Client $instance = null;

    public static function instance(): GF_Api_Client
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function get(string $path, array $query = []): array
    {
        return $this->request('GET', $path, ['query' => $query]);
    }

    public function post(string $path, array $body = []): array
    {
        return $this->request('POST', $path, ['body' => $body]);
    }

    /**
     * The visitor's address: REMOTE_ADDR, unless it is one of the trusted reverse proxies — then the
     * right-most X-Forwarded-For entry that is not itself a trusted proxy (the left part of that
     * header is written by the client and cannot be believed).
     */
    public static function visitor_ip(array $trusted): string
    {
        $remote = isset($_SERVER['REMOTE_ADDR']) ? trim((string) $_SERVER['REMOTE_ADDR']) : '';
        if ($remote === '' || !in_array($remote, $trusted, true)) {
            return filter_var($remote, FILTER_VALIDATE_IP) !== false ? $remote : '';
        }
        $forwarded = isset($_SERVER['HTTP_X_FORWARDED_FOR']) ? (string) $_SERVER['HTTP_X_FORWARDED_FOR'] : '';
        $hops = array_reverse(array_map('trim', explode(',', $forwarded)));
        foreach ($hops as $hop) {
            if ($hop === '' || in_array($hop, $trusted, true)) {
                continue;
            }
            return filter_var($hop, FILTER_VALIDATE_IP) !== false ? $hop : '';
        }
        return '';
    }

    private static function visitor_user_agent(): string
    {
        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
        return substr(preg_replace('/[\r\n]+/', ' ', $ua), 0, 512);
    }

    private function request(string $method, string $path, array $opts = []): array
    {
        $settings = GF_Settings::instance();
        $base = $settings->get_base_url();
        $key = $settings->get_api_key();

        if ($base === '' || $key === '') {
            return ['status' => 503, 'body' => ['error' => ['code' => 'NOT_CONFIGURED', 'message' => __('Service de réservation indisponible.', 'guestflow-booking')]]];
        }

        $url = $base . '/public/v1' . $path;
        if (!empty($opts['query'])) {
            $url = add_query_arg(array_map('rawurlencode', $opts['query']), $url);
        }

        $args = [
            'method'    => $method,
            'timeout'   => self::TIMEOUT,
            // Default true (secure). Operators can turn this off for a trusted local/LAN GuestFlow
            // using a self-signed certificate (see GF_Settings::get_ssl_verify).
            'sslverify' => $settings->get_ssl_verify(),
            // The visitor behind this server-to-server call (specs/terms-acceptance-record.md §3.6):
            // GuestFlow records it with a CGV acceptance and counts its rate limits per visitor.
            'headers'   => [
                'Authorization'          => 'Bearer ' . $key,
                'Accept'                 => 'application/json',
                'X-GuestFlow-Plugin'     => GF_BOOKING_VERSION,
                'X-GuestFlow-Visitor-IP' => self::visitor_ip($settings->get_trusted_proxies()),
                'X-GuestFlow-Visitor-UA' => self::visitor_user_agent(),
            ],
        ];
        if (isset($opts['body'])) {
            $args['headers']['Content-Type'] = 'application/json';
            $args['body'] = wp_json_encode($opts['body']);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            // Transport error (DNS, timeout, refused). Do NOT include the WP_Error message verbatim.
            return ['status' => 502, 'body' => ['error' => ['code' => 'UPSTREAM_UNREACHABLE', 'message' => __('Service de réservation momentanément indisponible.', 'guestflow-booking')]]];
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        $raw = wp_remote_retrieve_body($response);
        $body = json_decode($raw, true);
        if (!is_array($body)) {
            $body = ['error' => ['code' => 'BAD_UPSTREAM_RESPONSE', 'message' => __('Réponse inattendue du service.', 'guestflow-booking')]];
        }

        return ['status' => $status, 'body' => $body];
    }
}
