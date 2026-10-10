// Calculator core: a pure state machine. No DOM, no eval, no globals.
//
// Every exported action takes a state and returns a NEW state. The UI holds the
// current state and re-renders from it; the voice layer drives the exact same
// actions, which is what lets a spoken expression press real buttons.

export const MAX_DIGITS = 12;

// Significant digits kept before display. JavaScript doubles give
// 0.1 + 0.2 = 0.30000000000000004; a phone calculator shows 0.3.
const PRECISION = 12;

export const ERRORS = {
  DIV_ZERO: "Cannot divide by zero",
  OVERFLOW: "Number too large",
  UNDEFINED: "Result is undefined",
};

export function initialState() {
  return {
    entry: "0",        // what the display shows while typing
    accumulator: null, // the left-hand operand, once an operator is pressed
    pendingOp: null,   // "+" | "-" | "*" | "/"
    replaceEntry: true,// next digit replaces rather than appends
    error: null,       // non-null freezes everything except clear/digit
  };
}

/** Round away float noise without lying about genuinely long numbers. */
function tidy(n) {
  if (!Number.isFinite(n)) return n;
  if (Number.isInteger(n)) return n;
  return parseFloat(n.toPrecision(PRECISION));
}

function countDigits(entry) {
  return entry.replace(/[^0-9]/g, "").length;
}

export function digit(state, d) {
  const ch = String(d);
  if (!/^[0-9]$/.test(ch)) return state;          // reject anything not 0-9
  if (state.error) state = initialState();        // a digit clears an error

  if (state.replaceEntry) {
    return { ...state, entry: ch, replaceEntry: false };
  }
  if (countDigits(state.entry) >= MAX_DIGITS) return state;   // cap length
  const entry = state.entry === "0" ? ch : state.entry + ch;
  return { ...state, entry };
}

export function decimal(state) {
  if (state.error) state = initialState();
  if (state.replaceEntry) return { ...state, entry: "0.", replaceEntry: false };
  if (state.entry.includes(".")) return state;    // only one point
  return { ...state, entry: state.entry + "." };
}

export function operator(state, op) {
  if (!["+", "-", "*", "/"].includes(op)) return state;
  if (state.error) return state;                  // must clear first

  // Pressing a second operator replaces the first rather than stacking.
  if (state.pendingOp !== null && state.replaceEntry) {
    return { ...state, pendingOp: op };
  }

  const current = parseFloat(state.entry);
  if (state.pendingOp === null || state.accumulator === null) {
    return { ...state, accumulator: current, pendingOp: op, replaceEntry: true };
  }

  const result = apply(state.accumulator, current, state.pendingOp);
  if (result.error) return { ...initialState(), error: result.error };
  return {
    ...state,
    entry: String(result.value),
    accumulator: result.value,
    pendingOp: op,
    replaceEntry: true,
  };
}

export function equals(state) {
  if (state.error) return state;
  if (state.pendingOp === null || state.accumulator === null) {
    // "5 =" is just 5, but normalise the entry (e.g. "5." -> "5").
    return { ...state, entry: String(tidy(parseFloat(state.entry))), replaceEntry: true };
  }
  const result = apply(state.accumulator, parseFloat(state.entry), state.pendingOp);
  if (result.error) return { ...initialState(), error: result.error };
  return {
    ...initialState(),
    entry: String(result.value),
    replaceEntry: true,
  };
}

export function clear(state) {
  return initialState();
}

export function backspace(state) {
  if (state.error) return initialState();
  if (state.replaceEntry) return state;           // nothing typed yet to delete
  const trimmed = state.entry.slice(0, -1);
  if (trimmed === "" || trimmed === "-") {
    return { ...state, entry: "0", replaceEntry: true };
  }
  return { ...state, entry: trimmed };
}

/** The arithmetic itself. Returns {value} or {error}. */
export function apply(a, b, op) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: ERRORS.UNDEFINED };
  let value;
  switch (op) {
    case "+": value = a + b; break;
    case "-": value = a - b; break;
    case "*": value = a * b; break;
    case "/":
      if (b === 0) return { error: ERRORS.DIV_ZERO };
      value = a / b;
      break;
    default: return { error: ERRORS.UNDEFINED };
  }
  value = tidy(value);
  if (!Number.isFinite(value)) return { error: ERRORS.OVERFLOW };
  return { value };
}

/** What the display shows for a given state. Always a string, never throws. */
export function display(state) {
  if (state.error) return state.error;
  const n = parseFloat(state.entry);
  if (!Number.isFinite(n)) return ERRORS.OVERFLOW;

  // Keep the raw string while typing so trailing "." and "0." survive.
  if (!state.replaceEntry) return state.entry;

  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) {
    return n.toExponential(6).replace(/e\+?/, "e");
  }
  return String(tidy(n));
}
