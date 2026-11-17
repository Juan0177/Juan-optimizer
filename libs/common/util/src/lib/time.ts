import { strPadLeft } from './string'

export const SECOND_MS = 1000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export function msToUnits(ms: number) {
  const milliseconds = ms % 1000
  const seconds = Math.floor((ms / 1000) % 60)
  const minutes = Math.floor((ms / (1000 * 60)) % 60)
  const hours = Math.floor(ms / (1000 * 60 * 60))
  return { hours, minutes, seconds, milliseconds }
}
/** The unit words after a time ("Minutes", "Hours"), so a caller can show them in its language */
export type TimeUnitWords = { minutes: string; hours: string }
const englishUnits: TimeUnitWords = { minutes: 'Minutes', hours: 'Hours' }
export function timeString(ms: number, units: TimeUnitWords = englishUnits) {
  //shows only in terms of hours/minutes. there are better calculations for days using Date functions.
  const { hours, minutes, seconds } = msToUnits(ms)
  let timeText = units.minutes
  if (hours) timeText = units.hours
  return `${hours ? `${hours}:` : ''}${strPadLeft(
    minutes.toString(),
    '0',
    2
  )}:${strPadLeft(seconds.toString(), '0', 2)} ${timeText}`
}
export function timeStringMs(ms: number, units: TimeUnitWords = englishUnits) {
  //shows only in terms of hours/minutes. there are better calculations for days using Date functions.
  const { hours, minutes, seconds, milliseconds } = msToUnits(ms)
  let timeText = units.minutes
  if (hours) timeText = units.hours
  return `${hours ? `${hours}:` : ''}${strPadLeft(
    minutes.toString(),
    '0',
    2
  )}:${strPadLeft(seconds.toString(), '0', 2)}.${strPadLeft(
    milliseconds.toString(),
    '0',
    3
  )} ${timeText}`
}
