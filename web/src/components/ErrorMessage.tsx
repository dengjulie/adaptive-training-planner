import { ApiError, connectUrl } from '../api.ts'

export function ErrorMessage({ error }: { error: Error }) {
  if (error instanceof ApiError && error.code === 'reauth_required' && error.provider) {
    return (
      <p className="notice error">
        {error.message}. <a href={connectUrl(error.provider)}>Reconnect</a>
      </p>
    )
  }
  return <p className="notice error">{error.message}</p>
}
