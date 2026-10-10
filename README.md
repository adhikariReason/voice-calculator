# Voice Calculator

A calculator that looks and behaves like the one on your phone, and can also be
driven by speech. Say "two plus two" and it presses `2`, `+`, `2`, `=` on
screen — visibly, one key at a time — exactly as if you had tapped them.

The voice layer is not AI. It is the browser's built-in speech recognition,
then a fixed word table and a small grammar, then ordinary calculator logic.
No API keys, no network calls of our own, no `eval`.

## Running it

It is a static site with no build step and no dependencies. ES modules need to
be served over HTTP (opening `index.html` as a `file://` URL will not work):

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Using it

**By tap or keyboard.** The keypad works on its own — voice is never required.
It has the keys a phone calculator has: the four operations, `±`, `%`, a
decimal point, clear and backspace.

From a physical keyboard: digits, `.`, `+`, `-`, `*`, `/`, `%`, `n` (toggle
sign), `Enter` (equals), `Backspace`, and `Esc` (clear).

**History.** Completed sums collect in a tape above the display. Tap any row to
pull that result back into the display and keep working with it; `Clear` empties
the tape. It holds the last 20 and is not written to disk, so it goes away when
you close the page.

`%` behaves the way phone calculators do rather than the way a plain division
would: with a pending `+` or `-` it takes that percentage *of the running
total*, so `200 + 10 % =` gives `220`. With `×` or `÷` it is simply a division
by a hundred, so `200 × 10 % =` gives `20`.

**By voice.** Press the blue microphone and speak an expression. Examples that
work:

| You say | It presses |
| --- | --- |
| "two plus two" | `2 + 2 =` |
| "twenty five times four" | `2 5 * 4 =` |
| "three point one four plus one" | `3 . 1 4 + 1 =` |
| "minus five plus ten" | `0 - 5 + 1 0 =` |
| "one hundred twenty three plus one" | `1 2 3 + 1 =` |
| "fifty percent" | `5 0 % =` |
| "two hundred plus ten percent" | `2 0 0 + 1 0 % =` |
| "ten plus negative three" | `1 0 + 3 ± =` |

Synonyms are accepted (`x`, `times`, `multiplied by`; `over`, `divided by`),
filler words are ignored ("um, what is two plus two please"), and common
mishearings are mapped (`to`/`too` → two, `for` → four).

Voice covers everything the keypad does except clear and backspace: speaking a
new expression replaces what was there, so they are not needed.

Anything it cannot read is refused with a reason, never guessed at: an unknown
word is named back to you, a phrase ending on an operator is rejected, and
silence says so.

### Browser support

Voice input uses the Web Speech API, which today means **Chrome or Edge on
desktop**. Safari's support is partial and Firefox has none. In any browser
without it the microphone button is disabled with an explanation and the
calculator remains fully usable by tap and keyboard. Chrome also sends audio to
Google's speech service for recognition, so voice input needs a network
connection; nothing else in this app does.

## How it was tested

**Automated.** 94 tests covering the calculator state machine and the parser,
using Node's built-in test runner (Node 18+, no dependencies to install):

```bash
node --test
```

These cover the four operations, chaining, float tidying (`0.1 + 0.2` shows
`0.3`), the 12-digit cap, divide by zero, overflow, backspace and clear
behaviour, sign toggle and percent (including their interaction with a pending
operator), purity of the state functions, and the parser's full vocabulary. One
test asserts that every key the parser can emit is a key the keypad actually
has, so voice and tap cannot drift apart. The history tape's record is built
from the calculator state either side of `=`, so it is also covered by those
tests rather than by reconstructing keystrokes.

**Hostile input.** Every input is treated as hostile. The suite and a manual
in-browser battery cover: empty and whitespace-only speech, unknown words,
trailing and doubled operators, 390-character utterances, 16-digit numbers,
injection payloads (`<script>`, SQL, template and path traversal), unicode,
emoji, RTL marks and null bytes, operator/digit/equals/backspace spam, and
repeated multiplication to overflow. Every case is refused or sanitised with a
message, and none crashes, hangs, leaks or executes. The display holds text
only — it never has markup written into it.

**By hand, in a browser.** The tap path, the voice replay (with a stubbed
recogniser), light and dark themes, and 375px phone width with no horizontal
overflow.

## Layout

```
index.html          markup
styles.css          one type scale, one spacing scale, light + dark tokens
src/calculator.js   pure state machine: no DOM, no eval, plus the history record
src/parser.js       transcript -> key sequence: fixed word table + grammar
src/app.js          wiring: keypad, keyboard, speech, visible press replay
tests/              node --test
```

`calculator.js` and `parser.js` have no browser dependencies, which is what
lets the whole core be tested in Node without a headless browser.
