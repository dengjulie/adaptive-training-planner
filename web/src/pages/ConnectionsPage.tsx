import type { ComponentType } from 'react'
import { useSearchParams } from 'react-router'
import { useMe, type Provider } from '../api.ts'
import { IntegrationCard } from '../components/IntegrationCard.tsx'
import { CorosPanel } from '../integrations/CorosPanel.tsx'
import { GooglePanel } from '../integrations/GooglePanel.tsx'
import { OuraPanel } from '../integrations/OuraPanel.tsx'

const DESCRIPTIONS: Record<Provider, string> = {
  google:
    'Sessions go on a dedicated “Training” calendar. Free/busy times from your primary calendar decide when they fit.',
  oura: 'Daily readiness, HRV, and resting heart rate drive the morning adjustments.',
  coros:
    'Activities, training load, VO2max, and sleep set your baseline and confirm completed sessions.',
}

const PANELS: Record<Provider, ComponentType> = {
  google: GooglePanel,
  oura: OuraPanel,
  coros: CorosPanel,
}

export function ConnectionsPage() {
  const { data: me } = useMe()
  const [params, setParams] = useSearchParams()
  if (!me) return null

  const connected = me.integrations.find((i) => i.provider === params.get('connected'))
  const error = params.get('error')

  return (
    <>
      <h1>Connections</h1>
      <p className="lede">
        Connect your accounts so the planner can read your training and recovery and put sessions
        on your calendar.
      </p>

      {(connected || error) && (
        <div className={`notice${error ? ' error' : ''}`} role="status">
          <span>{error ?? `${connected?.label} connected.`}</span>
          <button
            type="button"
            className="button subtle"
            onClick={() => setParams({}, { replace: true })}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="cards">
        {me.integrations.map((integration) => {
          const Panel = PANELS[integration.provider]
          return (
            <IntegrationCard
              key={integration.provider}
              integration={integration}
              description={DESCRIPTIONS[integration.provider]}
            >
              {integration.connected && integration.status === 'active' && <Panel />}
            </IntegrationCard>
          )
        })}
      </div>
    </>
  )
}
