package com.duanerontos.expensecalc.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The web refresh cookie's attributes (issue #57, spec §9.2).
 *
 * @param name the cookie's name. Plain by default. Naming it
 *     {@code __Host-refresh_token} instead buys protection against a subdomain
 *     overwriting it, at the cost below — worth it for a deployment with
 *     subdomains, and this application has none
 * @param path where the browser will send it back. <b>Scoped to the auth
 *     endpoints</b>, so a refresh token does not ride along on every expense
 *     read it has no business being attached to; a cookie's blast radius is
 *     whatever path it is scoped to. This is the protection the
 *     {@code __Host-} prefix would cost, since browsers pin such a cookie to
 *     {@code /} — the two cannot both apply, and for a single-origin
 *     application with no subdomains, narrowing where the credential travels is
 *     worth more than blocking a sibling that does not exist.
 *     <p><b>Changing this on a live deployment strands the old cookie.</b>
 *     Browsers key a cookie by name <em>and</em> path, so widening
 *     {@code /api/v1/auth} to {@code /} leaves two cookies of the same name and
 *     sends both; RFC 6265 recommends longer-path-first but does not require any
 *     order, so the stale one can win and produce a 401 that only clearing site
 *     data fixes. Change it together with a forced re-login.
 * @param secure whether the cookie is {@code Secure}. <b>True by default and it
 *     should stay that way.</b> Chrome and Firefox treat {@code http://localhost}
 *     as a secure context and do accept {@code Secure} cookies there, so local
 *     development needs no exception. The setting exists for a developer serving
 *     the web client from a LAN address over plain HTTP, where the browser will
 *     not store the cookie at all — and turning it off is a decision that should
 *     be typed out rather than inferred
 */
@ConfigurationProperties(prefix = "app.auth.refresh-cookie")
public record RefreshCookieProperties(String name, String path, Boolean secure) {

	/**
	 * Browsers enforce three things about a {@code __Host-} cookie: it must be
	 * {@code Secure}, it must have no {@code Domain}, and its path must be
	 * {@code /}. In exchange, a subdomain cannot overwrite it — which is the
	 * attack a plain cookie name has no answer to.
	 */
	public static final String HOST_PREFIX = "__Host-";

	public RefreshCookieProperties {
		name = (name == null || name.isBlank()) ? "refresh_token" : name.trim();
		path = (path == null || path.isBlank()) ? "/api/v1/auth" : path.trim();
		secure = (secure == null) || secure;

		// A `__Host-` cookie without `Secure` is not a weaker cookie, it is no
		// cookie: the browser rejects the Set-Cookie header entirely and the
		// web client silently never stays signed in. Refusing at startup turns
		// a confusing runtime symptom into a message that names the two
		// properties involved.
		if (name.startsWith(HOST_PREFIX) && !secure) {
			throw new IllegalArgumentException(
					("Refusing to start: app.auth.refresh-cookie.name is '%s' but secure is false. A browser "
							+ "rejects a __Host- cookie that is not Secure, so no refresh cookie would ever be "
							+ "stored. Either keep secure true, or drop the __Host- prefix from the name.")
						.formatted(name));
		}
	}

	/** Whether the browser will pin this cookie to {@code /} whatever {@link #path} says. */
	public boolean isHostPrefixed() {
		return this.name.startsWith(HOST_PREFIX);
	}

	/**
	 * The path the cookie is actually written with.
	 *
	 * <p>The {@code __Host-} prefix requires {@code /}, so sending anything else
	 * alongside it produces a cookie the browser discards. Resolving it here
	 * rather than at the call site means the two settings cannot disagree
	 * silently.
	 */
	public String effectivePath() {
		return isHostPrefixed() ? "/" : this.path;
	}

}
