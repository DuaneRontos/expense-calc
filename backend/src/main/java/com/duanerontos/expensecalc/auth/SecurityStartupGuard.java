package com.duanerontos.expensecalc.auth;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * Refuses to start rather than run insecurely (spec §9.2, issue #21).
 *
 * <p>The requirement is worth quoting: "the production build fails to start if
 * that profile is active — not warn, fail. A dev bypass that ships is a total
 * authentication bypass, and it is a well-worn way to lose a database."
 *
 * <p>A warning is the wrong shape for this. Startup warnings are read once, by
 * whoever is watching the console at the time, and a bypass that ships is
 * usually shipped by someone who was not watching.
 *
 * <p>Two independent checks, because the first one relies on somebody having
 * remembered to set a property:
 *
 * <ul>
 * <li><b>Declared production.</b> {@code app.deployment=production} with the
 * bypass profile active is a contradiction, and the app refuses it.
 * <li><b>A database that is not local.</b> The realistic accident is not
 * declaring production and forgetting — it is running the local profile against
 * a remote database because the URL was still in the environment. That is the
 * case with the worst outcome, so it fails on the datasource URL alone,
 * whatever the deployment property says.
 * </ul>
 */
@Configuration
public class SecurityStartupGuard implements InitializingBean {

	/** Named for what it does, not for where it runs. */
	public static final String INSECURE_PROFILE = "insecure-local";

	private static final List<String> LOCAL_HOSTS = List.of("localhost", "127.0.0.1", "[::1]", "::1");

	private final Environment environment;

	private final String datasourceUrl;

	private final String deployment;

	public SecurityStartupGuard(Environment environment, AuthProperties auth,
			@Value("${spring.datasource.url:}") String datasourceUrl,
			@Value("${app.deployment:local}") String deployment) {
		this.environment = environment;
		this.auth = auth;
		this.datasourceUrl = datasourceUrl;
		this.deployment = deployment;
	}

	/**
	 * Fails fast on a missing or too-short signing key.
	 *
	 * <p>Without this the application starts and issues tokens signed with
	 * whatever was there — an empty string, or a value short enough that HS256
	 * is weaker than its name suggests. Both produce a service that works
	 * perfectly and is not secured, which is the worst of the available
	 * outcomes because nothing looks wrong.
	 */
	private void requireCredentialsAreConfigured() {
		requirePresent(this.auth.username(), "app.auth.username");
		requirePresent(this.auth.passwordHash(), "app.auth.password-hash");
		requirePresent(this.auth.jwtSecret(), "app.auth.jwt-secret");

		if (this.auth.jwtSecret().getBytes(java.nio.charset.StandardCharsets.UTF_8).length
				< AuthProperties.MINIMUM_SECRET_BYTES) {
			throw new IllegalStateException(
					("Refusing to start: app.auth.jwt-secret is shorter than %d bytes. HS256 with a short key is "
							+ "weaker than the algorithm's name implies, and the weakness is invisible in every "
							+ "test that only checks tokens verify.")
						.formatted(AuthProperties.MINIMUM_SECRET_BYTES));
		}
	}

	private static void requirePresent(String value, String property) {
		if (value == null || value.isBlank()) {
			throw new IllegalStateException(
					("Refusing to start: %s is not set. There is deliberately no default — a default secret is a "
							+ "published secret. docs/RUNNING-LOCALLY.md has the commands that generate these, or "
							+ "run with the %s profile for an unauthenticated local API.")
						.formatted(property, INSECURE_PROFILE));
		}
	}

	private final AuthProperties auth;

	@Override
	public void afterPropertiesSet() {
		if (!bypassActive()) {
			requireCredentialsAreConfigured();
			return;
		}

		if ("production".equalsIgnoreCase(this.deployment)) {
			throw new IllegalStateException(
					("Refusing to start: the %s profile disables authentication entirely, and app.deployment is "
							+ "production. Remove the profile, or if this really is a local machine, unset "
							+ "app.deployment.").formatted(INSECURE_PROFILE));
		}

		if (!pointsAtLocalDatabase()) {
			throw new IllegalStateException(
					("Refusing to start: the %s profile disables authentication entirely, and spring.datasource.url "
							+ "(%s) is not a local database. An unauthenticated API in front of a shared database is "
							+ "the failure this guard exists to prevent.")
						.formatted(INSECURE_PROFILE, this.datasourceUrl));
		}
	}

	private boolean bypassActive() {
		return Arrays.asList(this.environment.getActiveProfiles()).contains(INSECURE_PROFILE);
	}

	/**
	 * Whether the datasource URL names a local host.
	 *
	 * <p>An unreadable or absent URL counts as <em>not</em> local. A guard that
	 * fails open the moment it cannot parse something is not a guard.
	 */
	private boolean pointsAtLocalDatabase() {
		if (this.datasourceUrl == null || this.datasourceUrl.isBlank()) {
			return false;
		}
		return LOCAL_HOSTS.stream().anyMatch(host -> this.datasourceUrl.contains("//" + host + ":")
				|| this.datasourceUrl.contains("//" + host + "/"));
	}

}
