<?php
/**
 * WooCommerce > Settings > Minimum order.
 *
 * Saving goes through the WooCommerce settings API, which verifies the
 * "woocommerce-settings" nonce and the manage_woocommerce capability.
 *
 * @package MinOrderByRole
 */

defined( 'ABSPATH' ) || exit;

/**
 * Settings tab with one amount field per role plus guests.
 */
class MOBR_Settings_Page extends WC_Settings_Page {

	/**
	 * Sets up the tab.
	 */
	public function __construct() {
		$this->id    = 'min_order_by_role';
		$this->label = __( 'Minimum order', 'min-order-by-role' );
		parent::__construct();

		add_filter( 'woocommerce_admin_settings_sanitize_option_' . MOBR_Rules::OPTION, array( $this, 'sanitize_amount' ), 10, 3 );
	}

	/**
	 * Settings for the tab's only section.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	protected function get_settings_for_default_section() {
		$settings = array(
			array(
				'title' => __( 'Minimum order amount per role', 'min-order-by-role' ),
				'type'  => 'title',
				'desc'  => __( 'Customers whose cart subtotal is below their minimum see a notice on the cart page and cannot place the order. A customer with several roles gets the highest minimum. Leave a field empty for no minimum.', 'min-order-by-role' ),
				'id'    => 'mobr_minimums',
			),
			$this->amount_field( MOBR_Rules::GUEST, __( 'Guest (not logged in)', 'min-order-by-role' ) ),
		);

		foreach ( wp_roles()->get_names() as $slug => $name ) {
			$settings[] = $this->amount_field( (string) $slug, translate_user_role( $name ) );
		}

		$settings[] = array(
			'type' => 'sectionend',
			'id'   => 'mobr_minimums',
		);

		return $settings;
	}

	/**
	 * One amount field stored in the shared option under the role's key.
	 *
	 * @param string $key   Role slug or "guest".
	 * @param string $label Field label.
	 * @return array<string, mixed>
	 */
	private function amount_field( $key, $label ) {
		return array(
			'title'       => $label,
			'id'          => MOBR_Rules::OPTION . '[' . $key . ']',
			'type'        => 'text',
			'class'       => 'wc_input_price short',
			'default'     => '',
			'placeholder' => __( 'No minimum', 'min-order-by-role' ),
			'desc_tip'    => __( 'Minimum cart subtotal (before discounts, shipping and tax).', 'min-order-by-role' ),
		);
	}

	/**
	 * Sanitises each amount as it is saved.
	 *
	 * @param mixed                $value     Value after WooCommerce's own cleaning.
	 * @param array<string, mixed> $option    Field definition.
	 * @param mixed                $raw_value Unslashed posted value.
	 * @return string|null
	 */
	public function sanitize_amount( $value, $option, $raw_value ) {
		if ( null === $value ) {
			return null;
		}
		return MOBR_Rules::sanitize_amount( $raw_value );
	}
}
