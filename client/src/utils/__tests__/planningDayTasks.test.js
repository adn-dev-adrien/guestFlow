import { countDayTasks } from '../planningDayTasks';

// specs/planning-day-task-count.md — the Planning day chip counts every tickable card of the day
// (issue #15): arrivals, departures and resource sessions. It used to count arrivals only, so a day
// made of departures read « 0/0 » and never turned green.

test('arrivals only: the historical behaviour is preserved', () => {
  expect(countDayTasks({ arrivals: [{ checkInReady: 1 }, { checkInReady: 0 }] }))
    .toEqual({ done: 1, total: 2, allDone: false });
});

test('departures count — a day of departures only can reach 2/2', () => {
  expect(countDayTasks({ departures: [{ checkOutDone: 1 }, { checkOutDone: 1 }] }))
    .toEqual({ done: 2, total: 2, allDone: true });
  expect(countDayTasks({ departures: [{ checkOutDone: 0 }, { checkOutDone: 1 }] }))
    .toEqual({ done: 1, total: 2, allDone: false });
});

test('resource session cards count, with their own done flag', () => {
  expect(countDayTasks({ resourceCards: [{ done: true }, { done: false }] }))
    .toEqual({ done: 1, total: 2, allDone: false });
});

test('the three add up, and one pending card keeps the day off green', () => {
  const day = {
    arrivals: [{ checkInReady: 1 }],
    departures: [{ checkOutDone: 1 }],
    resourceCards: [{ done: false }],
  };
  expect(countDayTasks(day)).toEqual({ done: 2, total: 3, allDone: false });
  expect(countDayTasks({ ...day, resourceCards: [{ done: true }] }))
    .toEqual({ done: 3, total: 3, allDone: true });
});

test('an empty day is 0/0 and is never « all done »', () => {
  expect(countDayTasks({ arrivals: [], departures: [], resourceCards: [] }))
    .toEqual({ done: 0, total: 0, allDone: false });
});

test('missing arrays are treated as empty (a day whose maps have not loaded yet)', () => {
  expect(countDayTasks()).toEqual({ done: 0, total: 0, allDone: false });
  expect(countDayTasks({ arrivals: [{ checkInReady: 1 }], departures: undefined }))
    .toEqual({ done: 1, total: 1, allDone: true });
});
