import { useSearchParams } from 'react-router'

/** Day counts to show. The server keeps a year of Oura data. */
export const PERIODS = [
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]
const DEFAULT_DAYS = 30

/** The period chosen in the URL (`?days=90`), so a reload or a shared link keeps it. */
export function usePeriod() {
  const [params, setParams] = useSearchParams()
  const requested = Number(params.get('days'))
  const days = PERIODS.some((period) => period.days === requested) ? requested : DEFAULT_DAYS
  const setDays = (next: number) =>
    setParams(next === DEFAULT_DAYS ? {} : { days: String(next) }, { replace: true })
  return [days, setDays] as const
}
