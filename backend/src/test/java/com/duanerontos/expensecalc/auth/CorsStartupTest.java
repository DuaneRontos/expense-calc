package com.duanerontos.expensecalc.auth;

import com.duanerontos.expensecalc.ExpenseCalcBackendApplication;
import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * That a wildcard origin with credentials fails at startup, not at request time.
 *
 * <p>{@code Access-Control-Allow-Origin: *} together with
 * {@code Access-Control-Allow-Credentials: true} is forbidden by the CORS
 * specification, for a good reason: it would let any site on the internet make
 * authenticated requests as the user. Spring does reject the pair — but when it
 * builds the response headers, so the failure arrives on the first cross-origin
 * call, in a stack trace naming neither property, on a deployment that started
 * cleanly.
 *
 * <p>Same argument as {@code SecurityStartupGuard}: a configuration that must
 * never run should stop the application rather than warn, and the message
 * should name what to change.
 *
 * <p>Requires Docker.
 */
class CorsStartupTest {

	@Test
	@DisplayName("refuses a wildcard origin combined with credentials, naming both properties")
	void refusesWildcardWithCredentials() {
		SpringApplication application = new SpringApplication(ExpenseCalcBackendApplication.class,
				TestcontainersConfiguration.class);
		application.setWebApplicationType(WebApplicationType.NONE);

		// Command-line args rather than default properties: application.yml
		// binds app.auth.* to empty strings, which outrank defaults — so the
		// credentials guard would fire first and this would pass for the wrong
		// reason, proving only that some guard threw.
		assertThatThrownBy(() -> application
			.run("--app.cors.allowed-origins=" + CorsProperties.WILDCARD, "--app.cors.allow-credentials=true",
					"--app.auth.username=dev", "--app.auth.password-hash=hash",
					"--app.auth.jwt-secret=a-signing-key-long-enough-to-pass-the-guard")
			.close()).satisfies(thrown -> {
			String everything = stackToString(thrown);
			assertThat(everything).contains("Refusing to start")
				.contains("app.cors.allowed-origins")
				.contains("app.cors.allow-credentials");
			// Not the credentials guard wearing this test's name.
			assertThat(everything).doesNotContain("app.auth.username is not set");
		});
	}

	@Test
	@DisplayName("allows a wildcard on its own, which is merely blunt rather than unsafe")
	void allowsWildcardWithoutCredentials() {
		// Without credentials a wildcard exposes only what an unauthenticated
		// caller could already fetch with curl. It is a poor default and not a
		// vulnerability, so it is configuration rather than a startup failure.
		CorsProperties properties = new CorsProperties(java.util.List.of(CorsProperties.WILDCARD), false);

		assertThat(properties.allowsWildcard()).isTrue();
		assertThat(properties.isEnabled()).isTrue();
	}

	@Test
	@DisplayName("is disabled when no origin is configured, which is the deployed default")
	void disabledByDefault() {
		// An unconfigured deployment is reachable only from its own origin.
		assertThat(new CorsProperties(null, false).isEnabled()).isFalse();
		assertThat(new CorsProperties(java.util.List.of(), false).isEnabled()).isFalse();
	}

	private static String stackToString(Throwable thrown) {
		java.io.StringWriter writer = new java.io.StringWriter();
		thrown.printStackTrace(new java.io.PrintWriter(writer));
		return writer.toString();
	}

}
