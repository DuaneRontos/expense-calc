package com.duanerontos.expensecalc.auth;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The bypass profile, which had no coverage and the largest blast radius.
 *
 * <p>It shipped unable to start. Both {@code insecureLocalSecurity} and
 * {@code apiSecurity} were built without a {@code securityMatcher}, so both
 * matched every request and Spring Security refused to publish a chain it could
 * prove unreachable — {@code UnreachableFilterChainException}, at startup,
 * before anything served. That is the path
 * {@code docs/RUNNING-LOCALLY.md} calls the recommended one for local work, and
 * every {@code curl} example under it assumed a running server.
 *
 * <p>No test activated the profile, which is exactly why it shipped. This is
 * that test.
 *
 * <p>Requires Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@ActiveProfiles(SecurityStartupGuard.INSECURE_PROFILE)
@Import(TestcontainersConfiguration.class)
class InsecureLocalProfileTest {

	@Autowired
	private TestRestTemplate http;

	@Test
	@DisplayName("starts, which is the part that was broken")
	void starts() {
		// Reaching this method at all is the assertion: the context failed to
		// build before, so every test in this class would have errored.
		assertThat(this.http).isNotNull();
	}

	@Test
	@DisplayName("serves an anonymous request, which is the whole point of it")
	void servesAnonymousRequests() {
		// The documented behaviour: curl without a token works.
		assertThat(this.http.getForEntity("/api/v1/categories", String.class).getStatusCode())
			.isEqualTo(HttpStatus.OK);
		assertThat(this.http.getForEntity("/api/v1/expenses", String.class).getStatusCode())
			.isEqualTo(HttpStatus.OK);
	}

	@Test
	@DisplayName("still accepts the credentials it ships, so login is not quietly broken")
	void shipsCredentialsThatWork() {
		// Nothing under this profile authenticates, so a hash that does not
		// verify would go unnoticed indefinitely — which is what happened: the
		// shipped value was neither a valid Argon2id payload nor in a format the
		// configured encoder could parse.
		assertThat(this.http
			.postForEntity("/api/v1/auth/login",
					java.util.Map.of("username", "dev", "password", "dev"), String.class)
			.getStatusCode()).isEqualTo(HttpStatus.OK);
	}

}
