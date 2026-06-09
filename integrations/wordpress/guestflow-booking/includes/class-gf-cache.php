<?php
/**
 * Transient cache for the read proxy routes (specs/wordpress-plugin.md §3 rule 5). Keyed by
 * path + query so concurrent block instances on a page share one upstream call within the TTL.
 * Also keeps a copy with no expiry for the stale-while-error grace window (Q3).
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Cache
{
    private const PREFIX = 'gf_cache_';
    private const STALE_PREFIX = 'gf_stale_';
    private const STALE_TTL = HOUR_IN_SECONDS; // bounded grace window for stale-while-error

    public static function key(string $path, array $query = []): string
    {
        ksort($query);
        return self::PREFIX . md5($path . '?' . http_build_query($query));
    }

    /** Fresh cached value, or false on miss. */
    public static function get(string $key)
    {
        return get_transient($key);
    }

    public static function set(string $key, $value, int $ttl): void
    {
        if ($ttl > 0) {
            set_transient($key, $value, $ttl);
        }
        // Mirror to a longer-lived stale copy used only if the upstream later fails.
        set_transient(self::stale_key($key), $value, self::STALE_TTL);
    }

    /** Last known value within the stale grace window, or false. */
    public static function get_stale(string $key)
    {
        return get_transient(self::stale_key($key));
    }

    private static function stale_key(string $key): string
    {
        return self::STALE_PREFIX . substr($key, strlen(self::PREFIX));
    }
}
