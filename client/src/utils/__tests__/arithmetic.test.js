import { evaluateArithmetic } from '../arithmetic';

test('plain numbers', () => {
  expect(evaluateArithmetic('120')).toBe(120);
  expect(evaluateArithmetic('120.5')).toBe(120.5);
  expect(evaluateArithmetic('  42  ')).toBe(42);
});

test('French decimal comma', () => {
  expect(evaluateArithmetic('100,5')).toBe(100.5);
  expect(evaluateArithmetic('100,5+0,5')).toBe(101);
});

test('basic operations', () => {
  expect(evaluateArithmetic('100+20')).toBe(120);
  expect(evaluateArithmetic('100-20')).toBe(80);
  expect(evaluateArithmetic('10*12')).toBe(120);
  expect(evaluateArithmetic('120/2')).toBe(60);
});

test('precedence and parentheses', () => {
  expect(evaluateArithmetic('100+20*2')).toBe(140);
  expect(evaluateArithmetic('(100+20)*2')).toBe(240);
  expect(evaluateArithmetic('100 + 2 * (3 + 7)')).toBe(120);
});

test('unary minus / plus', () => {
  expect(evaluateArithmetic('-50+70')).toBe(20);
  expect(evaluateArithmetic('+100')).toBe(100);
  expect(evaluateArithmetic('100*-1')).toBe(-100);
  expect(evaluateArithmetic('100++20')).toBe(120); // second '+' is a unary plus
});

test('empty / null → null', () => {
  expect(evaluateArithmetic('')).toBeNull();
  expect(evaluateArithmetic('   ')).toBeNull();
  expect(evaluateArithmetic(null)).toBeNull();
});

test('malformed → null (no throw, no eval)', () => {
  expect(evaluateArithmetic('100+')).toBeNull();
  expect(evaluateArithmetic('(100+20')).toBeNull();
  expect(evaluateArithmetic('100+20)')).toBeNull();
  expect(evaluateArithmetic('1.2.3')).toBeNull();
  expect(evaluateArithmetic('abc')).toBeNull();
  expect(evaluateArithmetic('100 20')).toBeNull();
  expect(evaluateArithmetic('alert(1)')).toBeNull();
});

test('division by zero → null', () => {
  expect(evaluateArithmetic('100/0')).toBeNull();
});

test('returns raw (unrounded) value; caller rounds', () => {
  expect(evaluateArithmetic('100/3')).toBeCloseTo(33.3333, 4);
});
