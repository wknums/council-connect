import { Building } from "@phosphor-icons/react"

interface LogoProps {
  size?: number
  className?: string
}

export function Logo({ size = 32, className = "" }: LogoProps) {
  return (
    <div className={`flex items-center justify-center rounded-full bg-primary text-primary-foreground ${className}`} 
         style={{ width: size, height: size }}>
      <Building size={size * 0.6} weight="fill" />
    </div>
  )
}