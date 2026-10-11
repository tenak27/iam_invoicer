import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installBridge } from './bridge'
import { initTheme } from './theme'
import { installRipple, installTilt } from './components/fx'
import '@fontsource-variable/public-sans/index.css'
import './styles.css'

installBridge()
initTheme()
installRipple()
installTilt()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
