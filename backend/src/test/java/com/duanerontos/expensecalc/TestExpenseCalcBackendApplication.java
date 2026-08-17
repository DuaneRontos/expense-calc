package com.duanerontos.expensecalc;

import org.springframework.boot.SpringApplication;

public class TestExpenseCalcBackendApplication {

	public static void main(String[] args) {
		SpringApplication.from(ExpenseCalcBackendApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
