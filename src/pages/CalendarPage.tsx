import { Navigate } from 'react-router-dom'
import { todayDateString } from '../lib/ids'
import { getLastCalendarDate } from '../lib/lastCalendarDate'

export function CalendarPage() {
  const date = getLastCalendarDate() ?? todayDateString()
  return <Navigate to={`/calendar/${date}`} replace />
}
