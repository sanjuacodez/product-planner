<?php
/**
 * Cart notice and checkout validation.
 *
 * @package MinOrderByRole
 */

defined( 'ABSPATH' ) || exit;

/**
 * Compares the cart subtotal with the customer's minimum.
 */
class MOBR_Cart_Validator {

	/**
	 * Hooks into the classic cart and checkout.
	 *
	 * @return void
	 */
	public static function register() {
		// Priority 5 runs before WooCommerce prints notices on woocommerce_before_cart (priority 10).
		add_action( 'woocommerce_before_cart', array( __CLASS__, 'add_cart_notice' ), 5 );
		add_action( 'woocommerce_checkout_process', array( __CLASS__, 'validate_checkout' ) );
	}

	/**
	 * Builds the shortfall message for the current customer and cart.
	 *
	 * @return string Message, or an empty string when the cart meets the minimum.
	 */
	public static function get_shortfall_message() {
		$cart = WC()->cart;
		if ( ! $cart instanceof WC_Cart || $cart->is_empty() ) {
			return '';
		}

		$minimum = MOBR_Rules::get_minimum_for_user( wp_get_current_user() );
		if ( $minimum <= 0 ) {
			return '';
		}

		$decimals = wc_get_price_decimals();
		$subtotal = (float) $cart->get_subtotal();
		if ( round( $subtotal, $decimals ) >= round( $minimum, $decimals ) ) {
			return '';
		}

		return sprintf(
			/* translators: 1: minimum order amount, 2: current cart subtotal. Both are formatted prices. */
			__( 'A minimum order of %1$s is required. Your current subtotal is %2$s.', 'min-order-by-role' ),
			wc_price( $minimum ),
			wc_price( $subtotal )
		);
	}

	/**
	 * Shows the notice on the cart page.
	 *
	 * @return void
	 */
	public static function add_cart_notice() {
		$message = self::get_shortfall_message();
		if ( '' !== $message && ! wc_has_notice( $message, 'notice' ) ) {
			wc_add_notice( $message, 'notice' );
		}
	}

	/**
	 * Blocks the classic checkout while the cart is below the minimum.
	 *
	 * @return void
	 */
	public static function validate_checkout() {
		$message = self::get_shortfall_message();
		if ( '' !== $message ) {
			wc_add_notice( $message, 'error' );
		}
	}
}
