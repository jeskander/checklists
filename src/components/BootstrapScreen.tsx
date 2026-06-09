import './BootstrapScreen.css'

type Props = {
  message: string
  onRetry?: () => void
}

export function BootstrapScreen({ message, onRetry }: Props) {
  const offline = message.toLowerCase().includes('offline')

  return (
    <div className="bootstrap-screen">
      <div className="bootstrap-screen-inner">
        {!offline && <div className="bootstrap-spinner" aria-hidden />}
        <h1 className="bootstrap-title">{offline ? 'You\'re offline' : 'Loading your data'}</h1>
        <p className="bootstrap-message">
          {message || (offline ? 'Connect to the internet to load your checklists.' : 'Downloading from the cloud…')}
        </p>
        {offline && onRetry && (
          <button type="button" className="btn btn-primary bootstrap-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
