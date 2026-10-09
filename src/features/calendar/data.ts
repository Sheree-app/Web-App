export type WorkingDay = {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
};
export type ScheduleBreak = {
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  label: string;
};
export type ScheduleBlock = { startsAt: string; endsAt: string; label: string };
export type Schedule = {
  preferences: {
    maxAppointmentsPerDay: number;
    bufferMinutes: number;
    defaultDurationMinutes: number;
    approvalMode: "automatic" | "manual";
  };
  hours: WorkingDay[];
  breaks: ScheduleBreak[];
  blocks: ScheduleBlock[];
};
export const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const defaultSchedule: Schedule = {
  preferences: {
    maxAppointmentsPerDay: 8,
    bufferMinutes: 15,
    defaultDurationMinutes: 60,
    approvalMode: "automatic",
  },
  hours: dayNames.map((_, dayOfWeek) => ({
    dayOfWeek,
    opensAt: "09:00",
    closesAt: "18:00",
    isClosed: dayOfWeek === 0,
  })),
  breaks: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek,
    startsAt: "13:00",
    endsAt: "14:00",
    label: "Lunch",
  })),
  blocks: [],
};
export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
