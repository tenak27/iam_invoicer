import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installBridge } from './bridge'
import { initTheme } from './theme'
import { initTouch } from './socle/touch'
import { installMagnet, installReveal, installRipple, installSpotlight, installTilt } from './components/fx'
import '@fontsource-variable/public-sans/index.css'
import './fonts.css'
import './styles.css'
import './mobile.css'
import './socle/socle.css'

installBridge()
initTheme()
initTouch()
installRipple()
installTilt()
installSpotlight()
installMagnet()
installReveal()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
