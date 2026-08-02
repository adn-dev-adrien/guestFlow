import { orderDayEntries } from '../planningDayOrder';

const keys = (entries) => orderDayEntries(entries).map((e) => e.key);

test('timed cards sort ascending by HH:MM', () => {
  const entries = [
    { key: 'meal', time: '19:00' },
    { key: 'arrival', time: '10:00' },
    { key: 'breakfast', time: '08:00' },
  ];
  expect(keys(entries)).toEqual(['breakfast', 'arrival', 'meal']);
});

test('minutes are respected, not just the hour', () => {
  const entries = [
    { key: 'b', time: '10:45' },
    { key: 'a', time: '10:15' },
  ];
  expect(keys(entries)).toEqual(['a', 'b']);
});

test('time-less cards sort after all timed cards', () => {
  const entries = [
    { key: 'laundry', time: null },
    { key: 'arrival', time: '10:00' },
    { key: 'option-no-time', time: '' },
    { key: 'meal', time: '19:00' },
  ];
  expect(keys(entries)).toEqual(['arrival', 'meal', 'laundry', 'option-no-time']);
});

test('ties preserve insertion order (stable)', () => {
  const entries = [
    { key: 'arr-1', time: '15:00' },
    { key: 'dep-1', time: '15:00' },
    { key: 'arr-2', time: '15:00' },
  ];
  expect(keys(entries)).toEqual(['arr-1', 'dep-1', 'arr-2']);
});

test('time-less ties preserve insertion order', () => {
  const entries = [
    { key: 'laundry', time: null },
    { key: 'opt', time: null },
  ];
  expect(keys(entries)).toEqual(['laundry', 'opt']);
});

test('mixed heterogeneous entry types order correctly', () => {
  const entries = [
    { key: 'laundry', time: null },
    { key: 'departure', time: '11:00' },
    { key: 'meal', time: '19:00' },
    { key: 'breakfast', time: '08:00' },
    { key: 'resource', time: '16:00' },
    { key: 'arrival', time: '10:00' },
  ];
  expect(keys(entries)).toEqual(['breakfast', 'arrival', 'departure', 'resource', 'meal', 'laundry']);
});

test('non-array input yields empty array', () => {
  expect(orderDayEntries(null)).toEqual([]);
  expect(orderDayEntries(undefined)).toEqual([]);
});

test('does not mutate the input array', () => {
  const entries = [
    { key: 'meal', time: '19:00' },
    { key: 'arrival', time: '10:00' },
  ];
  orderDayEntries(entries);
  expect(entries.map((e) => e.key)).toEqual(['meal', 'arrival']);
});
