// Wiring: keypad, keyboard, and voice. The voice path does not shortcut the
// calculator — it presses the same buttons, one at a time, visibly.

import {
  initialState, digit, decimal, operator, equals, clear, backspace,
  toggleSign, percent, completedCalculation, fromValue, display,
} from "./calculator.js";
import { parse } from "./parser.js";

const screenEl  = document.getElementById("display");
const subEl     = document.getElementById("sub");
const statusEl  = document.getElementById("status");
const micBtn    = document.getElementById("mic");
const micLabel  = document.getElementById("miclabel");
const pad       = document.querySelector(".pad");
const tapeEl    = document.getElementById("tape");
const tapeList  = document.getElementById("tapelist");
const tapeClear = document.getElementById("tapeclear");

/** Most recent last, like a paper tape. Bounded so a long session can't grow
    without limit. */
const HISTORY_LIMIT = 20;
let history = [];

let state = initialState();
let replaying = false;      // true while a spoken sequence is being pressed

// --- rendering -----------------------------------------------------------

function render() {
  const text = display(state);
  screenEl.textContent = text;
  screenEl.classList.toggle("is-error", Boolean(state.error));

  // The running expression, so a voice-driven sum is followable.
  if (state.error) {
    subEl.textContent = "";
  } else if (state.pendingOp && state.accumulator !== null) {
    const symbols = { "+": "+", "-": "−", "*": "×", "/": "÷" };
    subEl.textContent = `${state.accumulator} ${symbols[state.pendingOp]}`;
  } else {
    subEl.textContent = "";
  }
}

function renderHistory() {
  tapeEl.hidden = history.length === 0;
  tapeList.replaceChildren();

  history.forEach((item, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tape__row";
    row.dataset.index = String(index);
    row.setAttribute("aria-label", `${item.expression} equals ${item.result}. Use this result.`);

    const expr = document.createElement("span");
    expr.className = "tape__expr";
    expr.textContent = item.expression;          // textContent, never innerHTML

    const result = document.createElement("span");
    result.className = "tape__result";
    result.textContent = item.result;

    row.append(expr, result);
    const entry = document.createElement("li");
    entry.append(row);
    tapeList.append(entry);
  });

  tapeList.scrollTop = tapeList.scrollHeight;    // keep the newest in view
}

function recordCalculation(before, after) {
  const item = completedCalculation(before, after);
  if (!item) return;
  history.push(item);
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
  renderHistory();
}

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = "status" + (kind ? ` is-${kind}` : "");
}

// --- key handling --------------------------------------------------------

/** Apply one key to the state. The single place keys turn into actions. */
function applyKey(key) {
  const before = state;
  if (/^[0-9]$/.test(key))                 state = digit(state, key);
  else if (key === ".")                    state = decimal(state);
  else if (["+", "-", "*", "/"].includes(key)) state = operator(state, key);
  else if (key === "=")                    state = equals(state);
  else if (key === "C")                    state = clear(state);
  else if (key === "<")                    state = backspace(state);
  else if (key === "~")                    state = toggleSign(state);
  else if (key === "%")                    state = percent(state);
  else return false;
  if (key === "=") recordCalculation(before, state);
  render();
  return true;
}

const buttonFor = (key) => pad.querySelector(`.key[data-key="${CSS.escape(key)}"]`);

/** Flash a button as if tapped. Resolves when the flash is finished. */
function flash(key, holdMs) {
  const btn = buttonFor(key);
  if (!btn) return Promise.resolve();
  btn.classList.add("is-pressed");
  return new Promise((resolve) => {
    setTimeout(() => { btn.classList.remove("is-pressed"); resolve(); }, holdMs);
  });
}

pad.addEventListener("click", (event) => {
  const btn = event.target.closest(".key");
  if (!btn) return;
  if (replaying) return;            // ignore taps mid-replay
  if (applyKey(btn.dataset.key)) setStatus("");
});

micBtn.addEventListener("click", () => toggleListening());

tapeList.addEventListener("click", (event) => {
  const row = event.target.closest(".tape__row");
  if (!row || replaying) return;
  const item = history[Number(row.dataset.index)];
  if (!item) return;
  state = fromValue(item.result);
  render();
  setStatus("");
});

tapeClear.addEventListener("click", () => {
  if (replaying) return;
  history = [];
  renderHistory();
});

// Physical keyboard, for anyone not on a touchscreen.
window.addEventListener("keydown", (event) => {
  if (replaying) return;
  const map = {
    Enter: "=", "=": "=", Backspace: "<", Delete: "C", Escape: "C",
    c: "C", C: "C", x: "*", X: "*", n: "~", N: "~",
  };
  const key = map[event.key] ?? event.key;
  if (/^[0-9.+\-*/=%]$/.test(key) || ["C", "<", "~"].includes(key)) {
    event.preventDefault();
    applyKey(key);
    flash(key, 90);
    setStatus("");
  }
});

// --- voice ---------------------------------------------------------------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

if (!SpeechRecognition) {
  micBtn.disabled = true;
  micBtn.title = "Voice input needs Chrome or Edge";
  micLabel.textContent = "Voice unavailable";
  setStatus("Voice needs Chrome or Edge — the keypad works everywhere.");
}

function stopListening() {
  listening = false;
  micBtn.classList.remove("is-live");
  if (SpeechRecognition) micLabel.textContent = "Say a sum";
  if (recognition) { try { recognition.abort(); } catch { /* already stopped */ } }
}

function toggleListening() {
  if (!SpeechRecognition || replaying) return;
  if (listening) { stopListening(); setStatus(""); return; }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    micBtn.classList.add("is-live");
    micLabel.textContent = "Listening — tap to stop";
    setStatus("Listening…", "listening");
  };

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript ?? "";
    stopListening();
    handleTranscript(transcript);
  };

  recognition.onerror = (event) => {
    stopListening();
    const messages = {
      "no-speech": "I didn't hear anything.",
      "audio-capture": "No microphone found.",
      "not-allowed": "Microphone access was blocked.",
      "service-not-allowed": "Speech service unavailable.",
      network: "Speech recognition needs a network connection.",
      aborted: "",
    };
    const message = messages[event.error] ?? "Speech recognition failed.";
    if (message) setStatus(message, "error");
  };

  recognition.onend = () => stopListening();

  try {
    recognition.start();
  } catch {
    stopListening();
    setStatus("Could not start listening.", "error");
  }
}

/** Quote what was heard, short enough to fit the status line. */
function quote(heard) {
  const trimmed = heard.length > 40 ? `${heard.slice(0, 40)}…` : heard;
  return `"${trimmed}"`;
}

function handleTranscript(transcript) {
  const heard = transcript.trim();

  // A new utterance supersedes whatever the screen was showing. Without this,
  // a rejected phrase leaves the previous error on the display while the
  // status line explains something else entirely.
  if (state.error) { state = clear(state); render(); }

  const result = parse(heard);
  if (!result.ok) {
    setStatus(heard ? `${quote(heard)} — ${result.reason}` : result.reason, "error");
    return;
  }
  pressSequence(result.keys, heard);
}

/**
 * Press each key in turn, visibly. Always runs to completion so the display
 * can never be left stranded mid-expression.
 */
async function pressSequence(keys, heard) {
  replaying = true;
  micBtn.disabled = true;
  state = clear(state);
  render();

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const hold = reduced ? 60 : 130;
  const gap  = reduced ? 20 : 70;

  try {
    for (const key of keys) {
      applyKey(key);
      await flash(key, hold);
      await new Promise((r) => setTimeout(r, gap));
    }
    // On error the display already carries the message; leaving "Listening…"
    // in the status line would claim the mic is still open when it is not.
    setStatus(state.error ? "" : heard ? quote(heard) : "");
  } finally {
    // Runs even if something above throws, so the UI never stays locked.
    replaying = false;
    micBtn.disabled = !SpeechRecognition;
    render();
  }
}

render();
renderHistory();
