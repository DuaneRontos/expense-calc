package com.duanerontos.expensecalc.auth;

import java.nio.charset.StandardCharsets;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

import javax.crypto.spec.SecretKeySpec;

/**
 * The security spec §9.2 asks for: stateless, JWT-bearer, single-user.
 *
 * <p><b>Stateless.</b> No session, no {@code JSESSIONID}. Every request carries
 * what it needs, which is what spec §3 requires and what lets the same API serve
 * iOS, Android and web without sticky routing.
 *
 * <p><b>CORS is configured, not disabled.</b> A browser will not hand a
 * cross-origin response to JavaScript unless this API names the origin, and web
 * is one of the three targets spec §2 commits to. Which origins are allowed is
 * configuration — empty by default, so an unconfigured deployment is reachable
 * only from its own origin. See {@link CorsConfiguration}.
 *
 * <p><b>CSRF is disabled, and that is safe only because of the line above it.</b>
 * CSRF exists to stop a browser sending a request with credentials it attaches
 * automatically — cookies. This API authenticates with an {@code Authorization}
 * header the client sets explicitly, which a cross-site form cannot do. If a
 * future change moves the <em>access</em> token into a cookie, CSRF protection
 * has to come back in the same commit.
 *
 * <p>Note that enabling CORS does not change that reasoning. CORS decides who
 * may <em>read</em> a response; CSRF is about who may cause a request to be
 * <em>sent</em> with credentials the browser attaches on its own. This API
 * attaches none, and {@code app.cors.allow-credentials} is false — the pair
 * moves together, which is why #57 has to revisit both.
 */
@Configuration
@EnableConfigurationProperties({ AuthProperties.class, LoginRateLimitProperties.class })
public class SecurityConfiguration {

	/**
	 * The real chain, absent under the bypass profile.
	 *
	 * <p><b>Excluded by profile rather than out-ordered.</b> Both chains are
	 * built with no {@code securityMatcher}, so both match every request, and
	 * Spring Security refuses to publish a chain it can prove unreachable —
	 * {@code UnreachableFilterChainException} at startup. Ordering the bypass
	 * first does not help: the second chain still exists and is still
	 * unreachable. Only one of the two may be defined at a time.
	 */
	@Bean
	@Profile("!" + SecurityStartupGuard.INSECURE_PROFILE)
	public SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
		return http
			// Before authorization, so an unauthenticated preflight is answered
			// rather than rejected. See CorsConfiguration.
			.cors(Customizer.withDefaults())
			.csrf(csrf -> csrf.disable())
			.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.authorizeHttpRequests(requests -> requests
				// Signing in and refreshing cannot require being signed in.
				.requestMatchers(HttpMethod.POST, "/api/v1/auth/login", "/api/v1/auth/refresh")
				.permitAll()
				// Everything else, including every read, needs a token: v1 is
				// single-user and there is no public data in it.
				.anyRequest()
				.authenticated())
			.oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> {
			}))
			.build();
	}

	/**
	 * Verifies the access tokens this application issued.
	 *
	 * <p>Same secret as the encoder, and pinned to HS256 — a decoder that
	 * accepts whatever algorithm the token's own header names is how {@code
	 * alg: none} attacks work.
	 */
	@Bean
	public JwtDecoder jwtDecoder(AuthProperties properties) {
		NimbusJwtDecoder decoder = NimbusJwtDecoder
			.withSecretKey(new SecretKeySpec(properties.jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
			.macAlgorithm(MacAlgorithm.HS256)
			.build();

		// The encoder sets iss; without this the claim is decoration. Validating
		// it means a token signed with this key for some other purpose — a
		// future service sharing the secret, a copied config — is not silently
		// accepted here.
		decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(TokenService.ISSUER));

		return decoder;
	}

	/**
	 * Argon2id, as spec §9.2 names specifically.
	 *
	 * <p>Parameters are Spring Security's current defaults for
	 * {@code defaultsForSpringSecurity_v5_8}: 16-byte salt, 32-byte hash, one
	 * thread, 4096 KiB memory, 3 iterations. They are encoded into every hash,
	 * so raising them later does not invalidate existing ones.
	 */
	@Bean
	public PasswordEncoder passwordEncoder() {
		return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
	}

}
