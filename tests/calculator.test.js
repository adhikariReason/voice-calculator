import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState, digit, decimal, operator, equals, clear, backspace,
  toggleSign, percent, display, apply, ERRORS, MAX_DIGITS,
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
