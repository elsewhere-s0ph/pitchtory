import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Dashboard from './components/Dashboard'
import { listCareers } from './db'
import PwaBanner from './components/PwaBanner'

export default function App() {
  const [activeId, setActiveId] = useState(null)
  const [showSetup, setShowSetup] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    listCareers()
      .then((cs) => {
        if (cs.length > 0) setActiveId(cs[0].id)
        else setShowSetup(true)
        setReady(true)
      })
      .catch(() => {
        setShowSetup(true)
        setReady(true)
      })
  }, [])

  if (!ready) return null

  if (showSetup || !activeId) {
    return (
      <>
        <PwaBanner />
        <SetupScreen onStart={(id) => { setActiveId(id); setShowSetup(false) }} />
      </>
    )
  }

  return (
    <>
      <PwaBanner />
      <Dashboard
        careerId={activeId}
        onNewCareer={() => setShowSetup(true)}
        onSwitchCareer={(id) => { setActiveId(id); setShowSetup(false) }}
      />
    </>
  )
}
