<?php
/**
 * Removes the plugin's data when it is deleted from the Plugins screen.
 *
 * @package MinOrderByRole
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids' ) ) as $mobr_site_id ) {
		switch_to_blog( (int) $mobr_site_id );
		delete_option( 'min_order_by_role_minimums' );
		restore_current_blog();
	}
} else {
	delete_option( 'min_order_by_role_minimums' );
}
