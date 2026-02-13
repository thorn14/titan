export interface SnoozeOption {
  label: string;
  getTimestamp: () => number;
}

function nextMorning9am(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

function nextMonday9am(): number {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export const SNOOZE_OPTIONS: SnoozeOption[] = [
  { label: "30 minutes", getTimestamp: () => Date.now() + 30 * 60 * 1000 },
  { label: "1 hour", getTimestamp: () => Date.now() + 60 * 60 * 1000 },
  { label: "Tomorrow morning", getTimestamp: nextMorning9am },
  { label: "Next week", getTimestamp: nextMonday9am },
];
