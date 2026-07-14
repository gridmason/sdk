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
   * dev impls behind every method; a test never calls this directly.
   */
  record(method: M, args: readonly unknown[]): RecordedCall<M>;
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
    record(method, args) {
      const call: RecordedCall<M> = Object.freeze({ method, args, seq: seq++ });
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
