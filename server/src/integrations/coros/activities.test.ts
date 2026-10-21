import { describe, expect, it } from 'vitest'
import { parseDuration, parseSportRecords } from './activities.ts'

// Shape of real querySportRecords output (community capture, values anonymized), including the
// wrapped " | Avg HR" line COROS emits for strength sessions.
const SAMPLE = `Sport Records — 2026-03-01 to 2026-03-08 (3 records)
========================

1. Indoor Run — 2026-03-08
   Location: Easy run
   Time Window: startTimestamp=1772996400 | endTimestamp=1772998500
   Duration: 35:00 | Distance: 4.89 km
   Average Pace: 7:09 /km | Avg HR: 151 bpm | Calories: 396 kcal
   LabelId: 900000000000000001 | SportType: 101

2. Strength — 2026-03-07
   Location: calves and hips
   Time Window: startTimestamp=1772920331 | endTimestamp=1772924734
   Duration: 1:10:05 | Sets: 25
 | Avg HR: 101 bpm | Calories: 506 kcal
   LabelId: 900000000000000002 | SportType: 402

3. Cycling — 2026-03-05
   Location: Road Bike
   Time Window: startTimestamp=1772730000 | endTimestamp=1772734732
   Duration: 1:18:52 | Distance: 35.92 km
   Average Speed: 27.3 km/h | Avg HR: 154 bpm | Calories: 944 kcal
   LabelId: 900000000000000003 | SportType: 200
`

describe('parseSportRecords', () => {
  const [run, strength, ride] = parseSportRecords(SAMPLE)

  it('parses every record', () => {
    expect(parseSportRecords(SAMPLE)).toHaveLength(3)
  })

  it('reads the fields of a run', () => {
    expect(run).toEqual({
      labelId: '900000000000000001',
      sportType: 101,
      name: 'Indoor Run',
      date: '2026-03-08',
      startTime: '2026-03-08T19:00:00.000Z',
      endTime: '2026-03-08T19:35:00.000Z',
      durationSeconds: 2100,
      distanceKm: 4.89,
      averageHeartRate: 151,
    })
  })

  it('keeps 18-digit label IDs exact', () => {
    expect(ride?.labelId).toBe('900000000000000003')
  })

  it('handles records without distance and with wrapped lines', () => {
    expect(strength).toMatchObject({ distanceKm: null, durationSeconds: 4205, averageHeartRate: 101 })
  })

  it('returns nothing for "no records" text', () => {
    expect(parseSportRecords('No sport records found.')).toEqual([])
  })
})

describe('parseDuration', () => {
  it('handles mm:ss and h:mm:ss', () => {
    expect(parseDuration('35:00')).toBe(2100)
    expect(parseDuration('1:18:52')).toBe(4732)
    expect(parseDuration(undefined)).toBeNull()
  })
})
