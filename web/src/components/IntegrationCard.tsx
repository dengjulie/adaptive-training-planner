import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { api, connectUrl, type IntegrationSummary, type Provider } from '../api.ts'
import { ErrorMessage } from './ErrorMessage.tsx'

const ENV_HINTS: Record<Provider, string> = {
  google: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
  oura: 'OURA_CLIENT_ID and OURA_CLIENT_SECRET',
  coros: 'COROS_MCP_URL',
}

function statusOf(integration: IntegrationSummary) {
  if (!integration.configured) return { label: 'Not configured', tone: 'neutral' }
  if (!integration.connected) return { label: 'Not connected', tone: 'neutral' }
  if (integration.status === 'reauth_required') return { label: 'Needs reconnect', tone: 'warn' }
  return { label: 'Connected', tone: 'ok' }
}

export function IntegrationCard({
  integration,
  description,
  children,
}: {
  integration: IntegrationSummary
  description: string
  children?: ReactNode
}) {
  const { provider, label, configured, connected } = integration
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const disconnect = useMutation({
    mutationFn: () => api(`/api/connections/${provider}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setConfirming(false)
      await queryClient.invalidateQueries()
    },
  })
  const status = statusOf(integration)
  const needsConnect = configured && (!connected || integration.status === 'reauth_required')

  return (
    <section className="card">
      <header className="card-header">
        <h2>{label}</h2>
        <span className={`pill ${status.tone}`}>{status.label}</span>
      </header>
      <p className="muted">{description}</p>

      {!configured && (
        <p className="small">
          Set {ENV_HINTS[provider]} in <code>.env</code>, then restart the server.
        </p>
      )}

      <div className="actions">
        {needsConnect && (
          <a className="button primary" href={connectUrl(provider)}>
            {connected ? 'Reconnect' : 'Connect'}
          </a>
        )}
        {connected && !confirming && (
          <button type="button" className="button subtle" onClick={() => setConfirming(true)}>
            Disconnect
          </button>
        )}
        {confirming && (
          <>
            <span className="small">Revoke access and delete stored {label} data?</span>
            <button
              type="button"
              className="button danger"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </button>
            <button type="button" className="button subtle" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
      {disconnect.error && <ErrorMessage error={disconnect.error} />}

      {children}
    </section>
  )
}
