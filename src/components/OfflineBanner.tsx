import { subscribeSyncStatus } from '../sync/syncEngine'
import { useEffect, useState } from 'react'
import './OfflineBanner.css'

export function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => subscribeSyncStatus((s) => setOnline(s.online)), [])

  if (online) return null

  return (
    <div className="offline-banner" role="status">
      Offline — connect to save changes
    </div>
  )
}
