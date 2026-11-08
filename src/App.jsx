import { useState } from 'react'
import HomeScreen from './components/HomeScreen'
import SetupScreen from './components/SetupScreen'
import Dashboard from './components/Dashboard'
import PwaBanner from './components/PwaBanner'

export default function App() {
  const [view, setView] = useState('home')
  const [activeId, setActiveId] = useState(null)

  function startCareer(id) {
    setActiveId(id)
    setView('career')
  }

  if (view === 'setup') {
    return (
      <>
        <PwaBanner />
        <SetupScreen onStart={startCareer} onBack={() => setView('home')} />
      </>
    )
  }

  if (view === 'career' && activeId) {
    return (
      <>
        <PwaBanner />
        <Dashboard
          careerId={activeId}
          onNewCareer={() => setView('setup')}
          onSwitchCareer={(id) => { if (id) startCareer(id); else setView('home') }}
        />
      </>
    )
  }

  return (
    <>
      <PwaBanner />
      <HomeScreen onStart={startCareer} onNewCareer={() => setView('setup')} />
    </>
  )
}
