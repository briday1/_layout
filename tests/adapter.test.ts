import { expect, it } from 'vitest';
import { defineAdapter } from '../packages/layout/src/adapter.js';

it('combines a declarative template and reusable implementation without mutating either', () => {
  const template = Object.freeze({
    id: 'json', title: 'JSON', extension: 'json', initialSource: '{}', language: 'json',
  });
  const implementation = Object.freeze({
    parse: (source: string) => ({ model: JSON.parse(source) as Record<string, unknown>, objects: [] }),
    render: () => {},
  });
  const adapter = defineAdapter(template, implementation);
  expect(adapter).toEqual({ ...template, ...implementation });
  expect(adapter.parse).toBe(implementation.parse);
  expect(adapter).not.toBe(template);
  expect(adapter).not.toBe(implementation);
});
