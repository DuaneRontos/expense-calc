package com.duanerontos.expensecalc.auth;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * CORS for the browser target (issue #58).
 *
 * <p>Spec §2 makes web one of the three first-class clients, and a browser will
 * not hand a cross-origin response to JavaScript unless the server says the
 * origin may have it. Without this the web client could not make a single call
 * — not a read, not a sign-in — while iOS, Android and every {@code curl} in the
 * documentation worked, because none of those is a browser.
 *
 * <p><b>Both security chains consume this through
 * {@code .cors(Customizer.withDefaults())}</b>, which resolves the bean named
 * {@code corsConfigurationSource}. It has to be wired into the chain rather than
 * left to Spring MVC: Spring Security's {@code CorsFilter} runs before
 * authorization and answers the preflight itself, which is what keeps an
 * unauthenticated {@code OPTIONS} from being rejected before the real request
 * is ever sent.
 */
@Configuration
@EnableConfigurationProperties(CorsProperties.class)
public class CorsConfiguration {

	/**
	 * How long a browser may cache a preflight result.
	 *
	 * <p>Every {@code PATCH} and {@code DELETE} this API serves triggers one, as
	 * does any request carrying {@code Authorization} — which is all of them.
	 * Without caching that is an extra round trip per mutation.
	 */
	private static final Duration PREFLIGHT_CACHE = Duration.ofHours(1);

	@Bean
	public CorsConfigurationSource corsConfigurationSource(CorsProperties properties) {
		refuseWildcardWithCredentials(properties);
		refuseOriginPatterns(properties);

		if (!properties.isEnabled()) {
			// Nothing registered, so `CorsFilter` finds no configuration for the
			// path and passes the request through untouched.
			//
			// **An empty allow-list is not the same as an empty policy.**
			// Registering one anyway makes the filter match, find no permitted
			// origin, and answer 403 before a controller sees the request —
			// correct for a genuinely foreign origin, and wrong for the request
			// Spring only *thinks* is foreign. It classifies by comparing the
			// `Origin` header against the servlet request's own scheme, host and
			// port, so behind a TLS-terminating proxy Tomcat sees `http` while
			// the browser sends `https` and a page calling its own API reads as
			// cross-origin. Browsers attach `Origin` to same-origin requests for
			// every method except GET and HEAD, so that is every mutation the
			// client makes.
			//
			// The default is documented as "reachable only from its own origin".
			// Rejecting that origin's own writes is the one thing it must not do.
			return new UrlBasedCorsConfigurationSource();
		}

		org.springframework.web.cors.CorsConfiguration config = new org.springframework.web.cors.CorsConfiguration();
		config.setAllowedOrigins(properties.allowedOrigins());
		config.setAllowedMethods(List.of(HttpMethod.GET.name(), HttpMethod.POST.name(), HttpMethod.PATCH.name(),
				HttpMethod.DELETE.name(), HttpMethod.OPTIONS.name()));

		// Named rather than wildcarded. `*` is rejected outright once
		// credentials are allowed, so listing them keeps this working unchanged
		// if #57 turns that on.
		config.setAllowedHeaders(List.of(HttpHeaders.AUTHORIZATION, HttpHeaders.CONTENT_TYPE, HttpHeaders.ACCEPT));

		// Without this a browser hides the header, so a client cannot read where
		// the expense it just created lives. `POST /expenses` returns 201 with a
		// Location and nothing else would be able to follow it.
		config.setExposedHeaders(List.of(HttpHeaders.LOCATION));

		config.setAllowCredentials(properties.allowCredentials());
		config.setMaxAge(PREFLIGHT_CACHE);

		UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
		// Scoped to the API. Actuator and error pages are not for browsers on
		// another origin, and a path pattern is cheaper to reason about than
		// remembering which endpoints were meant to be public.
		source.registerCorsConfiguration("/api/**", config);
		return source;
	}

	/**
	 * Refuses a combination the browser would reject anyway, but at startup.
	 *
	 * <p>{@code Access-Control-Allow-Origin: *} with
	 * {@code Access-Control-Allow-Credentials: true} is invalid per the CORS
	 * specification, and Spring throws when it builds the response headers — at
	 * request time, on the first cross-origin call, in a stack trace that names
	 * neither property. Failing here names both.
	 */
	/**
	 * Refuses an origin that looks like a pattern but is matched exactly.
	 *
	 * <p>{@code setAllowedOrigins} compares strings. A subdomain wildcard such as
	 * {@code https://*.example.com} needs {@code setAllowedOriginPatterns}, which
	 * this does not use — so configuring one binds cleanly, starts cleanly, and
	 * matches nothing. The web client then fails in a browser and nowhere else,
	 * which is the exact failure mode this configuration exists to close.
	 */
	private static void refuseOriginPatterns(CorsProperties properties) {
		for (String origin : properties.allowedOrigins()) {
			if (origin.contains(CorsProperties.WILDCARD) && !origin.equals(CorsProperties.WILDCARD)) {
				throw new IllegalStateException(
						("Refusing to start: app.cors.allowed-origins contains \"%s\". Origins are matched exactly, "
								+ "so a pattern like this would match no origin at all and the failure would appear "
								+ "only in a browser. List the origins in full, or use \"%s\" alone.")
							.formatted(origin, CorsProperties.WILDCARD));
			}
		}
	}

	private static void refuseWildcardWithCredentials(CorsProperties properties) {
		if (properties.allowsWildcard() && properties.allowCredentials()) {
			throw new IllegalStateException(
					("Refusing to start: app.cors.allowed-origins contains \"%s\" while app.cors.allow-credentials "
							+ "is true. The CORS specification forbids that pair, because a wildcard plus cookies "
							+ "would let any site on the internet make authenticated requests as the user. Name the "
							+ "origins explicitly.")
						.formatted(CorsProperties.WILDCARD));
		}
	}

}
