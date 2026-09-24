<?php
/**
 * Plugin Name: GuestFlow — Relative upload URLs
 * Description: Make media (uploads) URLs host-relative so image URLs cached/stored by
 *   plugins (Google Reviews avatars written from cron, MetaSlider slides, etc.) resolve
 *   on whatever host the site is viewed from — LAN IP, public IP, or a future domain —
 *   instead of a hardcoded internal address unreachable off-LAN.
 */
if ( ! defined( "ABSPATH" ) ) { exit; }
add_filter( "upload_dir", function ( $dirs ) {
    foreach ( array( "url", "baseurl" ) as $k ) {
        if ( ! empty( $dirs[ $k ] ) ) {
            $dirs[ $k ] = preg_replace( "#^https?://[^/]+#", "", $dirs[ $k ] );
        }
    }
    return $dirs;
}, 20 );
