<?php
/**
 * Plugin Name:          Minimum Order by Role
 * Plugin URI:           https://woocommerce.com/products/min-order-by-role/
 * Description:          Sets a minimum order amount for each customer role, with a cart notice and checkout validation.
 * Version:              1.0.0
 * Author:               Product Planner Bench
 * Author URI:           https://example.com/
 * Text Domain:          min-order-by-role
 * Requires at least:    6.5
 * Requires PHP:         7.4
 * Requires Plugins:     woocommerce
 * WC requires at least: 8.0
 * WC tested up to:      10.2
 * License:              GPL-3.0-or-later
 * License URI:          https://www.gnu.org/licenses/gpl-3.0.html
 *
 * @package MinOrderByRole
 */

defined( 'ABSPATH' ) || exit;

define( 'MOBR_VERSION', '1.0.0' );
define( 'MOBR_PLUGIN_FILE', __FILE__ );

require_once __DIR__ . '/includes/class-mobr-rules.php';
require_once __DIR__ . '/includes/class-mobr-cart-validator.php';

add_action( 'before_woocommerce_init', 'mobr_declare_wc_compatibility' );
add_action( 'init', 'mobr_load_textdomain' );
add_action( 'plugins_loaded', 'mobr_init' );

/**
 * Declares compatibility with WooCommerce features.
 *
 * The plugin never touches order storage, so it is compatible with HPOS. It hooks the
 * classic (shortcode) cart and checkout, so it declares itself incompatible with the
 * Cart and Checkout blocks.
 *
 * @return void
 */
function mobr_declare_wc_compatibility() {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', MOBR_PLUGIN_FILE, true );
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', MOBR_PLUGIN_FILE, false );
	}
}

/**
 * Loads translations shipped with the plugin.
 *
 * @return void
 */
function mobr_load_textdomain() {
	load_plugin_textdomain( 'min-order-by-role', false, dirname( plugin_basename( MOBR_PLUGIN_FILE ) ) . '/languages' );
}

/**
 * Registers the plugin's hooks once WooCommerce is available.
 *
 * @return void
 */
function mobr_init() {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', 'mobr_missing_woocommerce_notice' );
		return;
	}

	MOBR_Cart_Validator::register();
	add_filter( 'woocommerce_get_settings_pages', 'mobr_add_settings_page' );
}

/**
 * Adds the "Minimum order" tab to WooCommerce > Settings.
 *
 * @param array<int, WC_Settings_Page> $pages Settings pages.
 * @return array<int, WC_Settings_Page>
 */
function mobr_add_settings_page( $pages ) {
	require_once __DIR__ . '/includes/class-mobr-settings-page.php';
	$pages[] = new MOBR_Settings_Page();
	return $pages;
}

/**
 * Shows an admin notice when WooCommerce is not active.
 *
 * @return void
 */
function mobr_missing_woocommerce_notice() {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	echo '<div class="notice notice-error"><p>' . esc_html__( 'Minimum Order by Role requires WooCommerce to be installed and active.', 'min-order-by-role' ) . '</p></div>';
}
