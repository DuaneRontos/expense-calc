package com.duanerontos.expensecalc.auth;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Which browser origins may call this API (issue #58).
 *
 * <p><b>Empty by default, which means no cross-origin caller is allowed.</b>
 * A browser refuses a cross-origin response unless the server names the origin,
 * so an unset property leaves the API reachable only from its own origin — the
 * safe end of the range. The permissive value belongs in the local profile,
 * where {@code SecurityStartupGuard} already establishes that "this
 * configuration must never reach production" is enforced rather than documented.
 *
 * <p>This matters on exactly one of the three targets. iOS and Android are not
 * browsers and never send an {@code Origin} header, so the API worked for them
 * throughout — which is why the gap survived until something ran in a browser,
 * and why every {@code curl} example in {@code docs/RUNNING-LOCALLY.md} passed
 * while the web client could not make a single call.
 *
 * @param allowedOrigins exact origins, scheme and port included —
 *     {@code http://localhost:8081} is a different origin from
 *     {@code http://localhost:8080}
 * @param allowCredentials whether the browser may send cookies. <b>True since
 *     #57</b>, which moved the web client's refresh token into an
 *     {@code httpOnly} cookie: a browser will not send one cross-origin unless
 *     the server says so. The two obligations that travel with it are enforced
 *     rather than documented — the wildcard origin is rejected below, by the
 *     CORS specification and by Spring, and a cookie-authenticated refresh must
 *     carry {@link RefreshCookies#CSRF_HEADER}. Inert while
 *     {@code allowedOrigins} is empty, since no cross-origin caller is
 *     permitted at all.
 */
@ConfigurationProperties(prefix = "app.cors")
public record CorsProperties(List<String> allowedOrigins, boolean allowCredentials) {

	/** Rejected with credentials, and a blunt instrument without them. */
	public static final String WILDCARD = "*";

	public CorsProperties {
		allowedOrigins = (allowedOrigins == null) ? List.of() : List.copyOf(allowedOrigins);
	}

	/** True when any cross-origin caller is permitted at all. */
	public boolean isEnabled() {
		return !this.allowedOrigins.isEmpty();
	}

	public boolean allowsWildcard() {
		return this.allowedOrigins.contains(WILDCARD);
	}

}
