import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import '../lib/monaco'
import '../styles/globals.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
