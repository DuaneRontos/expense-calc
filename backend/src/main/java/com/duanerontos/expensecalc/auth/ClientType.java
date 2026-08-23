package com.duanerontos.expensecalc.auth;

import java.util.Locale;

import com.fasterxml.jackson.annotation.JsonCreator;

/**
 * Which storage mechanism spec §9.2 assigns the caller's refresh token
 * (issue #57).
 *
 * <p>Spec §9.2 gives three targets two mechanisms — Keychain/Keystore for iOS
 * and Android, an {@code httpOnly} cookie for web — and only the client knows
 * which it is. An {@code httpOnly} cookie is by definition unwritable from
 * JavaScript, so the web row is one only the server can implement, and it has
 * to be told when to.
 *
 * <p><b>Declared by the caller rather than sniffed from a header.</b> Guessing
 * from {@code User-Agent} or the presence of {@code Origin} would make the
 * storage of a credential depend on a header any caller can set and some
 * legitimate ones omit — and the failure is silent: a web client mistaken for a
 * device gets a token in a body it must not keep, and a device mistaken for web
 * gets a cookie it cannot read and no token at all.
 *
 * <p><b>Exactly one mechanism per caller, never both.</b> Returning the token in
 * the body <em>and</em> setting the cookie would be simpler and would defeat the
 * point: the body is readable by any script that achieves XSS, which is the one
 * thing {@code httpOnly} exists to prevent.
 */
public enum ClientType {

	/** Browsers. Refresh token goes in the cookie and never into the body. */
	WEB,

	/** iOS and Android. Refresh token goes in the body, for SecureStore. */
	DEVICE;

	/**
	 * Accepts {@code "web"} as readily as {@code "WEB"}.
	 *
	 * <p>Jackson matches enum constants exactly by default, so without this a
	 * lower-case {@code "web"} — the spelling every JSON client will reach for
	 * — is a 400. Mirrors how {@code ReportController} parses its bucket.
	 */
	@JsonCreator
	public static ClientType parse(String value) {
		if (value == null) {
			return null;
		}

		try {
			return valueOf(value.trim().toUpperCase(Locale.ENGLISH));
		}
		catch (IllegalArgumentException unknown) {
			throw new IllegalArgumentException(
					"Unknown client '%s'. Use 'web' for browsers or 'device' for iOS and Android."
						.formatted(value));
		}
	}

}
