# App Registration Setup Guide

This document explains how the CouncilConnect Municipal system handles Azure AD App Registration configuration for authentication.

## Overview

Due to limitations in Azure Resource Manager (ARM) and Bicep templates, Azure AD App Registrations cannot be directly managed through infrastructure-as-code. Instead, we use a hybrid approach:

1. **Bicep Template**: Manages all Azure resources (App Service, Function App, Key Vault, etc.) and configures authentication settings
2. **PowerShell Script**: Creates and manages the Azure AD App Registration
3. **Parameter File**: Stores the App Registration configuration for reuse

## Current Configuration

Your existing App Registration:
- **Name**: `CouncilConnect-SPA`
- **Client ID**: `61b18a81-******92b9-4852-82ff-66d451f110******b9`
- **Tenant ID**: `16b3c013-****d300-468d-ac64-7eda0820b6****d3`
- **Type**: Single Page Application (SPA)
- **Authentication Flow**: Implicit Grant (Access Tokens + ID Tokens)

## Deployment Scenarios

### Scenario 1: Existing Environment (Your Current Setup)
When deploying to an environment where the App Registration already exists:

1. The Bicep template uses the existing App Registration via parameters
2. No additional setup required
3. Authentication works with existing configuration

### Scenario 2: New Environment
When deploying to a new environment (new tenant, new app registration needed):

1. **Run the setup script first**:
   ```powershell
   ./scripts/setup-app-registration.ps1 -NamePrefix "councilconnect-new" -WebAppName "councilconnect-new-web" -TenantId "your-tenant-id"
   ```

2. **Update parameters file** with the new App Registration details:
   ```json
   {
     "authClientId": { "value": "new-app-id" },
     "authTenantId": { "value": "your-tenant-id" },
     "authAuthority": { "value": "https://login.microsoftonline.com/your-tenant-id/v2.0" }
   }
   ```

3. **Deploy with azd**:
   ```bash
   azd up
   ```

## What the Setup Script Does

The `setup-app-registration.ps1` script:

1. **Checks** if an App Registration with the specified name already exists
2. **Creates** a new App Registration if it doesn't exist, or **updates** the existing one
3. **Configures** the following settings:
   - Display Name: `CouncilConnect-SPA-{namePrefix}`
   - Sign-in Audience: `AzureADMyOrg` (single tenant)
   - Redirect URIs for both production and development
   - Implicit Grant flow enabled
   - Microsoft Graph API permissions (openid, profile, email)
4. **Updates** the Bicep parameters file automatically
5. **Outputs** the configuration details for verification

## Required Redirect URIs

The App Registration is configured with these redirect URIs:
- `https://{webAppName}.azurewebsites.net/` - Main app URL
- `https://{webAppName}.azurewebsites.net/redirect` - Auth callback URL
- `http://localhost:5173/` - Development URL
- `http://localhost:5173/redirect` - Development auth callback

## API Permissions

The App Registration requires these Microsoft Graph permissions:
- `openid` (37f7f235-527c-4136-accd-4a02d197296e) - Basic OpenID Connect
- `profile` (14dad69e-099b-42c9-810b-d002981feec1) - User profile information
- `email` (64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0) - User email address

## Bicep Integration

The Bicep template handles App Registration configuration through:

1. **Parameters**: Client ID, Tenant ID, Authority URL, Scopes
2. **Environment Variables**: Frontend authentication configuration
3. **Backend Settings**: Authentication validation settings
4. **CORS Configuration**: Allows authentication redirects
5. **Outputs**: Provides reference values for verification

## Manual Setup (Alternative)

If you prefer to set up the App Registration manually:

1. **Navigate** to Azure Portal > Azure Active Directory > App Registrations
2. **Create** new registration with name `CouncilConnect-SPA-{namePrefix}`
3. **Configure** redirect URIs in Authentication section
4. **Enable** implicit grant flow (Access tokens + ID tokens)
5. **Add** Microsoft Graph API permissions
6. **Update** the Bicep parameters file with the new Client ID

## Troubleshooting

### Common Issues:
1. **403 Forbidden**: User lacks permissions to create App Registrations
   - Solution: Request Application Administrator role or have admin run the script

2. **Redirect URI Mismatch**: Authentication fails with redirect errors
   - Solution: Verify redirect URIs match the deployed web app URL

3. **Missing Permissions**: Login works but API calls fail
   - Solution: Verify Microsoft Graph permissions are granted and admin consent provided

### Verification Commands:
```bash
# Check App Registration details
az ad app show --id {client-id}

# List redirect URIs
az ad app show --id {client-id} --query "spa.redirectUris"

# Check API permissions
az ad app show --id {client-id} --query "requiredResourceAccess"
```

## Benefits of This Approach

1. **Reusability**: Can deploy to multiple environments easily
2. **Version Control**: Scripts and configurations are tracked in Git
3. **Automation**: Can be integrated into CI/CD pipelines
4. **Documentation**: Clear setup process for new team members
5. **Flexibility**: Can handle both new and existing App Registrations