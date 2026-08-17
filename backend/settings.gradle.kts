plugins {
	// Lets Gradle download a JDK 21 automatically when one isn't installed.
	// The build targets Java 21 (spec §3) while local machines may be on a
	// different JDK; without this the build fails with "No matching toolchain".
	id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "expense-calc-backend"
