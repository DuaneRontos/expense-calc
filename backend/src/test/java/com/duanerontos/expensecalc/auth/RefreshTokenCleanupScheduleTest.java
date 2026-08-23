package com.duanerontos.expensecalc.auth;

import java.time.ZoneId;
import java.util.List;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.scheduling.config.CronTask;
import org.springframework.scheduling.config.ScheduledTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * That the cleanup is actually scheduled (issue #51).
 *
 * <p><b>The arithmetic was pinned and the wiring was not.</b>
 * {@code RefreshTokenCleanupTest} proves the job deletes the right rows, and
 * would keep passing with {@code @EnableScheduling} deleted — the method still
 * works when called directly, it just never gets called. A one-off manual run
 * showed it fired that day and defends nothing afterwards.
 *
 * <p>Also asserts the zone. A cron with no {@code zone} resolves against the JVM
 * default, so the schedule silently means something different on a container
 * than on a laptop, and {@code CLAUDE.md} rules out the host default outright.
 *
 * <p>Requires Docker.
 */
@SpringBootTest
@ActiveProfiles(SecurityStartupGuard.INSECURE_PROFILE)
@Import(TestcontainersConfiguration.class)
class RefreshTokenCleanupScheduleTest {

	@Autowired
	private ScheduledTaskHolder scheduledTasks;

	@Test
	@DisplayName("registers the purge as a cron task, so removing @EnableScheduling fails the build")
	void purgeIsScheduled() {
		assertThat(cronTasks())
			.describedAs("no cron task targets RefreshTokenCleanup.purgeExpired — the job is written but never runs")
			.anySatisfy(task -> assertThat(task.toString()).contains("purgeExpired"));
	}

	@Test
	@DisplayName("pins the schedule to Asia/Manila rather than inheriting the host's zone")
	void purgeRunsInTheConfiguredZone() {
		// Compared against explicitly-zoned triggers rather than by computing a
		// firing time, because a firing time cannot tell the two apart on a
		// machine that is already in Manila — which is where this was written,
		// and why the first version of this test passed with the zone removed.
		// `CronTrigger.equals` compares the expression and the zone, so this
		// distinguishes them wherever it runs.
		CronTrigger trigger = (CronTrigger) purgeTask().getTrigger();
		String expression = trigger.getExpression();

		assertThat(trigger)
			.describedAs("the cron must carry an explicit zone; without one it resolves against the JVM "
					+ "default, which is UTC in a container and puts 03:15 'off-peak' mid-working-day in Manila")
			.isEqualTo(new CronTrigger(expression, ZoneId.of("Asia/Manila")));

		// The other half: proves the assertion above is zone-sensitive at all
		// rather than passing on the expression alone.
		assertThat(trigger).isNotEqualTo(new CronTrigger(expression, ZoneId.of("UTC")));
	}

	private CronTask purgeTask() {
		return cronTasks().stream()
			.filter(task -> task.toString().contains("purgeExpired"))
			.findFirst()
			.orElseThrow(() -> new AssertionError("no cron task targets purgeExpired"));
	}

	private List<CronTask> cronTasks() {
		return this.scheduledTasks.getScheduledTasks()
			.stream()
			.map(ScheduledTask::getTask)
			.filter(CronTask.class::isInstance)
			.map(CronTask.class::cast)
			.toList();
	}

}
