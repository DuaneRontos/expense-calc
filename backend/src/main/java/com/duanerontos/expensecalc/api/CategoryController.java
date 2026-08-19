package com.duanerontos.expensecalc.api;

import java.util.Arrays;
import java.util.List;

import com.duanerontos.expensecalc.expense.Category;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/v1/categories} — the taxonomy with display labels (spec §8).
 *
 * <p>Exists so the client never hardcodes the taxonomy. A hardcoded copy drifts
 * the first time a label changes, and drifts silently: the picker keeps showing
 * the old word while every report shows the new one.
 *
 * <p>Served in declaration order, which is the taxonomy's own order rather than
 * alphabetical — the same order {@code sort=category} produces, so a picker and
 * a sorted list agree.
 */
@RestController
@RequestMapping("/api/v1/categories")
public class CategoryController {

	/**
	 * @param key the enum name, which is what every other endpoint accepts and
	 *     returns
	 * @param label the display name
	 */
	public record CategoryView(String key, String label) {
	}

	@GetMapping
	public ResponseEntity<List<CategoryView>> list() {
		return ResponseEntity.ok(Arrays.stream(Category.values())
			.map(category -> new CategoryView(category.name(), category.getLabel()))
			.toList());
	}

}
