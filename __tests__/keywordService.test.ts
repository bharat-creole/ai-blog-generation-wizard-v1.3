"use strict";

import { generateIntentVariations } from "../services/keywordService";

// Minimal test harness for generateIntentVariations
test("generateIntentVariations handles non-string inputs gracefully", () => {
	// Test with array (the crasher)
	expect(generateIntentVariations([1, 2, 3])).toEqual([]);

	// Test with object
	expect(generateIntentVariations({ foo: "bar" })).toEqual([]);

	// Test with null/undefined
	expect(generateIntentVariations(null)).toEqual([]);
	expect(generateIntentVariations(undefined)).toEqual([]);

	// Test with empty string
	expect(generateIntentVariations("")).toEqual([]);

	// Test with normal string
	expect(generateIntentVariations("Pomelli")).toHaveLength(4); // base + 3 intent patterns
});

test("generateIntentVariations produces expected variations", () => {
	const result = generateIntentVariations("Pomelli");
	expect(result).toContain("pomelli");
	expect(result).toContain("what is pomelli");
	expect(result).toContain("pomelli meaning");
	expect(result).toContain("pomelli explained");
});