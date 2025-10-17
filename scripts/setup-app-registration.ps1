# Setup App Registration for CouncilConnect Municipal
param(
    [Parameter(Mandatory=$true)]
    [string]$NamePrefix,
    
    [Parameter(Mandatory=$true)]
    [string]$WebAppName,
    
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [string]$AppName = "CouncilConnect-SPA-$NamePrefix"
)

Write-Host "Setting up App Registration: $AppName" -ForegroundColor Green

# Check if App Registration already exists
$existingApp = az ad app list --display-name $AppName --query "[0]" | ConvertFrom-Json

if ($existingApp) {
    Write-Host "App Registration '$AppName' already exists with ID: $($existingApp.appId)" -ForegroundColor Yellow
    $appId = $existingApp.appId
    
    # Update redirect URIs to include current web app URL
    Write-Host "Updating redirect URIs..." -ForegroundColor Blue
    $webAppUrl = "https://$WebAppName.azurewebsites.net"
    
    az ad app update --id $appId `
        --web-redirect-uris "$webAppUrl" "$webAppUrl/redirect" "http://localhost:5173/" "http://localhost:5173/redirect" `
        --web-home-page-url $webAppUrl
        
} else {
    Write-Host "Creating new App Registration..." -ForegroundColor Blue
    $webAppUrl = "https://$WebAppName.azurewebsites.net"
    
    # Create the App Registration
    $appResult = az ad app create `
        --display-name $AppName `
        --sign-in-audience "AzureADMyOrg" `
        --web-home-page-url $webAppUrl `
        --web-redirect-uris "$webAppUrl" "$webAppUrl/redirect" "http://localhost:5173/" "http://localhost:5173/redirect" `
        --enable-access-token-issuance true `
        --enable-id-token-issuance true | ConvertFrom-Json
        
    $appId = $appResult.appId
    Write-Host "Created App Registration with ID: $appId" -ForegroundColor Green
    
    # Add Microsoft Graph API permissions
    Write-Host "Adding Microsoft Graph permissions..." -ForegroundColor Blue
    
    # OpenID Connect permissions
    az ad app permission add --id $appId --api "00000003-0000-0000-c000-000000000000" --api-permissions "37f7f235-527c-4136-accd-4a02d197296e=Scope" # openid
    az ad app permission add --id $appId --api "00000003-0000-0000-c000-000000000000" --api-permissions "14dad69e-099b-42c9-810b-d002981feec1=Scope" # profile
    az ad app permission add --id $appId --api "00000003-0000-0000-c000-000000000000" --api-permissions "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0=Scope" # email
    
    Write-Host "Added Microsoft Graph permissions" -ForegroundColor Green
}

# Output the configuration for Bicep parameters
Write-Host "`n=== App Registration Configuration ===" -ForegroundColor Cyan
Write-Host "App ID (Client ID): $appId"
Write-Host "Tenant ID: $TenantId"
Write-Host "Authority: https://login.microsoftonline.com/$TenantId/v2.0"
Write-Host "Redirect URI: https://$WebAppName.azurewebsites.net/redirect"

# Update the Bicep parameters file if it exists
$parametersFile = "infra/main.parameters.json"
if (Test-Path $parametersFile) {
    Write-Host "`nUpdating Bicep parameters file..." -ForegroundColor Blue
    
    $parameters = Get-Content $parametersFile | ConvertFrom-Json
    $parameters.parameters.authClientId.value = $appId
    $parameters.parameters.authTenantId.value = $TenantId
    $parameters.parameters.authAuthority.value = "https://login.microsoftonline.com/$TenantId/v2.0"
    
    $parameters | ConvertTo-Json -Depth 10 | Set-Content $parametersFile
    Write-Host "Updated $parametersFile with new App Registration details" -ForegroundColor Green
}

Write-Host "`n✅ App Registration setup completed!" -ForegroundColor Green
Write-Host "You can now run 'azd up' to deploy with the configured App Registration."