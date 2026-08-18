package com.duanerontos.expensecalc.report;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Supplies the clock reports read "now" from.
 *
 * <p>A bean rather than {@code Instant.now()} at the call site so production
 * wiring has one source of truth for the current instant.
 *
 * <p><b>To fix time in a test, construct {@link ReportService} directly with
 * {@code Clock.fixed(...)}.</b> That is deterministic and needs no Spring
 * context. An earlier version of this class carried
 * {@code @ConditionalOnMissingBean} and claimed a test could override the bean
 * "by simply defining one" — which is only true for some spellings.
 * {@code @ConditionalOnMissingBean} is order-dependent outside an
 * auto-configuration, and a context defining a replacement {@code Clock} in a
 * nested {@code @TestConfiguration} silently kept this one instead, with no
 * error raised. Without the annotation, a duplicate definition fails loudly
 * rather than quietly ignoring the test's clock.
 *
 * <p>UTC deliberately: this clock answers "what instant is it", which has no
 * zone. Turning an instant into a Philippine calendar day is a separate step
 * that {@code app.reporting.zone} governs — conflating the two is how a report
 * ends up in the host's timezone (spec §4).
 */
@Configuration(proxyBeanMethods = false)
public class ReportingClockConfiguration {

	@Bean
	public Clock reportingClock() {
		return Clock.systemUTC();
	}

}
