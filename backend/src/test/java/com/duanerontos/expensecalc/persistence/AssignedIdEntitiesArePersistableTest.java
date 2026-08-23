package com.duanerontos.expensecalc.persistence;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.data.domain.Persistable;
import org.springframework.util.ClassUtils;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every entity that assigns its own id must say so (issue #43).
 *
 * <p>{@code SimpleJpaRepository.save} calls {@code merge()} rather than
 * {@code persist()} whenever {@code isNew()} is false, and the default
 * {@code isNew()} is {@code id != null}. An entity assigning a {@code UUID} in
 * its constructor is therefore never new, so every insert is preceded by a
 * select that cannot return anything.
 *
 * <p><b>A per-entity test cannot catch the next entity.</b> Two were fixed with
 * tests pinning both, and a third — {@code RefreshToken}, on the write path of
 * every login and every rotation — still had the defect, because nothing was
 * looking for it. This is that something, in the same shape as
 * {@code NoAbsoluteValueInMoneyPathsTest}: a convention the framework default
 * gets wrong, whose symptom is invisible, expressed as a build failure.
 */
class AssignedIdEntitiesArePersistableTest {

	private static final String ROOT = "com.duanerontos.expensecalc";

	@Test
	@DisplayName("finds the entities it claims to scan, so it cannot pass by looking at nothing")
	void scansSomething() {
		// The failure mode of every reflective guard: a package rename turns it
		// into a test that asserts nothing and stays green.
		assertThat(entities()).hasSizeGreaterThanOrEqualTo(3);
	}

	@Test
	@DisplayName("every entity with an assigned id implements Persistable")
	void assignedIdEntitiesImplementPersistable() {
		List<Class<?>> offenders = entities().stream()
			.filter(AssignedIdEntitiesArePersistableTest::assignsItsOwnId)
			.filter(type -> !Persistable.class.isAssignableFrom(type))
			.toList();

		assertThat(offenders)
			.describedAs("These assign their own @Id, so Spring Data treats every insert as a merge and "
					+ "Hibernate probes for a row that cannot exist. Implement Persistable<UUID> with a "
					+ "@Transient isNew flag, as Expense does.")
			.isEmpty();
	}

	@Test
	@DisplayName("recognises an assigned id, so the filter is not passing everything")
	void recognisesAnAssignedId() {
		// Guards the guard from the other side: a predicate that answered false
		// for everything would leave the test above green forever.
		List<Class<?>> assigned = entities().stream()
			.filter(AssignedIdEntitiesArePersistableTest::assignsItsOwnId)
			.toList();

		assertThat(assigned).isNotEmpty();
	}

	/** An {@code @Id} with no {@code @GeneratedValue} is one the entity sets itself. */
	private static boolean assignsItsOwnId(Class<?> type) {
		for (Field field : type.getDeclaredFields()) {
			if (field.isAnnotationPresent(Id.class)) {
				return !field.isAnnotationPresent(GeneratedValue.class);
			}
		}
		return false;
	}

	private static Set<Class<?>> entities() {
		ClassPathScanningCandidateComponentProvider scanner =
				new ClassPathScanningCandidateComponentProvider(false);
		scanner.addIncludeFilter(new AnnotationTypeFilter(Entity.class));

		return scanner.findCandidateComponents(ROOT)
			.stream()
			.map(BeanDefinition::getBeanClassName)
			.map(name -> ClassUtils.resolveClassName(name, null))
			.collect(Collectors.toUnmodifiableSet());
	}

}
