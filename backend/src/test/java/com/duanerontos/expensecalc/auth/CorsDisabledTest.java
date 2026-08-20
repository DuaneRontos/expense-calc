package com.duanerontos.expensecalc.auth;

import java.net.URI;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * That an empty allow-list means "no policy", not "reject everything".
 *
 * <p><b>The distinction is not academic.</b> Registering an empty configuration
 * for {@code /api/**} makes {@code CorsFilter} match the path, find no permitted
 * origin, and answer 403 before a controller sees the request. For a genuinely
 * foreign origin that is fine. The problem is the request Spring only
 * <em>thinks</em> is foreign.
 *
 * <p>Spring decides by comparing the {@code Origin} header against the servlet
 * request's own scheme, host and port. Behind a TLS-terminating proxy Tomcat
 * sees {@code http} while the browser sends {@code Origin: https://…}, so a page
 * calling its <em>own</em> API reads as cross-origin. Browsers attach
 * {@code Origin} to same-origin requests for every method except GET and HEAD —
 * which is every mutation the client makes.
 *
 * <p>So the deployed default, documented as "reachable only from its own
 * origin", would have rejected precisely the traffic it was meant to permit, in
 * a deployment shape nothing here can reproduce and no test noticed.
 *
 * <p>Requires Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@ActiveProfiles(SecurityStartupGuard.INSECURE_PROFILE)
@TestPropertySource(properties = "app.cors.allowed-origins=")
@Import(TestcontainersConfiguration.class)
class CorsDisabledTest {

	@Autowired
	private TestRestTemplate http;

	@Autowired
	private CorsProperties properties;

	@Test
	@DisplayName("binds an empty allow-list to disabled rather than to a deny-all policy")
	void bindsToDisabled() {
		// Guards the guard: if the property did not override the profile's
		// origins, every assertion below would pass for the wrong reason.
		assertThat(this.properties.allowedOrigins()).isEmpty();
		assertThat(this.properties.isEnabled()).isFalse();
	}

	@Test
	@DisplayName("lets a request through even though it carries an Origin nothing permits")
	void passesThroughRatherThanRejecting() {
		// The proxy shape: same host and port, different scheme. Cross-origin to
		// Spring, same-origin to the browser that sent it.
		ResponseEntity<String> response = get(proxyShapedOrigin());

		assertThat(response.getStatusCode())
			.describedAs("an empty allow-list must not reject; CORS is off, not denying")
			.isEqualTo(HttpStatus.OK);
	}

	@Test
	@DisplayName("names no origin, because there is no policy to advertise")
	void sendsNoAllowOriginHeader() {
		// Off means the browser applies its own same-origin rule unaided, which
		// is the right outcome for an unconfigured deployment.
		assertThat(get(proxyShapedOrigin()).getHeaders().getAccessControlAllowOrigin()).isNull();
	}

	/** Same host and port as the server, but https — what a TLS proxy produces. */
	private String proxyShapedOrigin() {
		URI root = URI.create(this.http.getRootUri());
		return "https://%s:%d".formatted(root.getHost(), root.getPort());
	}

	private ResponseEntity<String> get(String origin) {
		HttpHeaders headers = new HttpHeaders();
		headers.setOrigin(origin);
		return this.http.exchange("/api/v1/categories", HttpMethod.GET, new HttpEntity<>(headers), String.class);
	}

}
