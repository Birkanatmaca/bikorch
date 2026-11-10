import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, Globe, ImagePlus, Paperclip, SquarePen, Square, Sparkles, X } from 'lucide-react'
import {
  HOME_CHAT_IMAGE_TYPES,
  HOME_CHAT_MAX_IMAGES,
  HOME_CHAT_MAX_INPUT,
  type HomeChatImage,
  type HomeChatMessage,
  type HomeChatState
} from '@shared/contracts/dashboard'
import { cn } from '@renderer/lib/utils'
import { Markdown } from './Markdown'
import { isSupportedImage, loadChatImage, prepareImage, type PreparedImage } from './chat-images'

const SUGGESTIONS = [
  'Paste a screenshot or photo and ask about it',
  "What's in the news today?",
  'Explain compound interest with a simple example',
  'Plan a 3-day trip to Istanbul on a budget',
  'Why does this regex not match? ^\\d{3}-\\d{4}$'
]

const EMPTY: HomeChatState = { messages: [], streaming: null, activity: null, error: null }

function CopyMessage({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="home-chat-copy"
      aria-label="Copy answer"
      title="Copy answer"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
    </button>
  )
}

function StoredImage({ image, onOpen }: { image: HomeChatImage; onOpen: (url: string) => void }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void loadChatImage(image.id).then((value) => { if (alive) setUrl(value) })
    return () => { alive = false }
  }, [image.id])
  if (!url) return <span className="home-chat-thumb is-missing" title={image.name}>{image.name}</span>
  return (
    <button type="button" className="home-chat-thumb" onClick={() => onOpen(url)} title={image.name} aria-label={`Open ${image.name}`}>
      <img src={url} alt={image.name} />
    </button>
  )
}

function Message({ message, onOpen }: { message: HomeChatMessage; onOpen: (url: string) => void }): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="home-chat-msg is-user">
        {message.images && message.images.length > 0 && (
          <div className="home-chat-thumbs">
            {message.images.map((image) => <StoredImage key={image.id} image={image} onOpen={onOpen} />)}
          </div>
        )}
        {message.text && <p>{message.text}</p>}
      </div>
    )
  }
  return (
    <div className={cn('home-chat-msg is-assistant', message.incomplete && 'is-incomplete')}>
      <Markdown text={message.text} />
      <div className="home-chat-msg-foot">
        {message.incomplete && <span>Stopped early</span>}
        <CopyMessage text={message.text} />
      </div>
    </div>
  )
}

/**
 * Home's free chat with Claude. The conversation lives in the main process,
 * so it survives switching tabs and restarting the app; follow-ups keep context.
 */
export function ChatWidget(): React.JSX.Element {
  const [state, setState] = useState<HomeChatState>(EMPTY)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<PreparedImage[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)
  const busy = state.streaming !== null || sending

  useEffect(() => {
    const chat = window.api?.dashboard?.chat
    if (!chat) return
    let alive = true
    void chat.history().then((next) => { if (alive) setState(next) }).catch(() => undefined)
    const stop = chat.onEvent((event) => {
      if (event.type === 'state') setState(event.state)
      else if (event.type === 'delta') setState((current) => ({ ...current, streaming: (current.streaming ?? '') + event.text, activity: null }))
      else setState((current) => ({ ...current, activity: event.activity }))
    })
    return () => {
      alive = false
      stop()
    }
  }, [])

  // Follow the answer while the reader is at the bottom; leave them be if they scrolled up.
  useLayoutEffect(() => {
    const list = listRef.current
    if (list && pinned.current) list.scrollTop = list.scrollHeight
  }, [state])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`
  }, [draft])

  const addFiles = (files: File[]): void => {
    const images = files.filter(isSupportedImage)
    if (images.length === 0) {
      if (files.length > 0) setAttachError('Only PNG, JPEG, GIF and WebP images can be sent')
      return
    }
    setAttachError(null)
    const room = HOME_CHAT_MAX_IMAGES - attachments.length
    if (images.length > room) setAttachError(`Up to ${HOME_CHAT_MAX_IMAGES} images per message`)
    void Promise.allSettled(images.slice(0, Math.max(0, room)).map(prepareImage)).then((results) => {
      const ready = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) setAttachError(failed.reason instanceof Error ? failed.reason.message : 'An image could not be read')
      setAttachments((current) => [...current, ...ready].slice(0, HOME_CHAT_MAX_IMAGES))
    })
    inputRef.current?.focus()
  }

  const send = (text: string): void => {
    const question = text.trim()
    const chat = window.api?.dashboard?.chat
    if ((!question && attachments.length === 0) || busy || !chat) return
    const images = attachments
    setSending(true)
    setDraft('')
    setAttachments([])
    setAttachError(null)
    pinned.current = true
    chat.send({ text: question, images: images.map(({ name, mediaType, data }) => ({ name, mediaType, data })) })
      .then(setState)
      .catch((cause: unknown) => {
        setDraft(question)
        setAttachments(images)
        setState((current) => ({ ...current, error: cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not send' }))
      })
      .finally(() => setSending(false))
  }

  const empty = state.messages.length === 0 && state.streaming === null

  return (
    <div
      className={cn('home-chat', dragging && 'is-dragging')}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return
        event.preventDefault()
        setDragging(false)
        addFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {dragging && (
        <div className="home-chat-drop" aria-hidden>
          <ImagePlus className="h-5 w-5" />
          Drop images to ask about them
        </div>
      )}
      {zoom && (
        <button type="button" className="home-chat-zoom" onClick={() => setZoom(null)} aria-label="Close image">
          <img src={zoom} alt="" />
        </button>
      )}
      <div
        ref={listRef}
        className="home-chat-list"
        onScroll={(event) => {
          const list = event.currentTarget
          pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40
        }}
        aria-live="polite"
      >
        {empty ? (
          <div className="home-chat-empty">
            <Sparkles className="h-5 w-5" aria-hidden />
            <strong>Ask Claude anything</strong>
            <p>Any question, any topic. Claude searches the web for current facts, and you can paste or drop images to ask about them.</p>
            <div className="home-chat-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => send(suggestion)}>{suggestion}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {state.messages.map((message) => <Message key={message.id} message={message} onOpen={setZoom} />)}
            {state.streaming !== null && (
              <div className="home-chat-msg is-assistant is-streaming">
                {state.streaming ? <Markdown text={state.streaming} /> : null}
                {(state.activity || !state.streaming) && (
                  <span className="home-chat-activity">
                    {state.activity === 'Searching the web' || state.activity === 'Reading a page'
                      ? <Globe className="h-3 w-3" aria-hidden />
                      : <Sparkles className="h-3 w-3" aria-hidden />}
                    {state.activity ?? 'Thinking'}…
                  </span>
                )}
              </div>
            )}
          </>
        )}
        {state.error && <p className="home-chat-error" role="alert">{state.error}</p>}
      </div>

      {(attachments.length > 0 || attachError) && (
        <div className="home-chat-attachments">
          {attachments.map((image) => (
            <span key={image.key} className="home-chat-attachment" title={image.name}>
              <img src={image.preview} alt={image.name} />
              <button
                type="button"
                onClick={() => setAttachments((current) => current.filter((entry) => entry.key !== image.key))}
                aria-label={`Remove ${image.name}`}
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            </span>
          ))}
          {attachError && <span className="home-chat-attach-error">{attachError}</span>}
        </div>
      )}

      <form
        className="home-chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          send(draft)
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length === 0) return
            event.preventDefault()
            addFiles(files)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send(draft)
            }
          }}
          placeholder={busy ? 'Claude is answering…' : 'Ask Claude…  (Shift+Enter for a new line)'}
          rows={1}
          maxLength={HOME_CHAT_MAX_INPUT}
          aria-label="Message Claude"
        />
        <div className="home-chat-actions">
          <input
            ref={fileRef}
            type="file"
            accept={HOME_CHAT_IMAGE_TYPES.join(',')}
            multiple
            hidden
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className="home-icon-button"
            onClick={() => fileRef.current?.click()}
            disabled={attachments.length >= HOME_CHAT_MAX_IMAGES}
            aria-label="Attach images"
            title="Attach images (or paste / drop them)"
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="home-icon-button"
            onClick={() => void window.api?.dashboard?.chat.reset().then(setState)}
            disabled={empty && !state.error}
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen className="h-3.5 w-3.5" aria-hidden />
          </button>
          {state.streaming !== null ? (
            <button
              type="button"
              className="home-chat-send is-stop"
              onClick={() => void window.api?.dashboard?.chat.stop()}
              aria-label="Stop answering"
              title="Stop"
            >
              <Square className="h-3 w-3" aria-hidden />
            </button>
          ) : (
            <button type="submit" className="home-chat-send" disabled={(!draft.trim() && attachments.length === 0) || busy} aria-label="Send" title="Send (Enter)">
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
