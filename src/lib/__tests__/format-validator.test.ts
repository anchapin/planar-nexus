/**
 * Format validator tests
 */

import { getFormatRulesSummary, formatValidationMessage } from '../format-validator';

describe('getFormatRulesSummary', () => {
  it('should return rules for standard', () => {
    const rules = getFormatRulesSummary('standard');
    expect(rules).toBeDefined();
  });

  it('should return rules for commander', () => {
    const rules = getFormatRulesSummary('commander');
    expect(rules).toBeDefined();
  });

  it('should return rules for modern', () => {
    const rules = getFormatRulesSummary('modern');
    expect(rules).toBeDefined();
  });
});

describe('formatValidationMessage', () => {
  it('should handle valid result', () => {
    const message = formatValidationMessage({ isValid: true, errors: [], warnings: [] });
    expect(typeof message).toBe('string');
  });

  it('should handle invalid result', () => {
    const message = formatValidationMessage({ isValid: false, errors: ['error'], warnings: [] });
    expect(typeof message).toBe('string');
  });
});
