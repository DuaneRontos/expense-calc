package com.duanerontos.expensecalc.expense;

import java.util.Arrays;
import java.util.List;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.jpa.test.autoconfigure.TestEntityManager;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Asserts the Postgres {@code expense_category} type and the Java
 * {@link Category} enum have not drifted apart.
 *
 * <p>Two declarations of one taxonomy is the risk this issue creates. Nothing
 * in the compiler or in Flyway connects them, so an enum constant added without
 * a matching migration produces a runtime failure the first time that value is
 * written — potentially long after the change, in whichever code path happens
 * to use it first. This test turns that into a build failure.
 *
 * <p>Requires Docker. It runs in CI (#4); it will not run on a machine without
 * a daemon.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
class CategoryTypeTest {

	@Autowired
	private TestEntityManager entityManager;

	@Test
	@DisplayName("Postgres enum labels match the Java enum exactly, in order")
	void databaseTypeMatchesJavaEnum() {
		@SuppressWarnings("unchecked")
		List<String> labels = this.entityManager.getEntityManager().createNativeQuery("""
				SELECT e.enumlabel
				FROM pg_enum e
				JOIN pg_type t ON t.oid = e.enumtypid
				WHERE t.typname = 'expense_category'
				ORDER BY e.enumsortorder
				""").getResultList();

		String[] javaNames = Arrays.stream(Category.values()).map(Enum::name).toArray(String[]::new);

		// Order matters as well as membership: Postgres compares enum values by
		// declaration order, so this is what ORDER BY category returns.
		assertThat(labels).containsExactly(javaNames);
	}

}
