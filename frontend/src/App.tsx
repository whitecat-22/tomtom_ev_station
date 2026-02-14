import MapComponent from './MapComponent'

function App() {
  return (
    <div className="App">
      <MapComponent />

      {/* Overlay UI */}
      <div style={{
          position: 'absolute',
          top: '30px',
          left: '30px',
          zIndex: 10,
          background: 'rgba(15, 15, 15, 0.75)',
          backdropFilter: 'blur(12px)',
          padding: '24px',
          borderRadius: '16px',
          color: 'white',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          maxWidth: '300px'
      }}>
          <h1 style={{
              margin: '0 0 8px 0',
              fontSize: '1.4rem',
              fontWeight: 700,
              letterSpacing: '-0.5px',
              background: 'linear-gradient(135deg, #FF0000 0%, #FF0000 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
          }}>
              EV Station WebGIS
          </h1>
          <p style={{
              margin: 0,
              fontSize: '0.85rem',
              opacity: 0.7,
              lineHeight: 1.5
          }}>
              Real-time charging availability and locations powered by TomTom Orbis.
          </p>

          <div style={{
              marginTop: '20px',
              paddingTop: '15px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
          }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#FF0000', boxShadow: '0 0 8px #FF0000' }}></div>
              <span>EV Charging Station</span>
          </div>
      </div>
    </div>
  )
}

export default App
