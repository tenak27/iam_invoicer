import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installBridge } from './bridge'
import { DemoNotice } from './components/DemoNotice'
import { initTheme } from './theme'
import { initTouch } from './socle/touch'
import '@fontsource-variable/public-sans/index.css'
import './fonts.css'
import './styles.css'
import './mobile.css'
import './socle/socle.css'
// En dernier : mouvement commun (règles d'Emil Kowalski), qui remplace celui de la feuille de base
import './socle/motion.css'

installBridge()
initTheme()
initTouch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <DemoNotice />
  </StrictMode>
)
