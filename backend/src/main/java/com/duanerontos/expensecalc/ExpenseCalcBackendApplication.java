package com.duanerontos.expensecalc;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

// Scheduling exists for exactly one job: deleting refresh tokens whose
// retention window has passed (#51, RefreshTokenCleanup). It is enabled here
// rather than beside that class so there is one place to look for "does this
// application run anything on a timer?".
@EnableScheduling
@SpringBootApplication
public class ExpenseCalcBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(ExpenseCalcBackendApplication.class, args);
	}

}
