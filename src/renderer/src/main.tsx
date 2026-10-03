import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installBridge } from './bridge'
import { initTheme } from './theme'
import '@fontsource-variable/public-sans/index.css'
import './styles.css'

installBridge()
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
