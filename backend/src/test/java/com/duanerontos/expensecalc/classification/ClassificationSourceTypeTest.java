package com.duanerontos.expensecalc.classification;

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
 * Asserts the Postgres {@code classification_source} type and
 * {@link ClassificationSource} have not drifted apart — the same guard
 * {@code CategoryTypeTest} provides for the taxonomy, for the same reason.
 *
 * <p>Nothing in the compiler or in Flyway connects the two declarations, so a
 * constant added without a migration fails at runtime the first time that value
 * is written. {@code IMPORT} makes that likelier here than for the taxonomy: it
 * has no producer in v1, so the first write of it would be the migration's
 * first test.
 *
 * <p>Requires Docker.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
class ClassificationSourceTypeTest {

	@Autowired
	private TestEntityManager entityManager;

	@Test
	@DisplayName("Postgres enum labels match the Java enum exactly, in order")
	void databaseTypeMatchesJavaEnum() {
		@SuppressWarnings("unchecked")
		// ::regtype resolves through search_path, so this cannot match a
		// same-named type in another schema and concatenate both label sets.
		List<String> labels = this.entityManager.getEntityManager().createNativeQuery("""
				SELECT e.enumlabel
				FROM pg_enum e
				WHERE e.enumtypid = 'classification_source'::regtype
				ORDER BY e.enumsortorder
				""").getResultList();

		String[] javaNames = Arrays.stream(ClassificationSource.values()).map(Enum::name).toArray(String[]::new);

		assertThat(labels).containsExactly(javaNames);
	}

	@Test
	@DisplayName("the append-only trigger is attached, not merely defined")
	void appendOnlyTriggerIsAttached() {
		// A CREATE FUNCTION that no trigger uses would leave the guarantee
		// looking implemented while every UPDATE went through. Asserting the
		// trigger row exists is what distinguishes the two.
		@SuppressWarnings("unchecked")
		List<String> triggers = this.entityManager.getEntityManager().createNativeQuery("""
				SELECT tgname
				FROM pg_trigger
				WHERE tgrelid = 'classification_record'::regclass
				  AND NOT tgisinternal
				""").getResultList();

		assertThat(triggers).contains("classification_record_append_only");
	}

}
