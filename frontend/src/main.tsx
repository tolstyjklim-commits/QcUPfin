import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthGate } from './auth'
import './styles.css'
import './ext.css'
import './polish.css'

const tg = (window as any).Telegram?.WebApp
tg?.ready?.()
tg?.expand?.()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AuthGate><App /></AuthGate></React.StrictMode>,
)
