<?php
/**
 * Bootstrap singleton — wires the settings page, the REST proxy, and the blocks.
 * Holds no logic itself; just composes the pieces on the right WordPress hooks.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Plugin
{
    private static ?GF_Plugin $instance = null;

    public static function instance(): GF_Plugin
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct()
    {
        GF_Settings::instance()->boot();
        GF_Rest_Proxy::instance()->boot();
        GF_Blocks::instance()->boot();
    }
}
