import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, tokenize, PARSE_ERRORS } from "../src/parser.js";
import { initialState, digit, decimal, operator, equals, toggleSign, percent, display } from "../src/calculator.js";

const keys = (t) => { const r = parse(t); assert.ok(r.ok, `expected "${t}" to parse, got: ${r.reason}`); return r.keys.join(" "); };
const reject = (t) => { const r = parse(t); assert.equal(r.ok, false, `expected "${t}" to be rejected`); return r.reason; };

/** Feed a parsed key sequence through the real calculator. */
function evaluate(transcript) {
  const r = parse(transcript);
  assert.ok(r.ok, r.reason);
  let s = initialState();
  for (const k of r.keys) {
    if (/^[0-9]$/.test(k)) s = digit(s, k);
    else if (k === ".") s = decimal(s);
    else if (k === "=") s = equals(s);
    else if (k === "~") s = toggleSign(s);
    else if (k === "%") s = percent(s);
    else s = operator(s, k);
  }
  return display(s);
}

test("the headline case from the spec", () => {
  assert.equal(keys("two plus two"), "2 + 2 =");
  assert.equal(evaluate("two plus two"), "4");
});

test("all four operations by word", () => {
  assert.equal(evaluate("nine minus four"), "5");
  assert.equal(evaluate("six times seven"), "42");
  assert.equal(evaluate("eight divided by two"), "4");
  assert.equal(evaluate("three plus five"), "8");
});

test("operator synonyms", () => {
  for (const t of ["two times three", "two x three", "two multiplied by three"]) {
    assert.equal(evaluate(t), "6", t);
  }
  for (const t of ["six over two", "six divided by two", "six divide by two"]) {
    assert.equal(evaluate(t), "3", t);
  }
});

test("tens, teens and compound numbers", () => {
  assert.equal(evaluate("twenty five times four"), "100");
  assert.equal(evaluate("fifteen plus five"), "20");
  assert.equal(evaluate("one hundred twenty three plus one"), "124");
  assert.equal(evaluate("two thousand plus one"), "2001");
});

test("digits spoken one by one", () => {
  assert.equal(keys("one two three plus one"), "1 2 3 + 1 =");
});

test("bare numerals from the recogniser", () => {
  assert.equal(evaluate("25 plus 4"), "29");
  assert.equal(evaluate("3.5 plus 1.5"), "5");
});

test("decimals by word", () => {
  assert.equal(keys("three point one four plus one"), "3 . 1 4 + 1 =");
  assert.equal(evaluate("one point five plus one point five"), "3");
});

test("a leading minus presses the sign-toggle key, as a person would", () => {
  assert.equal(keys("minus five plus ten"), "5 ~ + 1 0 =");
  assert.equal(evaluate("minus five plus ten"), "5");
});

test("a single number is valid", () => {
  assert.equal(keys("five"), "5 =");
});

test("chained expressions", () => {
  assert.equal(keys("one plus two plus three"), "1 + 2 + 3 =");
  assert.equal(evaluate("one plus two plus three"), "6");
});

test("filler words are ignored", () => {
  assert.equal(evaluate("um what is two plus two please"), "4");
  assert.equal(evaluate("two plus two equals"), "4");
});

test("common mishearings are accepted", () => {
  assert.equal(evaluate("to plus to"), "4");     // "two plus two"
  assert.equal(evaluate("for plus for"), "8");   // "four plus four"
});

test("case and punctuation do not matter", () => {
  assert.equal(evaluate("TWO PLUS TWO!"), "4");
  assert.equal(evaluate("Two, plus. two?"), "4");
});

// --- hostile input -------------------------------------------------------

test("empty and whitespace-only input is refused clearly", () => {
  assert.equal(reject(""), PARSE_ERRORS.EMPTY);
  assert.equal(reject("   "), PARSE_ERRORS.EMPTY);
  assert.equal(reject(null), PARSE_ERRORS.EMPTY);
  assert.equal(reject(undefined), PARSE_ERRORS.EMPTY);
});

test("unknown words are named back to the user", () => {
  assert.match(reject("banana plus two"), /banana/);
  assert.match(reject("two plus banana"), /banana/);
});

test("a trailing operator is refused", () => {
  assert.equal(reject("two plus"), PARSE_ERRORS.TRAILING_OPERATOR);
  assert.equal(reject("seven times"), PARSE_ERRORS.TRAILING_OPERATOR);
});

test("two operators in a row are refused", () => {
  assert.equal(reject("two plus times three"), PARSE_ERRORS.NEEDS_OPERATOR);
});

test("an over-long transcript is refused rather than processed", () => {
  assert.equal(reject("two plus ".repeat(60) + "two"), PARSE_ERRORS.TOO_LONG);
});

test("absurdly long numbers are refused", () => {
  assert.equal(reject("1234567890123456 plus one"), PARSE_ERRORS.TOO_MANY_DIGITS);
  assert.equal(reject("one ".repeat(20) + "plus one"), PARSE_ERRORS.TOO_MANY_DIGITS);
});

test("divide by zero parses, and the calculator reports it", () => {
  assert.equal(keys("nine divided by zero"), "9 / 0 =");
  assert.match(evaluate("nine divided by zero"), /divide by zero/i);
});

test("injection attempts are not executed and not echoed as code", () => {
  for (const nasty of [
    "<script>alert(1)</script>",
    "'; DROP TABLE users; --",
    "{{7*7}}",
    "${process.exit(1)}",
    "../../etc/passwd",
    "2 + 2; rm -rf /",
  ]) {
    const r = parse(nasty);
    if (r.ok) {
      // If it parses at all, it may only have produced calculator keys.
      for (const k of r.keys) assert.match(k, /^[0-9.+\-*/=]$/, `leaked key ${k} from ${nasty}`);
    } else {
      assert.equal(typeof r.reason, "string");
      assert.doesNotMatch(r.reason, /<script|DROP TABLE/i, "error message echoed the payload verbatim");
    }
  }
});

test("unicode, emoji and control characters do not crash the parser", () => {
  for (const nasty of ["two ➕ two", "٢ plus ٢", "two\u0000plus\u0000two", "🙂🙂🙂", "two\nplus\ntwo", "‮two plus two"]) {
    const r = parse(nasty);
    assert.equal(typeof r.ok, "boolean");
    if (!r.ok) assert.equal(typeof r.reason, "string");
  }
});

test("parse never throws, for any input type", () => {
  for (const junk of [null, undefined, 0, 1, -1, NaN, true, false, {}, [], [1, 2], () => {}, Symbol.iterator]) {
    assert.doesNotThrow(() => parse(junk), `threw on ${String(junk)}`);
  }
});

test("parse always returns a usable shape", () => {
  for (const t of ["two plus two", "banana", "", "two plus"]) {
    const r = parse(t);
    assert.equal(typeof r.ok, "boolean");
    if (r.ok) assert.ok(Array.isArray(r.keys)); else assert.equal(typeof r.reason, "string");
  }
});

test("tokenize drops filler and splits glued operators", () => {
  assert.deepEqual(tokenize("two+two"), ["two", "+", "two"]);
  assert.deepEqual(tokenize("  TWO   plus  TWO  "), ["two", "plus", "two"]);
});

// --- voice parity with the keypad ----------------------------------------

test("percent after a number presses the percent key", () => {
  assert.equal(keys("fifty percent"), "5 0 % =");
  assert.equal(evaluate("fifty percent"), "0.5");
});

test("percent follows phone semantics through the calculator", () => {
  assert.equal(keys("two hundred plus ten percent"), "2 0 0 + 1 0 % =");
  assert.equal(evaluate("two hundred plus ten percent"), "220");
  assert.equal(evaluate("two hundred minus ten percent"), "180");
});

test("\"percentage\" is accepted as well", () => {
  assert.equal(evaluate("fifty percentage"), "0.5");
});

test("repeated percent presses the key twice", () => {
  assert.equal(keys("one hundred percent percent"), "1 0 0 % % =");
  assert.equal(evaluate("one hundred percent percent"), "0.01");
});

test("negative is a synonym for a leading minus", () => {
  assert.equal(keys("negative five plus ten"), "5 ~ + 1 0 =");
  assert.equal(evaluate("negative five plus ten"), "5");
});

test("a negated second operand", () => {
  assert.equal(keys("ten plus minus three"), "1 0 + 3 ~ =");
  assert.equal(evaluate("ten plus minus three"), "7");
  assert.equal(evaluate("ten plus negative three"), "7");
});

test("subtraction still parses as subtraction, not negation", () => {
  assert.equal(keys("ten minus three"), "1 0 - 3 =");
  assert.equal(evaluate("ten minus three"), "7");
});

test("percent with no number is refused clearly", () => {
  assert.equal(reject("percent"), PARSE_ERRORS.DANGLING_PERCENT);
  assert.equal(reject("two plus percent"), PARSE_ERRORS.DANGLING_PERCENT);
});

test("a bare negation word is refused", () => {
  assert.equal(reject("negative"), PARSE_ERRORS.NO_NUMBER);
  assert.equal(reject("minus"), PARSE_ERRORS.NO_NUMBER);
});

test("every emitted key is one the keypad actually has", () => {
  const padKeys = new Set(["0","1","2","3","4","5","6","7","8","9",".","+","-","*","/","=","~","%","C","<"]);
  for (const t of ["two plus two", "fifty percent", "negative five plus ten",
                   "two hundred plus ten percent", "ten plus minus three",
                   "three point one four", "one hundred percent percent"]) {
    const r = parse(t);
    assert.ok(r.ok, t);
    for (const k of r.keys) assert.ok(padKeys.has(k), `key "${k}" from "${t}" is not on the keypad`);
  }
});
