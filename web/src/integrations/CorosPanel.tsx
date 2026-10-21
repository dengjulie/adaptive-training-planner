import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { ErrorMessage } from '../components/ErrorMessage.tsx'

type CorosActivity = {
  labelId: string
  name: string
  date: string
  durationSeconds: number | null
  distanceKm: number | null
  averageHeartRate: number | null
}

type CorosOverview = {
  activities: CorosActivity[]
  tools: Array<{ name: string; description: string | null }>
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC', // `date` is a calendar date, not an instant
})

function formatDuration(seconds: number | null) {
  if (seconds === null) return '–'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function CorosPanel() {
  const overview = useQuery({
    queryKey: ['coros', 'overview'],
    queryFn: () => api<CorosOverview>('/api/coros/overview'),
  })

  if (overview.isPending) return <p className="muted small">Loading activities from COROS…</p>
  if (overview.isError) return <ErrorMessage error={overview.error} />

  const { activities, tools } = overview.data
  return (
    <div className="panel">
      <h3>Last 7 days</h3>
      {activities.length === 0 ? (
        <p className="muted small">No activities.</p>
      ) : (
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Activity</th>
                <th>Duration</th>
                <th>Distance</th>
                <th>Avg HR</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr key={activity.labelId}>
                  <td>{dayFormat.format(new Date(activity.date))}</td>
                  <td>{activity.name}</td>
                  <td>{formatDuration(activity.durationSeconds)}</td>
                  <td>{activity.distanceKm === null ? '–' : `${activity.distanceKm} km`}</td>
                  <td>{activity.averageHeartRate === null ? '–' : `${activity.averageHeartRate} bpm`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary>{tools.length} COROS MCP tools available</summary>
        <ul className="list">
          {tools.map((tool) => (
            <li key={tool.name}>
              <code>{tool.name}</code>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
