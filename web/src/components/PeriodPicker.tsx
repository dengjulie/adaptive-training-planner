import { PERIODS } from './period.ts'

export function PeriodPicker({
  days,
  onChange,
}: {
  days: number
  onChange: (days: number) => void
}) {
  return (
    <div className="segmented" role="group" aria-label="Period">
      {PERIODS.map((period) => (
        <button
          key={period.days}
          type="button"
          aria-pressed={period.days === days}
          onClick={() => onChange(period.days)}
        >
          {period.label}
        </button>
      ))}
    </div>
  )
}
