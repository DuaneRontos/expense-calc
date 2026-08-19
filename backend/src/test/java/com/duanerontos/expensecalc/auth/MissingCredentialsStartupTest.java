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
 * That the guard's message is the one a person actually sees.
 *
 * <p>{@code SecurityStartupGuardTest} proves the guard throws, but it calls
 * {@code afterPropertiesSet()} directly — so it passed while the real startup
 * failed somewhere else entirely. {@code TokenService}'s constructor builds a
 * {@link javax.crypto.spec.SecretKeySpec} eagerly and was instantiated first,
 * dying with {@code IllegalArgumentException: Empty key}: a message naming no
 * property, no profile, and no document.
 *
 * <p>The guard's whole value is the sentence it prints. This asserts it is the
 * sentence that reaches the console.
 *
 * <p>Requires Docker.
 */
class MissingCredentialsStartupTest {

	@Test
	@DisplayName("names the missing property rather than failing on an empty key")
	void reportsTheGuardsMessage() {
		SpringApplication application = new SpringApplication(ExpenseCalcBackendApplication.class,
				TestcontainersConfiguration.class);
		application.setWebApplicationType(WebApplicationType.NONE);
		// No app.auth.* anywhere: the case a first-time deployer hits.
		application.setDefaultProperties(java.util.Map.of("app.auth.username", "", "app.auth.password-hash", "",
				"app.auth.jwt-secret", ""));

		assertThatThrownBy(() -> application.run().close()).satisfies(thrown -> {
			String everything = stackToString(thrown);
			assertThat(everything).contains("Refusing to start").contains("app.auth.");
			// The failure that used to win the race, and says nothing useful.
			assertThat(everything).doesNotContain("Empty key");
		});
	}

	private static String stackToString(Throwable thrown) {
		java.io.StringWriter writer = new java.io.StringWriter();
		thrown.printStackTrace(new java.io.PrintWriter(writer));
		return writer.toString();
	}

}
