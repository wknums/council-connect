# CouncilConnect Municipal Email System - Deployment Guide

## Architecture Overview

The CouncilConnect Municipal Email System is deployed on Azure using the following architecture:

### Resources

- **Web App** (UK South): Node.js 22-lts hosting React frontend
- **Function App** (Sweden Central): Python 3.11 hosting backend API
- **Storage Account** (Sweden Central): Function App backing storage
- **Application Insights** (UK South): Monitoring and logging
- **Log Analytics Workspace** (UK South): Centralized logging
- **Key Vault** (UK South): Secure storage for connection strings and keys

### Multi-Region Architecture

The system is intentionally deployed across two regions:
- **Primary Region (UK South)**: Web App, Application Insights, Log Analytics, Key Vault
- **Secondary Region (Sweden Central)**: Function App, Storage Account

This architecture was established during development and is now stable and working.

## Deployment Instructions

### Prerequisites

1. **Azure CLI** installed and authenticated
2. **Azure Developer CLI (azd)** installed
3. **Node.js 22+** installed
4. **Python 3.11** installed
5. **Azure subscription** with appropriate permissions

### Environment Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd councilconnect-munic
```

2. Install dependencies:
```bash
npm install
cd src/backend
pip install -r requirements.txt
cd ../..
```

### Initial Deployment

1. **Initialize azd environment**:
```bash
azd init
```

2. **Deploy infrastructure and applications**:
```bash
azd up
```

This will:
- Deploy Bicep infrastructure to the `councilconnect-rg` resource group
- Build and deploy the React frontend to Azure Web App
- Build and deploy the Python Functions backend to Azure Function App
- Configure all environment variables and settings

### Manual Configuration Steps

After the initial deployment, some manual configuration may be required:

#### 1. Key Vault Secrets

Ensure the following secrets are configured in Key Vault:

```bash
# Cosmos DB primary key
az keyvault secret set --vault-name councilconnect-kv-uk2024 --name cosmos-primary-key --value "<cosmos-primary-key>"

# ACS connection string  
az keyvault secret set --vault-name councilconnect-kv-uk2024 --name acs-connection-string --value "<acs-connection-string>"
```

#### 2. Entra ID App Registration

Configure the Azure AD app registration:
- **Application ID**: `61b18a81-92b9-4852-82ff-66d451f110b9`
- **Tenant ID**: `16b3c013-d300-468d-ac64-7eda0820b6d3`
- **Redirect URIs**: 
  - `https://councilconnect-munic-web-gwawevemb0exffhv.uksouth-01.azurewebsites.net/redirect`
  - `http://localhost:5173/redirect` (for local development)

#### 3. CORS Configuration

The Function App CORS is automatically configured to allow:
- Azure Portal (`https://ms.portal.azure.com`)
- Web App domain
- Local development (`http://localhost:5000`)

### Environment Variables

#### Web App Environment Variables

The following environment variables are automatically configured:

```bash
VITE_API_BASE_URL=https://councilconnect-munic-func-c2bcdxfeerd8cphu.swedencentral-01.azurewebsites.net
VITE_PUBLIC_BASE_URL=https://councilconnect-munic-func-c2bcdxfeerd8cphu.swedencentral-01.azurewebsites.net/api
VITE_AUTH_MODE=entra
VITE_AUTH_CLIENT_ID=61b18a81-92b9-4852-82ff-66d451f110b9
VITE_AUTH_TENANT_ID=16b3c013-d300-468d-ac64-7eda0820b6d3
VITE_AUTH_AUTHORITY=https://login.microsoftonline.com/16b3c013-d300-468d-ac64-7eda0820b6d3/v2.0
VITE_AUTH_REDIRECT_URI=https://councilconnect-munic-web-gwawevemb0exffhv.uksouth-01.azurewebsites.net/redirect
VITE_AUTH_SCOPES=openid profile email
VITE_AUTH_BYPASS=false
```

#### Function App Environment Variables

Key environment variables for the Function App:

```bash
# Database Configuration
COSMOS_ENDPOINT=https://dev-cosmosdb-researchnlomaca4a7awm.documents.azure.com:443/
COSMOS_DB_NAME=CouncillorEmailDB
COSMOS_RECIPIENTS_CONTAINER=Recipients
COSMOS_DISTRIBUTION_LISTS_CONTAINER=DistributionLists
COSMOS_OPT_OUT_LISTS_CONTAINER=OptOutLists
COSMOS_SENT_EMAILS_CONTAINER=SentEmails
COSMOS_ENGAGEMENT_ANALYTICS_CONTAINER=EngagementAnalytics

# Email Configuration
ACS_EMAIL_DOMAIN=35db752d-d9a9-4dfa-8492-f192ca0e1176.azurecomm.net
ACS_EMAIL_SENDER=DoNotReply@35db752d-d9a9-4dfa-8492-f192ca0e1176.azurecomm.net
EMAIL_SENDER=DoNotReply@35db752d-d9a9-4dfa-8492-f192ca0e1176.azurecomm.net

# API Configuration
API_HOST=councilconnect-munic-func-c2bcdxfeerd8cphu.swedencentral-01.azurewebsites.net
PUBLIC_BASE_URL=https://councilconnect-munic-func-c2bcdxfeerd8cphu.swedencentral-01.azurewebsites.net

# Authentication Configuration
AUTH_TENANT_ID=16b3c013-d300-468d-ac64-7eda0820b6d3
AUTH_CLIENT_ID=be380296-24b1-4039-bc8b-aea0c46227d8
AUTH_BYPASS=true
AUTH_COUNCILLOR_CLAIM=oid
AUTH_FALLBACK_COUNCILLOR=default-councillor

# Feature Flags
ENABLE_EMAIL_SEND=true
ENABLE_ASYNC_SEND=true
ENABLE_INLINE_SEND=true
ENABLE_SEND_DIAGNOSTICS=true
BATCH_SIZE=1
MAX_CONCURRENT=2
```

## Bicep Infrastructure

The infrastructure is defined in `infra/main.bicep` and configured via `infra/main.parameters.json`.

### Key Features

1. **Multi-region deployment** with Web App in UK South and Function App in Sweden Central
2. **Separate service plans** for Web App (Basic B1) and Function App (Consumption Y1)
3. **CORS configuration** for cross-origin requests
4. **Key Vault integration** for secure secret management
5. **Application Insights** monitoring for both services
6. **Comprehensive environment variables** for all required configuration

### Resource Naming

Resources follow the naming convention:
- Web App: `councilconnect-munic-web`
- Function App: `councilconnect-munic-func`
- Storage Account: `councilconnectrg87c5`
- Key Vault: `councilconnect-kv-uk2024`
- App Service Plans: `councilconnect-munic-web-plan`, `ASP-councilconnectrg-bcef`

## Deployment Verification

After deployment, verify the system is working:

1. **Web App**: Navigate to the Web App URL and verify login works
2. **Function App**: Check that `/api/docs` endpoint returns API documentation
3. **Database**: Verify Cosmos DB containers are accessible
4. **Email**: Test email sending functionality
5. **Authentication**: Verify Entra ID login flow works correctly

## Troubleshooting

### Common Issues

1. **Double API Path**: Ensure `VITE_API_BASE_URL` does not include `/api` suffix
2. **CORS Errors**: Verify Function App CORS settings include Web App domain
3. **Authentication**: Check Entra ID app registration redirect URIs
4. **Database Connection**: Verify Cosmos DB key is correctly stored in Key Vault

### Logs and Monitoring

- **Application Insights**: Monitor both Web App and Function App performance
- **Log Analytics**: Centralized logging for all components
- **Azure Portal**: Real-time monitoring and diagnostics

## Local Development

For local development:

1. **Frontend**:
```bash
npm run dev
```

2. **Backend**:
```bash
cd src/backend
func start
```

3. **Environment**: Use `.env.local` for local configuration

## Production Maintenance

### Updating the Application

1. **Frontend changes**:
```bash
azd deploy frontend
```

2. **Backend changes**:
```bash
azd deploy api
```

3. **Infrastructure changes**:
```bash
azd up
```

### Monitoring

- Monitor Application Insights dashboards
- Review Function App execution logs
- Check Cosmos DB request units and performance
- Monitor email delivery rates via ACS analytics

This deployment architecture has been tested and verified to work correctly with the current configuration.