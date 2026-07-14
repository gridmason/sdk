import { describe, expect, test } from 'vitest';

import type { JSONSchema } from '../../src/index.js';
import { compileSchema } from '../../src/index.js';

/**
 * Issue #11 (FR-6): the schema→form compiler, the pinned renderer approach. These
 * cover the v0 shape rules (docs/settings-form.md) — control selection per property
 * type, `enum` → select with `enumNames` labels, the title/description/default/required
 * mapping, insertion order, and the shapes v0 deliberately skips — with no framework
 * or DOM in play (the compiler is plain data → data).
 */

describe('compileSchema — control selection', () => {
  test('maps scalar property types onto controls', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        age: { type: 'integer' },
        enabled: { type: 'boolean' },
        bio: { type: 'string', format: 'textarea' },
      },
    };
    const fields = compileSchema(schema);
    expect(fields.map((f) => [f.name, f.control])).toEqual([
      ['name', 'text'],
      ['count', 'number'],
      ['age', 'number'],
      ['enabled', 'checkbox'],
      ['bio', 'textarea'],
    ]);
  });

  test('a property with an enum is a select regardless of scalar type', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        theme: { type: 'string', enum: ['light', 'dark'] },
        level: { type: 'integer', enum: [1, 2, 3] },
      },
    };
    const fields = compileSchema(schema);
    expect(fields.map((f) => f.control)).toEqual(['select', 'select']);
    // Non-string enum values are carried through untouched (the stub adapter recovers
    // the typed value on change).
    expect(fields[1]?.options).toEqual([
      { value: 1, label: '1' },
      { value: 2, label: '2' },
      { value: 3, label: '3' },
    ]);
  });

  test('enumNames supplies option labels when aligned; otherwise String(value)', () => {
    const aligned = compileSchema({
      type: 'object',
      properties: {
        theme: { type: 'string', enum: ['light', 'dark'], enumNames: ['Light', 'Dark'] },
      },
    });
    expect(aligned[0]?.options).toEqual([
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ]);

    const mismatched = compileSchema({
      type: 'object',
      properties: {
        theme: { type: 'string', enum: ['light', 'dark'], enumNames: ['Light'] },
      },
    });
    expect(mismatched[0]?.options).toEqual([
      { value: 'light', label: 'light' },
      { value: 'dark', label: 'dark' },
    ]);
  });
});

describe('compileSchema — field metadata', () => {
  test('maps title, description, default, and required', () => {
    const fields = compileSchema({
      type: 'object',
      properties: {
        title: {
          type: 'string',
          title: 'Title',
          description: 'Shown in the header.',
          default: 'Untitled',
        },
        subtitle: { type: 'string' },
      },
      required: ['title'],
    });
    expect(fields[0]).toEqual({
      name: 'title',
      control: 'text',
      label: 'Title',
      description: 'Shown in the header.',
      default: 'Untitled',
      required: true,
    });
    // No title → label falls back to the property name; not required; no default key.
    expect(fields[1]).toEqual({ name: 'subtitle', control: 'text', label: 'subtitle', required: false });
  });

  test('a `default` of false/0/empty-string is preserved (presence, not truthiness)', () => {
    const fields = compileSchema({
      type: 'object',
      properties: {
        flag: { type: 'boolean', default: false },
        n: { type: 'number', default: 0 },
      },
    });
    expect(fields[0]?.default).toBe(false);
    expect(fields[1]?.default).toBe(0);
  });

  test('preserves properties insertion order', () => {
    const fields = compileSchema({
      type: 'object',
      properties: { z: { type: 'string' }, a: { type: 'string' }, m: { type: 'string' } },
    });
    expect(fields.map((f) => f.name)).toEqual(['z', 'a', 'm']);
  });
});

describe('compileSchema — shapes v0 skips or rejects', () => {
  test('skips nested object, array, null, and type-union properties', () => {
    const fields = compileSchema({
      type: 'object',
      properties: {
        keep: { type: 'string' },
        nested: { type: 'object', properties: { x: { type: 'string' } } },
        list: { type: 'array', items: { type: 'string' } },
        nothing: { type: 'null' },
        union: { type: ['string', 'number'] },
        notAnObject: 'nope',
      },
    });
    expect(fields.map((f) => f.name)).toEqual(['keep']);
  });

  test('skips a select whose enum is empty', () => {
    const fields = compileSchema({
      type: 'object',
      properties: { empty: { type: 'string', enum: [] }, ok: { type: 'string' } },
    });
    expect(fields.map((f) => f.name)).toEqual(['ok']);
  });

  test('a non-object schema, or an object without properties, compiles to []', () => {
    expect(compileSchema({ type: 'string' })).toEqual([]);
    expect(compileSchema({ type: 'object' })).toEqual([]);
    expect(compileSchema({})).toEqual([]);
  });
});
