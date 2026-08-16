/**
 * A gate in front of every OpenAI call.
 *
 * Nothing in the extension throttles the user. Clicking twenty cards in a grid
 * fires twenty try-ons, each of which screens an image; a Pinterest moodboard
 * costs up to six calls on its own. Without a gate that is a burst straight at
 * the API — rate-limit errors at best, a surprising bill at worst.
 *
 * Three protections, in order of how often they save you:
 *
 *   1. **De-duplication.** Identical concurrent work shares one call. Ticking the
 *      same item twice, or two tabs asking about the same product, costs once.
 *   2. **Concurrency cap.** At most a few calls in flight, so a burst becomes a
 *      queue instead of a spike.
 *   3. **Rate ceiling.** A hard cap per rolling minute. Past it, callers wait;
 *      if the backlog is already unreasonable they are turned away with a clear
 *      message rather than queued forever.
 */

const MAX_CONCURRENT = Number(process.env.OPENAI_MAX_CONCURRENT || 3);
const MAX_PER_MINUTE = Number(process.env.OPENAI_MAX_PER_MINUTE || 40);
const MAX_QUEUE = Number(process.env.OPENAI_MAX_QUEUE || 40);
const WINDOW_MS = 60_000;

let active = 0;
const waiting = [];
const recent = []; // timestamps of calls started in the current window

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pruneWindow() {
  const cutoff = Date.now() - WINDOW_MS;
  while (recent.length && recent[0] < cutoff) recent.shift();
}

/** Milliseconds until a rate slot frees up, or 0 if one is free now. */
function rateDelay() {
  pruneWindow();
  if (recent.length < MAX_PER_MINUTE) return 0;
  return Math.max(0, recent[0] + WINDOW_MS - Date.now()) + 25;
}

function pump() {
  while (active < MAX_CONCURRENT && waiting.length) {
    const wait = rateDelay();
    if (wait > 0) {
      // Everything is blocked on the window, not on a slot; retry once it moves.
      setTimeout(pump, wait);
      return;
    }
    const job = waiting.shift();
    active++;
    recent.push(Date.now());

    /*
     * `fn` must be invoked inside a promise, not called bare.
     *
     * Every caller here is `() => getClient().chat.completions.create(...)`, and
     * `getClient()` throws *synchronously* when OPENAI_API_KEY is missing. Called
     * bare, that throw escapes before `.finally` is ever attached: the slot is
     * never released, so three such failures pin `active` at MAX_CONCURRENT and
     * every later call queues forever. It also escapes into whatever invoked
     * pump() — a `.finally` handler (unhandled rejection) or a setTimeout
     * (uncaught exception, which takes the process down).
     */
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}

/**
 * Runs `fn` under the concurrency cap and rate ceiling.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function runLimited(fn) {
  if (waiting.length >= MAX_QUEUE) {
    return Promise.reject(
      new Error('Too many requests queued at once. Give it a moment and try again.')
    );
  }
  return new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    pump();
  });
}

/*
 * In-flight de-duplication.
 *
 * A cache of finished results does not help while a call is still running —
 * that is exactly the window in which a user double-clicks. Keying on the
 * promise closes it.
 */
const inFlight = new Map();

/**
 * @template T
 * @param {string} key identity of the work
 * @param {() => Promise<T>} fn
 */
export function dedupe(key, fn) {
  const existing = inFlight.get(key);
  if (existing) return existing;

  // Same reasoning as pump(): a synchronous throw from `fn` must come back as a
  // rejected promise, not as a throw from a function documented to return one.
  const p = Promise.resolve().then(fn).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** For logging and tests. */
export const gateStats = () => {
  pruneWindow();
  return { active, queued: waiting.length, lastMinute: recent.length, inFlight: inFlight.size };
};
