// Speech transcript -> calculator key sequence.
//
// Deliberately NOT a language model and not `eval`. A fixed word table plus a
// small grammar, so the same words always produce the same keys and anything
// unrecognised is refused with a reason the user can act on.
//
// parse("two plus two") -> { ok: true, keys: ["2", "+", "2", "="] }

const UNITS = {
  zero: 0, oh: 0, nought: 0,
  one: 1,
  two: 2, to: 2, too: 2,        // "to"/"too" are common mishearings of "two"
  three: 3,
  four: 4, for: 4,              // likewise "for" -> "four"
  five: 5, six: 6, seven: 7,
  eight: 8, ate: 8,
  nine: 9,
};
const TEENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES = { hundred: 100, thousand: 1000, million: 1000000 };

const OPERATORS = {
  plus: "+", add: "+", "+": "+",
  minus: "-", subtract: "-", less: "-", "-": "-",
  times: "*", x: "*", multiplied: "*", multiply: "*", "*": "*",
  divided: "/", divide: "/", over: "/", "/": "/",
};

// Words that carry no meaning for us and are safe to drop.
const FILLER = new Set(["by", "and", "the", "a", "um", "uh", "please", "is", "equals", "equal", "what", "s", "whats"]);

const POINT = new Set(["point", "dot", "decimal"]);

// Suffix words that press a key after a number rather than introducing one.
const PERCENT = new Set(["percent", "percentage"]);

// Words that negate the number that follows, pressing the sign-toggle key.
const NEGATE = new Set(["negative", "minus"]);

export const PARSE_ERRORS = {
  EMPTY: "I didn't catch anything. Try again.",
  NO_NUMBER: "I didn't hear a number.",
  UNKNOWN_WORD: (w) => `I don't know the word "${w}".`,
  NEEDS_OPERATOR: "Say something like \"two plus two\".",
  DANGLING_PERCENT: "I heard \"percent\" without a number.",
  TRAILING_OPERATOR: "That ended on an operator.",
  TOO_LONG: "That was too long to process.",
  TOO_MANY_DIGITS: "That number has too many digits.",
};

const MAX_TRANSCRIPT_CHARS = 200;
const MAX_DIGITS_PER_NUMBER = 12;

/** Normalise a raw transcript into comparable word tokens. */
export function tokenize(transcript) {
  return String(transcript)
    .toLowerCase()
    .replace(/[^a-z0-9.+\-*/x\s]/g, " ")   // strip anything we don't use
    .replace(/([+\-*/])/g, " $1 ")
    .split(/\s+/)
    // A dot is only meaningful inside a numeral ("3.5"). Recognisers happily
    // emit sentence punctuation, so "plus." must not read as an unknown word.
    .map((w) => (/^\d+(\.\d+)?$/.test(w) ? w : w.replace(/\./g, "")))
    .filter((w) => w.length > 0 && !FILLER.has(w));
}

/**
 * Convert leading number words into a numeric string.
 * Returns { value, rest } or null when the tokens don't start with a number.
 */
function takeNumber(tokens) {
  let i = 0;
  let total = 0;      // accumulated across scales (e.g. "two thousand")
  let current = 0;    // the group being built
  let seen = false;
  let digitsSpoken = "";   // for "one two three" read as literal digits

  // A bare numeral from the recogniser, e.g. "25" or "3.5".
  if (/^\d+(\.\d+)?$/.test(tokens[0] ?? "")) {
    const raw = tokens[0];
    if (raw.replace(/[^0-9]/g, "").length > MAX_DIGITS_PER_NUMBER) {
      return { error: PARSE_ERRORS.TOO_MANY_DIGITS };
    }
    return { value: raw, rest: tokens.slice(1) };
  }

  while (i < tokens.length) {
    const w = tokens[i];
    if (w in UNITS) {
      current += UNITS[w]; digitsSpoken += String(UNITS[w]); seen = true; i++;
    } else if (w in TEENS) {
      current += TEENS[w]; digitsSpoken = ""; seen = true; i++;
    } else if (w in TENS) {
      current += TENS[w]; digitsSpoken = ""; seen = true; i++;
    } else if (w in SCALES) {
      if (!seen) return null;
      const scale = SCALES[w];
      if (scale === 100) current *= 100;
      else { total += (current || 1) * scale; current = 0; }
      digitsSpoken = ""; i++;
    } else {
      break;
    }
  }
  if (!seen) return null;

  let whole = total + current;

  // "one two three" is three units in a row with no scale: read as digits.
  if (digitsSpoken.length > 1) whole = Number(digitsSpoken);

  let out = String(whole);

  // Optional fractional part: "three point one four".
  if (POINT.has(tokens[i] ?? "")) {
    i++;
    let frac = "";
    while (i < tokens.length && tokens[i] in UNITS) { frac += String(UNITS[tokens[i]]); i++; }
    while (i < tokens.length && /^\d+$/.test(tokens[i])) { frac += tokens[i]; i++; }
    if (frac === "") return { error: PARSE_ERRORS.NO_NUMBER };
    out += "." + frac;
  }

  if (out.replace(/[^0-9]/g, "").length > MAX_DIGITS_PER_NUMBER) {
    return { error: PARSE_ERRORS.TOO_MANY_DIGITS };
  }
  return { value: out, rest: tokens.slice(i) };
}

/** Consume any run of "percent" words, pressing % for each. */
function takePercent(tokens, keys) {
  let i = 0;
  while (i < tokens.length && PERCENT.has(tokens[i])) { keys.push("%"); i++; }
  return tokens.slice(i);
}

/** Turn a numeric string into individual key presses. */
function keysFor(numStr) {
  return numStr.split("").filter((c) => /[0-9.]/.test(c));
}

/**
 * Parse a transcript into a key sequence.
 * Always returns { ok: true, keys } or { ok: false, reason }. Never throws.
 */
export function parse(transcript) {
  if (transcript === null || transcript === undefined) return { ok: false, reason: PARSE_ERRORS.EMPTY };
  const raw = String(transcript);
  if (raw.length > MAX_TRANSCRIPT_CHARS) return { ok: false, reason: PARSE_ERRORS.TOO_LONG };

  const tokens = tokenize(raw);
  if (tokens.length === 0) return { ok: false, reason: PARSE_ERRORS.EMPTY };

  const keys = [];
  let rest = tokens;

  // "minus five" / "negative five" is a negative first operand. Now that the
  // keypad has a sign-toggle key, press what a person would press: 5 then +/-.
  let negateFirst = false;
  if (NEGATE.has(rest[0])) {
    negateFirst = true;
    rest = rest.slice(1);
  }

  if (rest.length === 0) return { ok: false, reason: PARSE_ERRORS.NO_NUMBER };

  const first = takeNumber(rest);
  if (first === null) {
    const w = rest[0];
    if (PERCENT.has(w)) return { ok: false, reason: PARSE_ERRORS.DANGLING_PERCENT };
    return { ok: false, reason: OPERATORS[w] ? PARSE_ERRORS.NEEDS_OPERATOR : PARSE_ERRORS.UNKNOWN_WORD(w) };
  }
  if (first.error) return { ok: false, reason: first.error };
  keys.push(...keysFor(first.value));
  if (negateFirst) keys.push("~");
  rest = first.rest;
  rest = takePercent(rest, keys);

  // Then zero or more (operator, number) pairs.
  while (rest.length > 0) {
    const opWord = rest[0];
    const op = OPERATORS[opWord];
    if (!op) return { ok: false, reason: PARSE_ERRORS.UNKNOWN_WORD(opWord) };
    rest = rest.slice(1);
    if (rest.length === 0) return { ok: false, reason: PARSE_ERRORS.TRAILING_OPERATOR };

    // "minus" doubles as a negation here: "ten plus minus three".
    let negate = false;
    if (NEGATE.has(rest[0]) && OPERATORS[rest[0]] !== op) { negate = true; rest = rest.slice(1); }
    if (rest.length === 0) return { ok: false, reason: PARSE_ERRORS.TRAILING_OPERATOR };

    const next = takeNumber(rest);
    if (next === null) {
      const w = rest[0];
      if (PERCENT.has(w)) return { ok: false, reason: PARSE_ERRORS.DANGLING_PERCENT };
      return { ok: false, reason: OPERATORS[w] ? PARSE_ERRORS.NEEDS_OPERATOR : PARSE_ERRORS.UNKNOWN_WORD(w) };
    }
    if (next.error) return { ok: false, reason: next.error };
    keys.push(op, ...keysFor(next.value));
    if (negate) keys.push("~");
    rest = next.rest;
    rest = takePercent(rest, keys);
  }

  keys.push("=");
  return { ok: true, keys };
}
