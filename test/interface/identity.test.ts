import { describe, expect, expectTypeOf, test } from 'vitest';

// The identity-token contract resolves through the package root barrel, proving
// FR-8's types + attachment API are surfaced from `@gridmason/sdk` itself.
import {
  INSTANCE_TOKEN_HEADER,
  InstanceGone,
  bindIdentityStamper,
  isInstanceGone,
  stampInstanceToken,
  toInstanceToken,
} from '../../src/index.js';
import type {
  IdentityStamper,
  InstanceToken,
  InstanceTokenReader,
  ScopedRequest,
  TransportHeaders,
} from '../../src/index.js';

/**
 * FR-8 (SPEC §2, §6; docs/identity-token.md): the per-instance remote-identity
 * token contract. The SDK owns *what* is stamped (an opaque token) and *where*
 * (a canonical header); the shell mints + proves it. These tests cover the token
 * brand, the pure header stamp (and its anti-spoof override), and the
 * closure-holding attachment API — including that revocation and the token are
 * one story (a revoked reader stamps `InstanceGone`, not an unattributed call).
 */

describe('InstanceToken (opaque, SDK-defined, shell-minted)', () => {
  test('toInstanceToken brands a shell-minted string without altering its value', () => {
    const token = toInstanceToken('minted-abc123');
    // The brand is compile-time only; the runtime value is the string itself.
    expect(token).toBe('minted-abc123');
    expectTypeOf(token).toEqualTypeOf<InstanceToken>();
  });

  test('a plain string is not assignable to InstanceToken without the cast (compile-time)', () => {
    expectTypeOf<InstanceToken>().toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<InstanceToken>();
  });
});

describe('stampInstanceToken (where it attaches — pure + immutable)', () => {
  const token = toInstanceToken('tok-1');

  test('sets the canonical header and preserves other headers', () => {
    const out = stampInstanceToken({ accept: 'application/json' }, token);
    expect(out).toEqual({
      accept: 'application/json',
      [INSTANCE_TOKEN_HEADER]: 'tok-1',
    });
  });

  test('stamps onto an absent header map', () => {
    expect(stampInstanceToken(undefined, token)).toEqual({
      [INSTANCE_TOKEN_HEADER]: 'tok-1',
    });
  });

  test('does not mutate the input map', () => {
    const input: TransportHeaders = { accept: 'text/plain' };
    stampInstanceToken(input, token);
    expect(input).toEqual({ accept: 'text/plain' });
    expect(INSTANCE_TOKEN_HEADER in input).toBe(false);
  });

  test('overrides a widget-supplied token header (anti-spoof), any casing', () => {
    const out = stampInstanceToken(
      {
        accept: 'application/json',
        [INSTANCE_TOKEN_HEADER]: 'widget-forged',
        'X-Gridmason-Instance-Token': 'widget-forged-cased',
      },
      token,
    );
    // Only the stamped token occupies the slot; no case-variant survives.
    expect(out[INSTANCE_TOKEN_HEADER]).toBe('tok-1');
    expect(Object.keys(out).filter((k) => k.toLowerCase() === INSTANCE_TOKEN_HEADER)).toEqual([
      INSTANCE_TOKEN_HEADER,
    ]);
    expect(out).not.toHaveProperty('X-Gridmason-Instance-Token');
    expect(out.accept).toBe('application/json');
  });
});

describe('bindIdentityStamper (closure-holding transport-attachment API)', () => {
  test('exposes the bound instanceId and stamps headers with the closure token', () => {
    const stamper = bindIdentityStamper('inst-1', () => toInstanceToken('tok-live'));
    expect(stamper.instanceId).toBe('inst-1');
    expect(stamper.stampHeaders({ accept: '*/*' })).toEqual({
      accept: '*/*',
      [INSTANCE_TOKEN_HEADER]: 'tok-live',
    });
  });

  test('stampRequest attaches the token to a scoped net request, leaving other fields intact', () => {
    const stamper = bindIdentityStamper('inst-2', () => toInstanceToken('tok-2'));
    const req: ScopedRequest = {
      host: 'api.acme.com',
      path: '/v2/sales',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    };
    const out = stamper.stampRequest(req);
    expect(out.host).toBe('api.acme.com');
    expect(out.path).toBe('/v2/sales');
    expect(out.method).toBe('POST');
    expect(out.body).toBe('{}');
    expect(out.headers).toEqual({
      'content-type': 'application/json',
      [INSTANCE_TOKEN_HEADER]: 'tok-2',
    });
    // Immutable: the widget's request object is untouched.
    expect(req.headers).toEqual({ 'content-type': 'application/json' });
  });

  test('reads the token afresh each call, so a mid-life revocation takes effect at once', () => {
    let token: InstanceToken | undefined = toInstanceToken('tok-3');
    const reader: InstanceTokenReader = () => token;
    const stamper = bindIdentityStamper('inst-3', reader);

    expect(stamper.stampHeaders()[INSTANCE_TOKEN_HEADER]).toBe('tok-3');

    // Unmount revocation: the shell's reader stops yielding a token.
    token = undefined;

    expect(() => stamper.stampHeaders()).toThrow(InstanceGone);
    try {
      stamper.stampRequest({ host: 'api.acme.com', path: '/x' });
      throw new Error('expected stampRequest to throw');
    } catch (err) {
      expect(isInstanceGone(err)).toBe(true);
      expect((err as InstanceGone).instanceId).toBe('inst-3');
    }
  });

  test('the token never leaks out of the stamper (only stamped headers/requests leave)', () => {
    const stamper: IdentityStamper = bindIdentityStamper('inst-4', () =>
      toInstanceToken('secret-tok'),
    );
    // The stamper surface exposes instanceId + stamp methods, never the token.
    expect(Object.keys(stamper).sort()).toEqual(['instanceId', 'stampHeaders', 'stampRequest']);
  });
});
