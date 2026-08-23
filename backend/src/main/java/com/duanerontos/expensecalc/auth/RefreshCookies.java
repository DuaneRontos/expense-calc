package com.duanerontos.expensecalc.auth;

import java.time.Duration;
import java.util.Arrays;
import java.util.Optional;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * Reads and writes the web client's refresh cookie (issue #57, spec §9.2).
 *
 * <p><b>{@code httpOnly} is the entire reason this is server-side.</b> Such a
 * cookie is unreadable and unwritable from JavaScript by definition, so the web
 * client cannot implement spec §9.2's own table for itself — it can only be
 * handed one. Before this, the web target kept its refresh token in memory and
 * a page refresh signed the user out, because every alternative available to a
 * script ({@code localStorage}, {@code sessionStorage}, a readable cookie)
 * trades the rule for the convenience.
 *
 * <p><b>{@code SameSite=Strict} is set, and is not the CSRF defence.</b> It is a
 * browser behaviour rather than a server check: it stops the common cross-site
 * send and does nothing about a same-site attacker or a client that does not
 * honour it. The check that does the work is {@link #CSRF_HEADER}, and the two
 * are deliberately layered rather than alternatives.
 */
@Component
public class RefreshCookies {

	/**
	 * Required on any refresh that authenticates with the cookie.
	 *
	 * <p><b>This is the CSRF defence, and it works because of what a browser
	 * will not do.</b> A cross-site {@code <form>}, {@code <img>} or navigation
	 * cannot set a request header at all; a cross-origin {@code fetch} that sets
	 * one stops being a simple request and is preflighted, which this API
	 * answers only for the origins {@code app.cors.allowed-origins} names. So an
	 * attacker's page can cause the browser to attach the cookie, and cannot
	 * cause it to attach this.
	 *
	 * <p>Without it, {@code /auth/refresh} becomes reachable cross-site the
	 * moment the credential is a cookie — the browser attaches it automatically,
	 * which is precisely the property CSRF exploits. The attacker cannot read
	 * the response, so the prize is not the token: it is that each forced
	 * rotation invalidates the token the real client holds, which logs the user
	 * out repeatedly.
	 *
	 * <p>The value is not checked. A header a cross-site request cannot set at
	 * all carries its meaning by being present; comparing its contents would
	 * imply a secret that is not there.
	 */
	public static final String CSRF_HEADER = "X-Refresh-Source";

	private final RefreshCookieProperties properties;

	private final AuthProperties auth;

	public RefreshCookies(RefreshCookieProperties properties, AuthProperties auth) {
		this.properties = properties;
		this.auth = auth;
	}

	/** The refresh token the browser sent back, if it sent one. */
	public Optional<String> read(HttpServletRequest request) {
		Cookie[] cookies = request.getCookies();
		if (cookies == null) {
			return Optional.empty();
		}

		return Arrays.stream(cookies)
			.filter((cookie) -> this.properties.name().equals(cookie.getName()))
			.map(Cookie::getValue)
			.filter((value) -> value != null && !value.isBlank())
			.findFirst();
	}

	/** Whether the caller proved this request was not made cross-site. */
	public boolean hasCsrfHeader(HttpServletRequest request) {
		return request.getHeader(CSRF_HEADER) != null;
	}

	/**
	 * The {@code Set-Cookie} carrying a newly issued refresh token.
	 *
	 * <p>{@code Max-Age} matches the token's own lifetime, so the browser
	 * forgets it at roughly the moment the server would refuse it. A session
	 * cookie would be dropped on browser close, which is the page-refresh
	 * sign-out this change exists to fix, one step removed.
	 */
	public String issued(String refreshToken) {
		return build(refreshToken, this.auth.refreshTokenTtl()).toString();
	}

	/**
	 * The {@code Set-Cookie} that removes it.
	 *
	 * <p><b>Every attribute has to match the one that set it</b> — name, path,
	 * secure, same-site — or the browser treats it as a different cookie, stores
	 * the empty one alongside, and keeps sending the original. Built through the
	 * same method for that reason rather than spelled out twice.
	 */
	public String cleared() {
		return build("", Duration.ZERO).toString();
	}

	/** The header name both of the above belong on. */
	public String header() {
		return HttpHeaders.SET_COOKIE;
	}

	private ResponseCookie build(String value, Duration maxAge) {
		return ResponseCookie.from(this.properties.name(), value)
			// Unreadable from JavaScript. The reason the server has to do this.
			.httpOnly(true)
			.secure(this.properties.secure())
			// Never sent on a cross-site request. Layered with CSRF_HEADER
			// rather than trusted alone — see the class comment.
			.sameSite("Strict")
			// Resolved rather than read straight off the property, because a
			// `__Host-` name silently requires "/" and a mismatch produces a
			// cookie the browser discards without saying why.
			.path(this.properties.effectivePath())
			.maxAge(maxAge)
			.build();
	}

}
