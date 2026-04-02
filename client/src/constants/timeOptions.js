export const TIME_OPTIONS = Array.from({ length: 29 }, (_, i) => {
  const h = String(Math.floor(i / 2) + 8).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});
