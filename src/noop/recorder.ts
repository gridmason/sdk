/**
 * The call-recording harness shared by the dev `HostSDK` implementations
 * (docs/SPEC.md §5). `createNoopSDK()` (issue #6) wires one recorder behind every
 * method so a widget unit test can assert *which* SDK calls a widget made, in
 * *what* order, with *what* arguments — without a real host. `createFixtureSDK()`
 * (issue #7) layers its fixture matching on the very same recorder, so the two
 * dev handles share one inspection surface (this module is the reusable helper
 * the issue #6 brief carves out for #7 to import).
 *
 * The recorder is deliberately transport-agnostic: it captures a flat, ordered
 * log of `{ method, args, seq }` and nothing else. It knows nothing about
 * capabilities, typed-defaults, or fixtures — those live in the impls that call
 * `record()`. Keeping it that thin is what lets both dev handles reuse it.
 */

/**
 * The canonical dotted name of every recordable {@link HostSDK} method, plus the
 * synthetic `events.unsubscribe` entry a no-op logs when an `events.on`
 * subscription's {@link Unsubscribe} is invoked. Passing this union to
 * {@link createCallRecorder} gives a caller autocomplete and a typo-proof
 * `callsTo('records.read')` — the ergonomic win the acceptance criterion
 * ("recorded calls assertable in a sample widget test") is about.
 */
export type SdkMethod =
  | 'records.read'
  | 'records.query'
  | 'records.write'
  | 'net.fetch'
  | 'events.emit'
  | 'events.on'
  | 'events.unsubscribe'
  | 'settings.get'
  | 'settings.update'
  | 'settings.onSchema'
  | 'nav.open'
  | 'nav.toast'
  | 'telemetry.error'
  | 'telemetry.mark';

/**
 * One recorded method invocation. `args` is the argument list exactly as the
 * widget passed it (a call that omits an optional trailing argument records the
 * shorter list, so `args` deep-equals what the test would write). `seq` is a
 * monotonically increasing ordinal — `0` for the first call on a recorder — so a
 * test can assert relative ordering across methods, not just per-method counts.
 *
 * @typeParam M - the method-name union the recorder is keyed on (default `string`).
 */
export interface RecordedCall<M extends string = string> {
  /** The dotted method name, e.g. `records.read`. */
  readonly method: M;
  /** The arguments the caller passed, in order. */
  readonly args: readonly unknown[];
  /** Monotonic ordinal across all calls on this recorder, starting at `0`. */
  readonly seq: number;
  /**
   * Optional, opaque tag an implementation attaches to a call so a downstream
   * inspector can classify it — the recorder itself neither reads nor interprets
   * it. The no-op leaves it unset (a plain `{ method, args, seq }`); the fixture
   * impl (issue #7) tags each gated call with its outcome
   * (`fixture-hit`/`default-empty`/`denied`/`allowed`) so the CLI's SDK inspector
   * (cli §4) can show which calls were backed by fixture data. Kept `unknown`
   * here to preserve the recorder's transport-agnostic thinness (module doc);
   * the tagging impl owns the concrete shape.
   */
  readonly meta?: unknown;
}

/**
 * An append-only, inspectable log of {@link HostSDK} method invocations. Exposed
 * off a no-op/fixture handle so a test asserts against the calls a widget made.
 *
 * @typeParam M - the method-name union recorded (default `string`).
 */
export interface CallRecorder<M extends string = string> {
  /**
   * Append an invocation to the log and return the created entry. Called by the
   * dev impls behind every method; a test never calls this directly. `meta` is
   * an optional, opaque per-call tag (see {@link RecordedCall.meta}) — the no-op
   * omits it; the fixture impl passes its outcome classification. When omitted,
   * the created entry has no `meta` key at all (back-compat with callers that
   * assert `{ method, args, seq }` exactly).
   */
  record(method: M, args: readonly unknown[], meta?: unknown): RecordedCall<M>;
  /**
   * Every recorded call in invocation order. A defensive snapshot — mutating the
   * returned array never affects the log.
   */
  readonly calls: readonly RecordedCall<M>[];
  /** The recorded calls to one method, in order. Empty if the method was never called. */
  callsTo(method: M): readonly RecordedCall<M>[];
  /**
   * The most recent recorded call, or the most recent call to `method` when one
   * is given; `undefined` if there is no such call.
   */
  last(method?: M): RecordedCall<M> | undefined;
  /** Drop every recorded call. The `seq` counter keeps advancing (it never rewinds). */
  clear(): void;
}

/**
 * Create a fresh {@link CallRecorder}. Each recorder owns an independent log and
 * `seq` counter, so distinct handles never cross-contaminate their recordings.
 *
 * @typeParam M - the method-name union to record; pass {@link SdkMethod} for the
 * dev SDK handles, or leave it as `string` for an ad-hoc recorder.
 */
export function createCallRecorder<M extends string = string>(): CallRecorder<M> {
  const log: RecordedCall<M>[] = [];
  let seq = 0;

  return {
    record(method, args, meta) {
      // Omit `meta` entirely when unset so a plain call deep-equals
      // `{ method, args, seq }` (back-compat, and `toStrictEqual`-clean).
      const call: RecordedCall<M> = Object.freeze(
        meta === undefined
          ? { method, args, seq: seq++ }
          : { method, args, seq: seq++, meta },
      );
      log.push(call);
      return call;
    },
    get calls() {
      return log.slice();
    },
    callsTo(method) {
      return log.filter((call) => call.method === method);
    },
    last(method) {
      for (let i = log.length - 1; i >= 0; i--) {
        const call = log[i];
        if (call !== undefined && (method === undefined || call.method === method)) {
          return call;
        }
      }
      return undefined;
    },
    clear() {
      log.length = 0;
    },
  };
}
