import { useState } from 'react'
import { useKV } from '@github/spark/hooks'

// Environment flag evaluated once at module load for stable hook ordering.
const kvEnabled = (import.meta as any).env?.VITE_FE_TEST_KV === 'true'

/**
 * useOptionalKV mirrors useKV's tuple API but avoids hitting Spark KV when
 * the app is running in API mode (kvEnabled === false). In API mode it
 * simply provides local in-memory state with the provided default value.
 * This prevents 401/403 or rate-limit noise from the dev Spark service.
 */
export function useOptionalKV<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  if (kvEnabled) {
    // useKV returns a readonly tuple (value | undefined, setter, refetch). We only need value + setter.
    const [val, setVal] = useKV<T>(key, defaultValue) as unknown as [T, React.Dispatch<React.SetStateAction<T>>]
    return [val ?? defaultValue, setVal]
  }
  return useState<T>(defaultValue)
}
