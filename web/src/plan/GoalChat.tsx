import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import type { GoalInput, RaceDistance, TimeWindow } from './api.ts'

type IntakeMessage = { role: 'user' | 'assistant'; content: string }

/** What the server's goal intake returns (server: ai/goalIntake.ts). */
export type GoalDraft = {
  raceDistance: RaceDistance | null
  raceDate: string | null
  timeWindows: TimeWindow[]
  longRunWeekday: number | null
}
type IntakeResult = { reply: string; draft: GoalDraft; goal: GoalInput | null; problem: string | null }

/** The server accepts 20 messages; the last has to be the runner's. */
const MAX_MESSAGES = 19

/**
 * A short chat with Claude that fills in the goal form. Only the conversation goes to the server,
 * which adds the runner's COROS volume; Oura data never reaches the model.
 */
export function GoalChat({ onDraft }: { onDraft: (draft: GoalDraft, complete: boolean) => void }) {
  const [messages, setMessages] = useState<IntakeMessage[]>([])
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: (conversation: IntakeMessage[]) =>
      api<IntakeResult>('/api/ai/goal-intake', { method: 'POST', body: JSON.stringify({ messages: conversation }) }),
    onSuccess: (result, conversation) => {
      setMessages([...conversation, { role: 'assistant', content: result.reply }])
      setProblem(result.problem)
      onDraft(result.draft, result.goal !== null)
    },
    onError: (_error, conversation) => {
      // Put the unsent message back so it can be retried.
      setMessages(conversation.slice(0, -1))
      setText(conversation.at(-1)?.content ?? '')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const content = text.trim()
    if (!content || send.isPending) return
    const conversation: IntakeMessage[] = [...messages, { role: 'user', content }]
    setMessages(conversation)
    setText('')
    send.mutate(conversation)
  }
  const full = messages.length >= MAX_MESSAGES

  return (
    <section className="card goal-chat" aria-labelledby="goal-chat-heading">
      <h2 id="goal-chat-heading">Describe your goal</h2>
      <p className="small muted">
        Tell Claude about your race and when you can run, and it fills in the form below for you to
        check. It sees what you type here and your COROS training volume, never your Oura data.
      </p>
      {messages.length > 0 && (
        <ol className="chat-log" aria-live="polite">
          {messages.map((message, i) => (
            <li key={i} className={`chat-message ${message.role}`}>
              <span className="visually-hidden">{message.role === 'user' ? 'You: ' : 'Claude: '}</span>
              {message.content}
            </li>
          ))}
          {send.isPending && <li className="chat-message assistant muted">Thinking…</li>}
        </ol>
      )}
      {problem && <p className="notice warn">Almost: {problem}</p>}
      {send.error && <ErrorMessage error={send.error} />}
      <form className="chat-input" onSubmit={submit}>
        <textarea
          aria-label="Your message"
          rows={2}
          maxLength={2000}
          disabled={full}
          placeholder={
            messages.length === 0
              ? 'e.g. A half marathon on March 14. I can run Tuesday and Thursday mornings before 8, and long on Sundays.'
              : 'Reply…'
          }
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event)
          }}
        />
        <button type="submit" className="button" disabled={send.isPending || full || text.trim() === ''}>
          Send
        </button>
      </form>
      {full && <p className="small muted">That’s a long chat. Finish the details in the form below.</p>}
    </section>
  )
}
