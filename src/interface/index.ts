/**
 * The `HostSDK` interface (docs/SPEC.md §3): the single capability-enforcing
 * chokepoint a host shell implements so a widget reaches data, permissions,
 * events, navigation, and telemetry through one audited path — plus the typed
 * error surface (`PermissionDenied`, `InstanceGone`, re-exported from
 * `./errors.js`).
 *
 * This module declares **types only** — no runtime behavior. The implementers
 * live elsewhere: the dev handles `createNoopSDK`/`createFixtureSDK` (issues
 * #6/#7), the host reference implementation (dashboard repo), and any product
 * shell. Whether an implementation is a *conforming host* is decided by the
 * conformance kit (S-E2), which mechanically enforces the six contract rules
 * this file documents.
 *
 * ## Where the types come from (docs/re-export-policy.md)
 *
 * Shared contract types have exactly one definition — `@gridmason/protocol`'s —
 * so the same rules gate the picker (core §6) and every SDK call (SPEC §6). This
 * file **never** redefines one: `WidgetId` and the page-context value type
 * (`PageContext`) come from the sibling re-export barrel `../protocol/index.js`.
 *
 * Everything else the interface names (`RecordRef`, `RecordData`, `QuerySpec`,
 * `Patch`, `ScopedRequest`, `ScopedResponse`, `TypedTopic`, `WidgetSettings`,
 * `RouteRef`, `Notice`, `WidgetError`, …) is the SDK's *own* widget↔host runtime
 * vocabulary — protocol ships none of these (it owns manifest/layout/capability/
 * context-grammar/identity/verify, not the runtime data contract), so declaring
 * them here is the SDK's job, not a redefinition.
 *
 * ## Two deliberate deviations from the SPEC §3 spelling
 *
 * - **`RecordData`, not `Record`.** SPEC §3 writes the record value type as
 *   `Record`; that name shadows TypeScript's built-in `Record<K, V>` utility, so
 *   it is spelled `RecordData` here (same contract slot, safe name).
 * - **`ScopedResponse`, not `Response`.** SPEC §3 writes `Promise<Response>`.
 *   The package targets `lib: ES2022` with **no DOM lib** (a widget's runtime
 *   varies; the SDK stays DOM-agnostic), so the global `Response` is unavailable
 *   and would also couple the contract to `fetch`. `net.fetch` returns the
 *   SDK-owned {@link ScopedResponse} instead.
 */

import type { PageContext, WidgetId } from '../protocol/index.js';

export * from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Data-access vocabulary (records + net)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A reference to a single host record: its host-declared `recordType` (the same
 * opaque domain vocabulary protocol's `RecordRefContextType` carries — SPEC
 * §3.2) plus the record's `id`. Structurally the SDK's counterpart of protocol's
 * `RecordRefValue`, the record-ref value a widget reads off `sdk.context` (e.g.
 * `sdk.context.record`) and passes straight to `records.read`.
 */
export interface RecordRef {
  /** Host-declared record kind (`customer`, `team`, …); matched by equality. */
  readonly recordType: string;
  /** Opaque within-type identifier of the record. */
  readonly id: string;
}

/**
 * A record value returned by `records.read`/`query`/`write`. SPEC §3's `Record`
 * (renamed — see module doc). The host owns the field vocabulary; the SDK treats
 * field values as opaque JSON.
 */
export interface RecordData {
  /** Identifies which record this is. */
  readonly ref: RecordRef;
  /** Host-domain fields; values are opaque to the SDK. */
  readonly fields: { readonly [field: string]: unknown };
}

/** Per-call options for `records.read`. All optional; omit for host defaults. */
export interface ReadOptions {
  /**
   * Project a subset of fields. Omit for the host's default field set. A widget
   * still only receives fields its capabilities permit — projection never widens
   * access.
   */
  readonly fields?: readonly string[];
}

/**
 * A declarative query over one record type. The capability check gates on
 * `records.read:<scope>` for the queried `recordType`; a matching record the
 * caller lacks read capability for is never returned (it is not an empty result
 * *and* not a leak — the whole call is denied, SPEC §3 rule 1).
 */
export interface QuerySpec {
  /** The record type to query (host-declared vocabulary). */
  readonly recordType: string;
  /** Equality/predicate filters, field → expected value. Host-interpreted. */
  readonly where?: { readonly [field: string]: unknown };
  /** Maximum records to return. */
  readonly limit?: number;
}

/**
 * A partial update to a record: the fields to change, keyed by name. Applied by
 * `records.write` under a `records.write:<scope>` capability. Absent fields are
 * left unchanged.
 */
export type Patch = { readonly [field: string]: unknown };

/** The HTTP methods a {@link ScopedRequest} may use. */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/**
 * A **scoped** outbound request — the *only* network shape the handle accepts.
 * `host` is matched against the widget's declared `net:<host>` capabilities; a
 * request to an undeclared host is denied (SPEC §3 rule 2). There is
 * deliberately no raw `fetch`/URL on the handle: the scoped shape is what lets
 * the host bind the per-remote identity to the call (SPEC §2, §6).
 */
export interface ScopedRequest {
  /** The remote host, e.g. `api.acme.com` — gated by `net:<host>`. */
  readonly host: string;
  /** Request path (and query), e.g. `/v2/sales`. Never a full URL. */
  readonly path: string;
  /** HTTP method; defaults to `GET` when omitted. */
  readonly method?: HttpMethod;
  /** Request headers, name → value. The host attaches identity/auth itself. */
  readonly headers?: { readonly [name: string]: string };
  /** Request body, already serialized by the caller. */
  readonly body?: string;
}

/**
 * The response to a {@link ScopedRequest}. An SDK-owned, DOM-free shape (the
 * package has no DOM lib — see module doc), not the global `Response`.
 */
export interface ScopedResponse {
  /** HTTP status code. */
  readonly status: number;
  /** `true` for a 2xx status. */
  readonly ok: boolean;
  /** Response headers, name → value. */
  readonly headers: { readonly [name: string]: string };
  /** Parse the body as JSON. */
  json<T = unknown>(): Promise<T>;
  /** Read the body as text. */
  text(): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed event bus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A typed, namespaced topic on the cross-widget bus. `ns` is the capability
 * namespace the bus gates on (`events:<ns>`); a widget may only `emit`/`on` a
 * topic whose `ns` its capabilities cover (SPEC §3 rule 4). `T` is the payload
 * type carried across `emit`/`on`; it is a compile-time phantom — bind it by
 * annotating the topic (`const t: TypedTopic<SaleSelected> = { ns, name }`) or
 * via a typed topic factory (widget-side helpers, S-E2).
 *
 * The bus is same-document, in-memory, and host-mediated — never a shared
 * global (SPEC §3 rule 4).
 */
export interface TypedTopic<T> {
  /** Capability namespace gated as `events:<ns>`. */
  readonly ns: string;
  /** Topic name within the namespace. */
  readonly name: string;
  /**
   * Phantom carrier for the payload type `T`. Never present at runtime — it
   * exists only so `T` binds when a topic is annotated; do not read it.
   */
  readonly __payload__?: T;
}

/**
 * Releases an `events.on` subscription. Idempotent: calling it more than once is
 * a no-op. The host also releases every subscription automatically on unmount
 * (SPEC §3 rule 6), so a widget need not track them for teardown.
 */
export type Unsubscribe = () => void;

// ─────────────────────────────────────────────────────────────────────────────
// Context, settings, navigation, telemetry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-instance saved widget props (settings), a plain JSON object. The host
 * persists these via the layout store; the widget reads them with
 * `settings.get()` and updates them with `settings.update()`.
 */
export type WidgetSettings = { readonly [key: string]: unknown };

/**
 * A JSON Schema document describing a widget's settings form, registered via
 * `settings.onSchema`. The host renders it in its design system when the widget
 * ships no custom settings element (SPEC §4). Kept structurally open — the SDK
 * does not narrow the JSON Schema dialect.
 */
export type JSONSchema = { readonly [key: string]: unknown };

/**
 * A host navigation target for `nav.open`. The widget never touches
 * `window.location`; the host owns routing (SPEC §3), so a target is expressed
 * as a host route, not a URL.
 */
export interface RouteRef {
  /** Host-interpreted route path. */
  readonly path: string;
  /** Route parameters, name → value. */
  readonly params?: { readonly [key: string]: string };
}

/** Severity of a {@link Notice} shown via `nav.toast`. */
export type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

/** A transient message surfaced to the user through `nav.toast`. */
export interface Notice {
  /** The message text. */
  readonly message: string;
  /** Severity; defaults to `info` when omitted. */
  readonly level?: NoticeLevel;
}

/**
 * A structured error report a widget hands to `telemetry.error`. The host
 * attributes it to this widget instance (core §7). A plain report rather than a
 * thrown `Error` so it crosses the boundary as serializable data.
 */
export interface WidgetError {
  /** Human-readable message. */
  readonly message: string;
  /** Optional error name/kind (e.g. the original `Error.name`). */
  readonly name?: string;
  /** Optional captured stack trace. */
  readonly stack?: string;
  /** Optional structured detail for diagnostics; values are opaque. */
  readonly detail?: { readonly [key: string]: unknown };
}

// ─────────────────────────────────────────────────────────────────────────────
// The HostSDK handle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The capability-scoped handle a host passes to each mounted widget. The engine
 * (`core`) forwards it opaquely and never inspects it (core §4); this interface
 * is the whole contract between widget and host.
 *
 * **Contract rules a conforming host MUST honor** (docs/SPEC.md §3; mechanically
 * enforced by the conformance kit, S-E2):
 *
 * 1. Every `records`/`net` call is checked against `min(user, declared-widget)`
 *    capabilities **before** transport; a denial is a thrown/rejected
 *    {@link PermissionDenied}, never an empty result (no capability leakage).
 * 2. `net.fetch` reaches only hosts the widget declared (`net:<host>`); there is
 *    no unscoped fetch on the handle.
 * 3. Every outbound call carries the per-instance remote-identity binding; a
 *    host that drops it fails conformance. (The SDK defines *what* identity is
 *    stamped; the shell's Service Worker does the stamping — SPEC §6.)
 * 4. `events` topics are typed and namespaced; a widget cannot subscribe to a
 *    topic whose `events:<ns>` it lacks. The bus is same-document, in-memory,
 *    host-mediated — never a shared global.
 * 5. The handle is per-instance: two mounts of the same widget get distinct
 *    handles with distinct `identity.instanceId`.
 * 6. On unmount the host revokes the instance token and releases every `events`
 *    subscription registered through the handle; a stale handle's calls reject
 *    with {@link InstanceGone} — never a hang, never data.
 */
export interface HostSDK {
  /**
   * Capability-gated record access. All async (through the host's SW transport);
   * a call the caller's `min(user, widget)` capabilities do not cover rejects
   * with {@link PermissionDenied} before transport (rule 1).
   */
  readonly records: {
    /**
     * Read one record by reference.
     *
     * Capability: `records.read:<scope>` covering `ref.recordType`.
     */
    read(ref: RecordRef, opts?: ReadOptions): Promise<RecordData>;
    /**
     * Query records of one type.
     *
     * Capability: `records.read:<scope>` covering `spec.recordType`.
     */
    query(spec: QuerySpec): Promise<RecordData[]>;
    /**
     * Apply a partial update to a record and return the updated value.
     *
     * Capability: `records.write:<scope>` covering `ref.recordType`.
     */
    write(ref: RecordRef, patch: Patch): Promise<RecordData>;
  };

  /**
   * Scoped network access — the only network path on the handle (SPEC §2, §6).
   */
  readonly net: {
    /**
     * Perform a scoped request. There is **no** raw `fetch`/URL entry point:
     * only hosts declared via `net:<host>` are reachable, and the scoped shape
     * is what carries the per-remote identity (rules 2, 3).
     *
     * Capability: `net:<host>` matching `req.host`.
     */
    fetch(req: ScopedRequest): Promise<ScopedResponse>;
  };

  /**
   * The typed, namespaced cross-widget event bus (rule 4). Subscribing or
   * emitting on a topic whose `events:<ns>` the widget lacks is denied.
   */
  readonly events: {
    /**
     * Publish `payload` to `topic`'s subscribers.
     *
     * Capability: `events:<topic.ns>`.
     */
    emit<T>(topic: TypedTopic<T>, payload: T): void;
    /**
     * Subscribe to `topic`; returns an {@link Unsubscribe}. The subscription is
     * released on the returned callback and, unconditionally, on unmount
     * (rule 6).
     *
     * Capability: `events:<topic.ns>`.
     */
    on<T>(topic: TypedTopic<T>, handler: (payload: T) => void): Unsubscribe;
  };

  /**
   * The typed context of the page this widget is mounted on (SPEC §3.2) — the
   * slot *values* the host provides for this mount (e.g. the {@link RecordRef}-shaped
   * `RecordRefValue` a record-scoped page is showing), keyed by slot name.
   *
   * A {@link PageContext} (`@gridmason/protocol` §3.2) — the value-side
   * counterpart of the `ContextMap` type grammar a page-type declares. Protocol
   * owns this shared contract type (the SDK never mints a local one); `matchesContextMap`
   * relates a `PageContext` value to the `ContextMap` a widget's `requiresContext`
   * declares (a host/picker concern, not a widget one).
   */
  readonly context: PageContext;

  /** Per-instance settings: read, persist, and register a settings form. */
  readonly settings: {
    /** The current saved settings for this instance. */
    get(): WidgetSettings;
    /**
     * Persist a partial settings update via the layout store. Resolves once
     * saved.
     */
    update(patch: Partial<WidgetSettings>): Promise<void>;
    /**
     * Register a JSON Schema for the settings form; the host renders it in its
     * design system when the widget ships no custom settings element (SPEC §4).
     */
    onSchema(schema: JSONSchema): void;
  };

  /**
   * Host affordances. The widget never touches `window.location` — the host owns
   * routing (SPEC §3).
   */
  readonly nav: {
    /** Navigate to a host route. */
    open(target: RouteRef): void;
    /** Surface a transient notice to the user. */
    toast(msg: Notice): void;
  };

  /** Observability: the host attributes errors and latency to this widget (core §7). */
  readonly telemetry: {
    /** Report a widget error for host-side attribution. */
    error(e: WidgetError): void;
    /** Record a named latency measurement, in milliseconds. */
    mark(name: string, ms: number): void;
  };

  /**
   * The identity of **this** mount (rule 5) — opaque to the widget, used by the
   * helper layer. Two mounts of the same widget carry distinct `instanceId`s.
   */
  readonly identity: {
    /** Unique per-mount identifier. */
    readonly instanceId: string;
    /** The `(source, tag)` widget identity (protocol §3.3). */
    readonly widgetId: WidgetId;
  };
}
