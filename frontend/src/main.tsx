import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { initializeTheme, ThemeProvider } from './theme'
import './styles.css'

initializeTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
