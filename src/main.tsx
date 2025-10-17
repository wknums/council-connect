import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import "@github/spark/spark"

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { AuthProvider } from '@/auth/AuthProvider'

import "./main.css"
import "./index.css"

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <App />
    </ErrorBoundary>
  </AuthProvider>
)
