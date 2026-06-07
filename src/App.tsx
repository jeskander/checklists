import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ThemeProvider } from './context/ThemeContext'
import { UndoProvider } from './context/UndoContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LibraryPage } from './pages/LibraryPage'
import { TemplateEditorPage } from './pages/TemplateEditorPage'
import { CalendarPage } from './pages/CalendarPage'
import { DayPage } from './pages/DayPage'
import { SettingsPage } from './pages/SettingsPage'
import { TaskListsPage } from './pages/TaskListsPage'
import { TaskListEditorPage } from './pages/TaskListEditorPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { QueryProvider } from './context/QueryProvider'
function AppRoutes() {
  const { session, loading, isRecovery } = useAuth()

  if (loading) return null

  // User arrived via a password-reset email link
  if (isRecovery) {
    return (
      <Routes>
        <Route path="*" element={<ResetPasswordPage />} />
      </Routes>
    )
  }

  // Not signed in — show auth pages
  if (!session) {
    return (
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  // Signed in — show the app
  return (
    <UndoProvider>
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
    </UndoProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </QueryProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
