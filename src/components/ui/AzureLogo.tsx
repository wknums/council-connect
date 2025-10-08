interface AzureLogoProps {
  size?: number
  className?: string
}

export function AzureLogo({ size = 20, className = "" }: AzureLogoProps) {
  return (
    <img
      src="https://azure.microsoft.com/svghandler/bot-service/?width=600&height=315"
      width={size}
      height={size * 0.525} // Maintain the original aspect ratio (315/600)
      className={className}
      alt="Microsoft Azure Bot Service"
      style={{ objectFit: 'contain' }}
    />
  )
}