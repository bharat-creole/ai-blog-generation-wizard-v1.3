"use strict";

declare const test: (name: string, fn: () => void) => void;
declare const expect: any;

import {
	__internal_cleanAndParseJson,
	__internal_extractFirstJsonValue,
} from "../services/geminiService";

test("__internal_extractFirstJsonValue extracts first JSON array from fenced response with trailing text", () => {
	const input = "```json\n[ {\"a\": 1}, {\"b\": 2} ]\n```\nextra";
	expect(__internal_extractFirstJsonValue(input)).toBe('[ {"a": 1}, {"b": 2} ]');
});

test("__internal_cleanAndParseJson parses fenced JSON", () => {
	const input = "```json\n[{\"text\":\"k\",\"volume\":100,\"difficulty\":0.5}]\n```";
	expect(__internal_cleanAndParseJson(input)).toEqual([
		{ text: "k", volume: 100, difficulty: 0.5 },
	]);
});

test("__internal_cleanAndParseJson parses when JSON is embedded in prose", () => {
	const input =
		"Here you go:\n\n```json\n[{\"x\":1}]\n```\n\nThanks!";
	expect(__internal_cleanAndParseJson(input)).toEqual([{ x: 1 }]);
});

test("__internal_cleanAndParseJson parses raw JSON with trailing backticks and quotes", () => {
	const input = "[{\"x\":1}]```\n\"";
	expect(__internal_cleanAndParseJson(input)).toEqual([{ x: 1 }]);
});
