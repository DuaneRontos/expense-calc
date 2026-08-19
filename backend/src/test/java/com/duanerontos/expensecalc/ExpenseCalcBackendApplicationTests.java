package com.duanerontos.expensecalc;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The whole context, wired the way it deploys.
 *
 * <p>Credentials are supplied because the application now refuses to start
 * without them (spec §9.2) — there is deliberately no default signing key, so a
 * context test that passed without one would be proving the wrong thing. This
 * is therefore also the happy-path counterpart to
 * {@code SecurityStartupGuardTest}: that one asserts the guard refuses bad
 * configurations, this one asserts it lets a good one through.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ExpenseCalcBackendApplicationTests {

	@DynamicPropertySource
	static void credentials(DynamicPropertyRegistry registry) {
		registry.add("app.auth.username", () -> "context-test");
		registry.add("app.auth.password-hash",
				() -> Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode("irrelevant"));
		registry.add("app.auth.jwt-secret", () -> "context-test-signing-key-well-over-32-bytes-long");
	}

	@Test
	@DisplayName("starts with security configured, which is how it deploys")
	void contextLoads() {
	}

}
