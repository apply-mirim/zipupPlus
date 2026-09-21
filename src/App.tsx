import { Navigate, Route, Routes } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Home from './pages/Home'
import Glossary from './pages/Glossary'
import LawSearch from './pages/LawSearch'
import Privacy from './pages/Privacy'
import Profile from './pages/Profile'
import ScoringGuide from './pages/ScoringGuide'
import SignalMap from './pages/SignalMap'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/scoring" element={<ScoringGuide />} />
      <Route path="/glossary" element={<Glossary />} />
      {/* TopNav 등 어디에도 링크하지 않는다 — search-legal-terms Edge Function이 법제처 IP
       * 화이트리스트에 막혀 아직 정상 동작하지 않는다(docs/PROJECT_OVERVIEW.md 참고). */}
      <Route path="/law-search" element={<LawSearch />} />

      <Route element={<MainLayout />}>
        <Route path="/home" element={<Home />} />
        <Route path="/map" element={<SignalMap />} />
        <Route path="/profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
