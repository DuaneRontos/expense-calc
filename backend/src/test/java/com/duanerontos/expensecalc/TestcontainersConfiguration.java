package com.duanerontos.expensecalc;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {

	// Pinned deliberately. Initializr generates "postgres:latest", which makes
	// test runs non-reproducible and lets a new major Postgres break CI on a
	// day nobody changed anything.
	private static final DockerImageName POSTGRES_IMAGE =
			DockerImageName.parse("postgres:17-alpine");

	@Bean
	@ServiceConnection
	PostgreSQLContainer postgresContainer() {
		return new PostgreSQLContainer(POSTGRES_IMAGE);
	}

}
