import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { ErrorMessage } from '../components/ErrorMessage.tsx'

type GoogleOverview = {
  calendar: { id: string; summary: string; timeZone: string | null }
  busy: Array<{ start: string; end: string }>
}

const rangeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function GooglePanel() {
  const overview = useQuery({
    queryKey: ['google', 'overview'],
    queryFn: () => api<GoogleOverview>('/api/google/overview'),
  })

  if (overview.isPending) return <p className="muted small">Checking your calendars…</p>
  if (overview.isError) return <ErrorMessage error={overview.error} />

  const { calendar, busy } = overview.data
  return (
    <div className="panel">
      <dl className="facts">
        <dt>Training calendar</dt>
        <dd>
          {calendar.summary}
          {calendar.timeZone && <span className="muted"> · {calendar.timeZone}</span>}
        </dd>
      </dl>
      <h3>Busy in the next 7 days</h3>
      {busy.length === 0 ? (
        <p className="muted small">Nothing on your primary calendar.</p>
      ) : (
        <ul className="list">
          {busy.map((block) => (
            <li key={block.start}>
              {rangeFormat.formatRange(new Date(block.start), new Date(block.end))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
