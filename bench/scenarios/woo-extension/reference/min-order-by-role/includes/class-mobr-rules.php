<?php
/**
 * Minimum order rules.
 *
 * @package MinOrderByRole
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reads the configured minimums and works out the minimum for a customer.
 */
class MOBR_Rules {

	/**
	 * Option holding the minimums: role slug => amount, with "guest" for visitors.
	 */
	const OPTION = 'min_order_by_role_minimums';

	/**
	 * Key used for visitors who are not logged in.
	 */
	const GUEST = 'guest';

	/**
	 * Normalises an amount. Empty, zero, negative and non-numeric values mean "no minimum".
	 *
	 * @param mixed $value Raw amount.
	 * @return string Decimal string, or an empty string for no minimum.
	 */
	public static function sanitize_amount( $value ) {
		if ( ! is_scalar( $value ) ) {
			return '';
		}
		$value = str_replace( wc_get_price_decimal_separator(), '.', trim( (string) $value ) );
		if ( ! is_numeric( $value ) || (float) $value <= 0 ) {
			return '';
		}
		return (string) wc_format_decimal( $value );
	}

	/**
	 * Returns the valid configured minimums.
	 *
	 * @return array<string, float> Role slug => minimum amount.
	 */
	public static function get_minimums() {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			return array();
		}

		$minimums = array();
		foreach ( $stored as $role => $amount ) {
			$clean = self::sanitize_amount( $amount );
			if ( '' !== $clean ) {
				$minimums[ (string) $role ] = (float) $clean;
			}
		}
		return $minimums;
	}

	/**
	 * Returns the minimum order amount for a user: the guest amount for visitors,
	 * otherwise the highest amount configured among the user's roles.
	 *
	 * @param WP_User $user User to check.
	 * @return float Minimum amount, 0 when there is none.
	 */
	public static function get_minimum_for_user( WP_User $user ) {
		$minimums = self::get_minimums();
		$minimum  = 0.0;

		if ( ! $user->exists() ) {
			$minimum = $minimums[ self::GUEST ] ?? 0.0;
		} else {
			foreach ( (array) $user->roles as $role ) {
				if ( isset( $minimums[ $role ] ) && $minimums[ $role ] > $minimum ) {
					$minimum = $minimums[ $role ];
				}
			}
		}

		/**
		 * Filters the minimum order amount for a user.
		 *
		 * @since 1.0.0
		 *
		 * @param float   $minimum Minimum amount, 0 for none.
		 * @param WP_User $user    The user being checked.
		 */
		return (float) apply_filters( 'mobr_minimum_order_amount', $minimum, $user );
	}
}
