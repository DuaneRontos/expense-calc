package com.duanerontos.expensecalc.auth;

import java.time.Duration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;
import static org.assertj.core.api.Assertions.assertThatNoException;

/**
 * The guard issue #21 asks for by name: "a test asserts the production
 * configuration refuses to boot with the dev profile enabled".
 *
 * <p>Plain unit tests rather than a Spring context. The guard's job is to throw
 * during startup, and a test that has to boot a context to find out is slower
 * and tells you less about which condition fired.
 */
class SecurityStartupGuardTest {

	private static final String LOCAL_DB = "jdbc:postgresql://localhost:5432/expensecalc";

	private static final AuthProperties CONFIGURED = new AuthProperties("duane", "{argon2id}$argon2id$v=19$whatever",
			"a-signing-key-that-is-comfortably-over-32-bytes", Duration.ofMinutes(15), Duration.ofDays(30));

	private static MockEnvironment environmentWith(String... profiles) {
		MockEnvironment environment = new MockEnvironment();
		environment.setActiveProfiles(profiles);
		return environment;
	}

	private static SecurityStartupGuard guard(MockEnvironment environment, String datasourceUrl, String deployment) {
		return new SecurityStartupGuard(environment, CONFIGURED, datasourceUrl, deployment);
	}

	@Test
	@DisplayName("refuses to start when the bypass profile meets a production deployment")
	void refusesTheBypassInProduction() {
		// The requirement, quoted: "the production build fails to start if that
		// profile is active — not warn, fail."
		SecurityStartupGuard guard = guard(environmentWith(SecurityStartupGuard.INSECURE_PROFILE), LOCAL_DB,
				"production");

		assertThatIllegalStateException().isThrownBy(guard::afterPropertiesSet)
			.withMessageContaining("Refusing to start")
			.withMessageContaining(SecurityStartupGuard.INSECURE_PROFILE);
	}

	@ParameterizedTest
	@ValueSource(strings = { "jdbc:postgresql://db.internal:5432/expensecalc",
			"jdbc:postgresql://10.0.0.4:5432/expensecalc", "jdbc:postgresql://prod-db.example.com/expensecalc" })
	@DisplayName("refuses the bypass against any database that is not local")
	void refusesTheBypassAgainstARemoteDatabase(String datasourceUrl) {
		// The realistic accident is not declaring production and forgetting —
		// it is running the local profile against a remote database because the
		// URL was still in the environment. That is the case with the worst
		// outcome, so it fails on the URL alone, whatever app.deployment says.
		SecurityStartupGuard guard = guard(environmentWith(SecurityStartupGuard.INSECURE_PROFILE), datasourceUrl,
				"local");

		assertThatIllegalStateException().isThrownBy(guard::afterPropertiesSet)
			.withMessageContaining("not a local database");
	}

	@Test
	@DisplayName("refuses the bypass when it cannot tell what database it is pointed at")
	void refusesTheBypassWithNoDatasourceUrl() {
		// A guard that fails open the moment it cannot parse something is not a
		// guard.
		SecurityStartupGuard guard = guard(environmentWith(SecurityStartupGuard.INSECURE_PROFILE), "", "local");

		assertThatIllegalStateException().isThrownBy(guard::afterPropertiesSet);
	}

	@ParameterizedTest
	@ValueSource(strings = { "jdbc:postgresql://localhost:5432/expensecalc", "jdbc:postgresql://127.0.0.1:5432/db",
			"jdbc:postgresql://localhost/expensecalc" })
	@DisplayName("allows the bypass on a local database, which is the whole point of it")
	void allowsTheBypassLocally(String datasourceUrl) {
		SecurityStartupGuard guard = guard(environmentWith(SecurityStartupGuard.INSECURE_PROFILE), datasourceUrl,
				"local");

		assertThatNoException().isThrownBy(guard::afterPropertiesSet);
	}

	@Test
	@DisplayName("says nothing about credentials while the bypass is on")
	void skipsCredentialChecksUnderTheBypass() {
		// Nothing authenticates under this profile, so demanding a signing key
		// would be theatre — and would push someone toward setting a real one
		// in a file they then commit.
		AuthProperties unset = new AuthProperties(null, null, null, null, null);
		SecurityStartupGuard guard = new SecurityStartupGuard(
				environmentWith(SecurityStartupGuard.INSECURE_PROFILE), unset, LOCAL_DB, "local");

		assertThatNoException().isThrownBy(guard::afterPropertiesSet);
	}

	@Test
	@DisplayName("refuses to start secured without a username, hash, or signing key")
	void refusesMissingCredentials() {
		// There is deliberately no default: a default secret is a published
		// secret, and the failure it causes is invisible because everything
		// works.
		assertThatIllegalStateException()
			.isThrownBy(() -> new SecurityStartupGuard(environmentWith(), new AuthProperties(null, "hash", "a".repeat(32),
					null, null), LOCAL_DB, "production").afterPropertiesSet())
			.withMessageContaining("app.auth.username");

		assertThatIllegalStateException()
			.isThrownBy(() -> new SecurityStartupGuard(environmentWith(), new AuthProperties("duane", null,
					"a".repeat(32), null, null), LOCAL_DB, "production").afterPropertiesSet())
			.withMessageContaining("app.auth.password-hash");

		assertThatIllegalStateException()
			.isThrownBy(() -> new SecurityStartupGuard(environmentWith(),
					new AuthProperties("duane", "hash", null, null, null), LOCAL_DB, "production")
				.afterPropertiesSet())
			.withMessageContaining("app.auth.jwt-secret");
	}

	@Test
	@DisplayName("refuses a signing key shorter than the algorithm deserves")
	void refusesAShortSigningKey() {
		// HS256 with a short key is weaker than the name implies, and the
		// weakness is invisible in every test that only checks tokens verify.
		SecurityStartupGuard guard = new SecurityStartupGuard(environmentWith(),
				new AuthProperties("duane", "hash", "too-short", null, null), LOCAL_DB, "production");

		assertThatIllegalStateException().isThrownBy(guard::afterPropertiesSet)
			.withMessageContaining("shorter than %d bytes".formatted(AuthProperties.MINIMUM_SECRET_BYTES));
	}

	@Test
	@DisplayName("starts normally when secured and configured")
	void startsWhenConfigured() {
		assertThatNoException()
			.isThrownBy(() -> guard(environmentWith(), "jdbc:postgresql://db.internal:5432/x", "production")
				.afterPropertiesSet());
	}

}
