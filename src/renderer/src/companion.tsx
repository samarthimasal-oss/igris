import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/sora'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import './companion.css'
import { CompanionApp } from './companion/CompanionApp'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <CompanionApp />
  </React.StrictMode>
)
