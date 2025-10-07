import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generates a councilor-specific storage key for data isolation
 * Uses the current subdomain or a fallback identifier
 */
export function getCouncilorKey(baseKey: string): string {
  // Get the subdomain from the current hostname
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const subdomain = hostname.split('.')[0] || 'default'
  
  // For development environments, use a fallback identifier
  const councilorId = subdomain === 'localhost' || subdomain.includes('localhost') 
    ? 'default-councilor' 
    : subdomain
  
  return `${councilorId}:${baseKey}`
}
