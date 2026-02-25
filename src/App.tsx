import './App.css'
import LiveChart from './components/LiveChart'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Monitoring Dashboard</h1>
      </header>
      <main className="app-main">
        <LiveChart />
      </main>
    </div>
  )
}

export default App
