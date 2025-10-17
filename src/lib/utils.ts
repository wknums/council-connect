import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generates a councillor-specific storage key for data isolation
 * Uses the current subdomain or a fallback identifier
 * NOTE: Preferred British spelling (councillor). Former getCouncilorKey renamed.
 */
export function getCouncillorKey(baseKey: string): string {
  // Get the subdomain from the current hostname
  const globalScope = typeof window !== 'undefined' ? window as unknown as { __councillorContext?: { councillorId: string } } : undefined
  const override = globalScope?.__councillorContext?.councillorId
  if (override) return `${override}:${baseKey}`

  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const subdomain = hostname.split('.')[0] || 'default'

  // For development environments, use a fallback identifier
  const councillorId = subdomain === 'localhost' || subdomain.includes('localhost')
    ? 'default-councillor'
    : subdomain

  return `${councillorId}:${baseKey}`
}

