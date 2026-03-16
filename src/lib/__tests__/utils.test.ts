/**
 * Utils tests
 */

import { cn } from '../utils';

describe('cn', () => {
  it('should merge classes', () => {
    const result = cn('foo', 'bar');
    expect(result).toBe('foo bar');
  });

  it('should handle conditional classes', () => {
    const conditional = false;
    const result = cn('foo', conditional && 'bar', 'baz');
    expect(result).toBe('foo baz');
  });

  it('should handle arrays', () => {
    const result = cn(['foo', 'bar']);
    expect(result).toBe('foo bar');
  });

  it('should handle objects', () => {
    const result = cn({ foo: true, bar: false });
    expect(result).toBe('foo');
  });

  it('should handle mixed inputs', () => {
    const result = cn('foo', ['bar', 'baz'], { qux: true });
    expect(result).toBe('foo bar baz qux');
  });

  it('should handle empty inputs', () => {
    const result = cn();
    expect(result).toBe('');
  });

  it('should handle undefined and null', () => {
    const result = cn('foo', undefined, null, 'bar');
    expect(result).toBe('foo bar');
  });

  it('should handle numbers', () => {
    const result = cn('foo', 0, 'bar');
    // 0 is falsy and gets filtered out by cn()
    expect(result).toBe('foo bar');
  });

  it('should deduplicate tailwind classes correctly', () => {
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });

  it('should handle complex object conditions', () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn('base', { active: isActive, disabled: isDisabled });
    expect(result).toBe('base active');
  });
});
