package com.duanerontos.expensecalc.auth;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Permit-all for local development (spec §9.2).
 *
 * <p>Exists so that poking at the API with {@code curl} does not require a token
 * dance, and so the frontend can be built before auth is wired into it.
 *
 * <p><b>This is a total authentication bypass.</b> It is why
 * {@link SecurityStartupGuard} exists and why the profile is named
 * {@code insecure-local} rather than {@code dev}: the name is the last warning
 * anyone reads before typing it into a deployment, and "dev" reads like an
 * environment while "insecure" reads like a decision.
 */
@Configuration
@Profile(SecurityStartupGuard.INSECURE_PROFILE)
public class InsecureLocalSecurityConfiguration {

	/**
	 * Ordered ahead of the real chain so it wins when the profile is active.
	 */
	@Bean
	@Order(1)
	public SecurityFilterChain insecureLocalSecurity(HttpSecurity http) throws Exception {
		return http.csrf(csrf -> csrf.disable())
			.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.authorizeHttpRequests(requests -> requests.anyRequest().permitAll())
			.build();
	}

}
