package com.duanerontos.expensecalc.query;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.money.Money;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/v1/expenses} (spec §6, §8).
 */
@RestController
@RequestMapping("/api/v1/expenses")
public class ExpenseQueryController {

	private final ExpenseQueryService expenses;

	public ExpenseQueryController(ExpenseQueryService expenses) {
		this.expenses = expenses;
	}

	/**
	 * Lists expenses with filters, sorting, and pagination.
	 *
	 * @param category repeatable; values are OR'd with each other and AND'd
	 *     against the other filters
	 * @param from inclusive, ISO date
	 * @param to exclusive, ISO date
	 * @param merchant case-insensitive substring
	 * @param q case-insensitive substring over the description
	 * @param minAmount decimal string, compared against the signed amount — so
	 *     {@code minAmount=0} excludes refunds rather than including them by
	 *     magnitude
	 * @param maxAmount decimal string, signed
	 * @param sort {@code field,dir}; defaults to {@code occurredOn,desc}
	 * @param page zero-based
	 * @param size clamped to at most 200; the response reports what was applied
	 */
	@GetMapping
	public ResponseEntity<ExpensePage> list(@RequestParam(required = false) List<String> category,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
			@RequestParam(required = false) String merchant, @RequestParam(required = false) String q,
			@RequestParam(required = false) String minAmount, @RequestParam(required = false) String maxAmount,
			@RequestParam(defaultValue = "occurredOn,desc") String sort,
			@RequestParam(defaultValue = "0") int page, @RequestParam(required = false) Integer size) {

		ExpenseFilter filter = filter(category, from, to, merchant, q, minAmount, maxAmount);
		String[] sortParts = sort.split(",", 2);
		ExpenseSort field = parseSort(sortParts[0]);
		boolean descending = sortParts.length < 2 || !"asc".equalsIgnoreCase(sortParts[1].strip());

		return ResponseEntity.ok(this.expenses.list(filter, field, descending, page, size));
	}

	private ExpenseFilter filter(List<String> categories, LocalDate from, LocalDate to, String merchant, String text,
			String minAmount, String maxAmount) {
		try {
			return new ExpenseFilter(parseCategories(categories), from, to, blankToNull(merchant), blankToNull(text),
					parseAmount(minAmount, "minAmount"), parseAmount(maxAmount, "maxAmount"));
		}
		catch (IllegalArgumentException ex) {
			// Converted here, where the exception is known to describe the
			// request. Mapping IllegalArgumentException in an advice instead
			// would also catch server-side failures deeper in the stack and
			// report them as the caller's bad input.
			throw new InvalidExpenseQueryException(ex.getMessage(), List.of("filter"));
		}
	}

	private static Set<Category> parseCategories(List<String> names) {
		if (names == null || names.isEmpty()) {
			return Set.of();
		}
		Set<Category> categories = new LinkedHashSet<>();
		for (String name : names) {
			try {
				categories.add(Category.valueOf(name.strip().toUpperCase(Locale.ENGLISH)));
			}
			catch (IllegalArgumentException ex) {
				throw new InvalidExpenseQueryException(
						"%s is not a category. GET /api/v1/categories lists them.".formatted(name),
						List.of("category"));
			}
		}
		return categories;
	}

	private static ExpenseSort parseSort(String field) {
		try {
			return ExpenseSort.parse(field);
		}
		catch (IllegalArgumentException ex) {
			throw new InvalidExpenseQueryException(ex.getMessage(), List.of("sort"));
		}
	}

	/**
	 * Parses a decimal amount into centavos.
	 *
	 * <p>Rejects sub-centavo precision rather than rounding it, matching
	 * {@link Money#toMinorUnits}: a filter bound the server quietly moved is a
	 * filter that returns rows the caller did not ask for.
	 */
	private static Long parseAmount(String amount, String field) {
		if (amount == null || amount.isBlank()) {
			return null;
		}
		try {
			return Money.toMinorUnits(new BigDecimal(amount.strip()));
		}
		catch (IllegalArgumentException ex) {
			// NumberFormatException is an IllegalArgumentException, so one catch
			// covers both a malformed decimal and Money rejecting sub-centavo
			// precision.
			throw new InvalidExpenseQueryException("%s is not an amount: %s".formatted(field, amount), List.of(field));
		}
	}

	private static String blankToNull(String value) {
		return (value == null || value.isBlank()) ? null : value.strip();
	}

}
