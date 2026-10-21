import { useSearchParams } from 'react-router'
import { connectUrl } from '../api.ts'

export function SignInPage() {
  const [params] = useSearchParams()
  const error = params.get('error')

  return (
    <main className="page narrow">
      <h1>Train Smarter</h1>
      <p className="lede">
        A training plan built from your COROS history, adjusted each morning to your Oura
        readiness, and kept on your Google Calendar.
      </p>
      {error && <p className="notice error">{error}</p>}
      <a className="button primary" href={connectUrl('google')}>
        Continue with Google
      </a>
      <p className="muted small">
        Signing in also connects a dedicated “Training” calendar. The app only reads free/busy
        times from your other calendars and never writes to them.
      </p>
    </main>
  )
}
