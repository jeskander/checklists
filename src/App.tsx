import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ThemeProvider } from './context/ThemeContext'
import { UndoProvider } from './context/UndoContext'
import { LibraryPage } from './pages/LibraryPage'
import { TemplateEditorPage } from './pages/TemplateEditorPage'
import { CalendarPage } from './pages/CalendarPage'
import { DayPage } from './pages/DayPage'
import { SettingsPage } from './pages/SettingsPage'
import { TaskListsPage } from './pages/TaskListsPage'
import { TaskListEditorPage } from './pages/TaskListEditorPage'
import { NotionSync } from './sync/NotionSync'

export default function App() {
  return (
    <ThemeProvider>
      <UndoProvider>
        <NotionSync />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/calendar" replace />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="library/:id" element={<TemplateEditorPage />} />
              <Route path="tasks" element={<TaskListsPage />} />
              <Route path="tasks/:id" element={<TaskListEditorPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="calendar/:date" element={<DayPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </UndoProvider>
    </ThemeProvider>
  )
}
