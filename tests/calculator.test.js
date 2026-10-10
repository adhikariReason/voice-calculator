import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState, digit, decimal, operator, equals, clear, backspace,
  toggleSign, percent, completedCalculation, fromValue,
  display, apply, ERRORS, MAX_DIGITS,
} from "../src/calculator.js";

/** Drive the calculator with a compact script, as the UI/voice layers do. */
function run(seq) {
  let s = initialState();
  for (const k of seq) {
    if (/^[0-9]$/.test(k)) s = digit(s, k);
    else if (k === ".") s = decimal(s);
    else if (["+", "-", "*", "/"].includes(k)) s = operator(s, k);
    else if (k === "=") s = equals(s);
    else if (k === "C") s = clear(s);
    else if (k === "<") s = backspace(s);
    else if (k === "~") s = toggleSign(s);
    else if (k === "%") s = percent(s);
    else throw new Error(`bad key in test script: ${k}`);
  }
  return s;
}
const shows = (seq) => display(run(seq));

test("starts at zero", () => {
  assert.equal(display(initialState()), "0");
});

test("the four operations", () => {
  assert.equal(shows(["2", "+", "2", "="]), "4");
  assert.equal(shows(["9", "-", "4", "="]), "5");
  assert.equal(shows(["6", "*", "7", "="]), "42");
  assert.equal(shows(["8", "/", "2", "="]), "4");
});

test("negative and fractional results", () => {
  assert.equal(shows(["3", "-", "8", "="]), "-5");
  assert.equal(shows(["1", "/", "4", "="]), "0.25");
});

test("float noise is tidied, as a phone calculator does", () => {
  assert.equal(shows([".", "1", "+", ".", "2", "="]), "0.3");
  assert.equal(shows(["2", ".", "6", "7", "5", "*", "1", "0", "0", "="]), "267.5");
});

test("leading zero is replaced, not appended", () => {
  assert.equal(shows(["0", "5"]), "5");
});

test("only one decimal point is accepted", () => {
  assert.equal(shows(["1", ".", "5", ".", "2"]), "1.52");
});

test("decimal with no leading digit", () => {
  assert.equal(shows([".", "5"]), "0.5");
});

test("chained operations evaluate left to right", () => {
  assert.equal(shows(["2", "+", "3", "*", "4", "="]), "20"); // (2+3)*4, like a phone
});

test("pressing a second operator replaces the first", () => {
  assert.equal(shows(["8", "+", "*", "2", "="]), "16");
});

test("equals with no pending operation normalises the entry", () => {
  assert.equal(shows(["5", "="]), "5");
  assert.equal(shows(["5", ".", "="]), "5");
});

test("repeated equals does not re-apply the operation", () => {
  assert.equal(shows(["2", "+", "3", "=", "="]), "5");
});

test("a digit after equals starts a fresh entry", () => {
  assert.equal(shows(["2", "+", "3", "=", "7"]), "7");
});

test("divide by zero reports, does not crash or yield Infinity", () => {
  const s = run(["5", "/", "0", "="]);
  assert.equal(s.error, ERRORS.DIV_ZERO);
  assert.equal(display(s), ERRORS.DIV_ZERO);
});

test("zero divided by zero is reported too", () => {
  assert.equal(run(["0", "/", "0", "="]).error, ERRORS.DIV_ZERO);
});

test("a digit clears an error and starts over", () => {
  assert.equal(shows(["5", "/", "0", "=", "3"]), "3");
});

test("clear recovers from an error", () => {
  assert.equal(shows(["5", "/", "0", "=", "C"]), "0");
});

test("operators are ignored while in an error state", () => {
  const s = run(["5", "/", "0", "=", "+"]);
  assert.equal(s.error, ERRORS.DIV_ZERO);
});

test("overflow is caught rather than shown as Infinity", () => {
  const big = apply(1e308, 10, "*");
  assert.equal(big.error, ERRORS.OVERFLOW);
});

test("entry length is capped", () => {
  const many = Array(MAX_DIGITS + 8).fill("9");
  const s = run(many);
  assert.equal(s.entry.replace(/[^0-9]/g, "").length, MAX_DIGITS);
});

test("very large and very small results use exponential notation", () => {
  // 9999999 * 9999999 = 99999980000001, past the 1e12 display threshold.
  assert.match(shows([..."9999999", "*", ..."9999999", "="]), /e/);
  // Just under the threshold must stay in plain notation.
  assert.equal(shows([..."999999", "*", ..."999999", "="]), "999998000001");
  assert.match(shows(["1", "/", "9", "9", "9", "9", "9", "9", "9", "9", "9", "9", "="]), /e/);
});

test("backspace deletes one character", () => {
  assert.equal(shows(["1", "2", "3", "<"]), "12");
});

test("backspace to empty leaves zero, not an empty display", () => {
  assert.equal(shows(["7", "<"]), "0");
  assert.equal(shows(["7", "<", "<", "<"]), "0");
});

test("backspace on a fresh state is harmless", () => {
  assert.equal(shows(["<"]), "0");
  assert.equal(shows(["C", "<", "<"]), "0");
});

test("backspace after an error resets", () => {
  assert.equal(shows(["5", "/", "0", "=", "<"]), "0");
});

test("clear resets every field", () => {
  assert.deepEqual(run(["5", "+", "3", "C"]), initialState());
});

test("actions are pure: the input state is never mutated", () => {
  const s = initialState();
  const frozen = JSON.stringify(s);
  digit(s, "5"); operator(s, "+"); equals(s); backspace(s); decimal(s);
  assert.equal(JSON.stringify(s), frozen);
});

test("non-digit and junk input is rejected, not interpreted", () => {
  const s = initialState();
  for (const junk of ["a", "", " ", "12", "-", "<script>", null, undefined, {}, [], NaN, 1.5]) {
    assert.equal(digit(s, junk).entry, "0", `digit(${String(junk)}) changed the entry`);
  }
});

test("unknown operators are rejected", () => {
  const s = initialState();
  for (const junk of ["^", "%", "", null, undefined, "**", "+-"]) {
    assert.equal(operator(s, junk).pendingOp, null);
  }
  assert.equal(apply(1, 2, "^").error, ERRORS.UNDEFINED);
});

test("apply rejects non-finite operands", () => {
  assert.equal(apply(Infinity, 1, "+").error, ERRORS.UNDEFINED);
  assert.equal(apply(NaN, 1, "+").error, ERRORS.UNDEFINED);
});

test("display never throws, whatever the state", () => {
  const nasties = [
    { ...initialState(), entry: "" },
    { ...initialState(), entry: "abc" },
    { ...initialState(), entry: "NaN" },
    { ...initialState(), entry: "Infinity" },
    { ...initialState(), entry: "1e999" },
  ];
  for (const s of nasties) assert.equal(typeof display(s), "string");
});

// --- sign toggle ---------------------------------------------------------

test("sign toggle flips a positive entry and back", () => {
  assert.equal(shows(["5", "~"]), "-5");
  assert.equal(shows(["5", "~", "~"]), "5");
});

test("sign toggle leaves zero alone (there is no negative zero)", () => {
  assert.equal(shows(["~"]), "0");
  assert.equal(shows(["0", "~"]), "0");
  assert.equal(shows(["C", "~", "~"]), "0");
});

test("a negated entry still computes correctly", () => {
  assert.equal(shows(["5", "~", "+", "3", "="]), "-2");
  assert.equal(shows(["6", "*", "7", "~", "="]), "-42");
  assert.equal(shows(["8", "~", "/", "2", "~", "="]), "4");
});

test("digits append to a negated entry rather than restarting it", () => {
  assert.equal(shows(["5", "~", "2"]), "-52");
});

test("backspace works through a negated entry without leaving a bare minus", () => {
  assert.equal(shows(["5", "~", "<"]), "0");
  assert.equal(shows(["5", "2", "~", "<"]), "-5");
});

test("sign toggle is ignored during an error", () => {
  assert.equal(run(["5", "/", "0", "=", "~"]).error, ERRORS.DIV_ZERO);
});

test("sign toggle on a decimal entry", () => {
  assert.equal(shows(["1", ".", "5", "~"]), "-1.5");
});

// --- percent -------------------------------------------------------------

test("percent of a standalone number divides by a hundred", () => {
  assert.equal(shows(["5", "0", "%"]), "0.5");
  assert.equal(shows(["8", "%"]), "0.08");
});

test("percent with a pending add takes a percentage of the accumulator", () => {
  assert.equal(shows(["2", "0", "0", "+", "1", "0", "%"]), "20");
  assert.equal(shows(["2", "0", "0", "+", "1", "0", "%", "="]), "220");
});

test("percent with a pending subtract behaves the same way", () => {
  assert.equal(shows(["2", "0", "0", "-", "1", "0", "%", "="]), "180");
});

test("percent with multiply or divide is a plain division by a hundred", () => {
  assert.equal(shows(["2", "0", "0", "*", "1", "0", "%", "="]), "20");
  assert.equal(shows(["2", "0", "0", "/", "5", "0", "%", "="]), "400");
});

test("percent is ignored during an error", () => {
  assert.equal(run(["5", "/", "0", "=", "%"]).error, ERRORS.DIV_ZERO);
});

test("percent of zero is zero, not an error", () => {
  assert.equal(shows(["0", "%"]), "0");
});

test("repeated percent keeps dividing", () => {
  assert.equal(shows(["1", "0", "0", "%", "%"]), "0.01");
});

test("percent and sign toggle compose", () => {
  assert.equal(shows(["5", "0", "~", "%"]), "-0.5");
});

test("new actions are pure too", () => {
  const s = run(["2", "0", "0", "+", "1", "0"]);
  const frozen = JSON.stringify(s);
  toggleSign(s); percent(s);
  assert.equal(JSON.stringify(s), frozen);
});

// --- history tape --------------------------------------------------------

/** Run a script, returning the state just before the final key and just after. */
function aroundLast(seq) {
  const before = run(seq.slice(0, -1));
  const after = run(seq);
  return [before, after];
}

test("a completed calculation describes what was computed", () => {
  const [b, a] = aroundLast(["2", "+", "2", "="]);
  assert.deepEqual(completedCalculation(b, a), { expression: "2 + 2", result: "4" });
});

test("each operator gets its proper symbol", () => {
  assert.equal(completedCalculation(...aroundLast(["9", "-", "4", "="])).expression, "9 \u2212 4");
  assert.equal(completedCalculation(...aroundLast(["6", "*", "7", "="])).expression, "6 \u00d7 7");
  assert.equal(completedCalculation(...aroundLast(["8", "/", "2", "="])).expression, "8 \u00f7 2");
});

test("a chained sum records the step that equals actually completed", () => {
  // 2 + 3 makes 5, then * 4: the completed step is 5 x 4.
  const [b, a] = aroundLast(["2", "+", "3", "*", "4", "="]);
  assert.deepEqual(completedCalculation(b, a), { expression: "5 \u00d7 4", result: "20" });
});

test("nothing is recorded when nothing was computed", () => {
  assert.equal(completedCalculation(...aroundLast(["5", "="])), null);
  assert.equal(completedCalculation(...aroundLast(["="])), null);
});

test("an error is not recorded as a calculation", () => {
  assert.equal(completedCalculation(...aroundLast(["5", "/", "0", "="])), null);
});

test("a negated or percentage operand is recorded as the number used", () => {
  assert.equal(completedCalculation(...aroundLast(["5", "+", "3", "~", "="])).expression, "5 + -3");
  assert.equal(completedCalculation(...aroundLast(["2", "0", "0", "+", "1", "0", "%", "="])).expression, "200 + 20");
});

test("float noise does not leak into the recorded expression", () => {
  const [b, a] = aroundLast([".", "1", "+", ".", "2", "="]);
  assert.deepEqual(completedCalculation(b, a), { expression: "0.1 + 0.2", result: "0.3" });
});

test("completedCalculation is defensive about junk", () => {
  assert.equal(completedCalculation(null, null), null);
  assert.equal(completedCalculation(undefined, initialState()), null);
  assert.equal(completedCalculation(initialState(), undefined), null);
  assert.equal(completedCalculation({}, {}), null);
});

test("completedCalculation does not mutate either state", () => {
  const [b, a] = aroundLast(["2", "+", "2", "="]);
  const frozen = [JSON.stringify(b), JSON.stringify(a)];
  completedCalculation(b, a);
  assert.deepEqual([JSON.stringify(b), JSON.stringify(a)], frozen);
});

// --- recall --------------------------------------------------------------

test("fromValue produces a clean state showing that value", () => {
  const s = fromValue("42");
  assert.equal(display(s), "42");
  assert.equal(s.pendingOp, null);
  assert.equal(s.accumulator, null);
  assert.equal(s.error, null);
});

test("a recalled value can be used straight away", () => {
  let s = fromValue("42");
  s = operator(s, "+"); s = digit(s, "8"); s = equals(s);
  assert.equal(display(s), "50");
});

test("a recalled value is replaced by the next digit, not appended to", () => {
  let s = fromValue("42");
  s = digit(s, "7");
  assert.equal(display(s), "7");
});

test("fromValue rejects junk rather than showing NaN", () => {
  for (const junk of ["", "abc", NaN, Infinity, null, undefined, {}, []]) {
    assert.equal(display(fromValue(junk)), "0", `fromValue(${String(junk)})`);
  }
});
