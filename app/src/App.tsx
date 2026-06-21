import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Landing } from './screens/Landing'
import { Login } from './screens/Login'
import { Onboarding } from './screens/Onboarding'
import { Home } from './screens/Home'
import { Profile } from './screens/Profile'
import { ThemeProvider } from './features/theme'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/landing" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/home" element={<Home />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
