package com.duanerontos.expensecalc.report;

import java.time.Clock;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Supplies the clock reports read "now" from.
 *
 * <p>A bean rather than {@code Instant.now()} at the call site so a test can
 * fix time without sleeping or tolerating slop. {@link ConditionalOnMissingBean}
 * lets a test replace it by simply defining one.
 *
 * <p>UTC deliberately: this clock answers "what instant is it", which has no
 * zone. Turning an instant into a Philippine calendar day is a separate step
 * that {@code app.reporting.zone} governs — conflating the two is how a report
 * ends up in the host's timezone (spec §4).
 */
@Configuration(proxyBeanMethods = false)
public class ReportingClockConfiguration {

	@Bean
	@ConditionalOnMissingBean
	public Clock reportingClock() {
		return Clock.systemUTC();
	}

}
