@description('Azure region for all new resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Azure region for Function App. Defaults to main location.')
param functionAppLocation string = location

@description('Prefix applied to resource names for uniqueness and governance tagging.')
param namePrefix string

@description('Globally unique name for the Web App hosting the front-end.')
param webAppName string = '${namePrefix}-web'

@description('Name of the App Service plan for the Web App.')
param webAppPlanName string = '${namePrefix}-web-plan'

@description('Set to true to reuse an existing App Service plan for the Web App instead of creating a new one.')
param useExistingWebAppPlan bool = false

@description('Set to true to reuse an existing Web App instead of creating a new one.')
param useExistingWebApp bool = false

@description('Apply configuration updates (runtime, app settings, logging) when targeting an existing Web App.')
param configureExistingWebApp bool = true

@description('Set to true to reuse an existing Function App instead of creating a new one.')
param useExistingFunctionApp bool = false

@description('SKU configuration object for the Web App Service plan.')
param webAppPlanSku object = {
  name: 'B1'
  tier: 'Basic'
  size: 'B1'
  family: 'B'
  capacity: 1
}

@description('Name of the Function App.')
param functionAppName string = '${namePrefix}-func'

@description('Name of the Function App service plan.')
param functionAppPlanName string = 'ASP-${namePrefix}rg-bcef'

@description('Set to true to reuse an existing Function App service plan instead of creating a new one.')
param useExistingFunctionAppPlan bool = false

@description('Name of the storage account backing the Function App. Must be globally unique, 3-24 lowercase characters.')
@minLength(3)
@maxLength(24)
param storageAccountName string = toLower(replace('${namePrefix}sa', '-', ''))

@description('Name of the Application Insights resource (workspace-based).')
param applicationInsightsName string = '${namePrefix}-appi'

@description('Name of the Log Analytics workspace used for centralized logging.')
param logAnalyticsWorkspaceName string = '${namePrefix}-law'

@description('Name of the Key Vault that will store application secrets.')
param keyVaultName string = '${namePrefix}-kv'

@description('Existing resource group that contains the Azure Cosmos DB account.')
param cosmosAccountResourceGroup string

@description('Existing Azure Cosmos DB account name (SQL API).')
param cosmosAccountName string

@description('Name of the Cosmos DB database used by the application.')
param cosmosDatabaseName string

@description('Name of the Cosmos DB container used for the single-container dev mode.')
param cosmosDevContainerName string

@description('Email address configured for ACS to send from.')
param emailSenderAddress string

@description('Name of the Key Vault secret that will store the Cosmos DB primary key.')
param cosmosKeySecretName string = 'cosmos-primary-key'

@description('Name of the Key Vault secret that will store the ACS Email connection string.')
param acsConnectionSecretName string = 'acs-email-connection-string'

@description('Toggle inline email dispatch at runtime.')
param enableInlineSend bool = true

@description('Toggle async email dispatch mode at runtime.')
param enableAsyncSend bool = true

@description('Authentication mode for the frontend application. Use "entra" for Entra ID, "b2c" for Azure AD B2C, or "off" to disable authentication.')
@allowed(['entra', 'b2c', 'off'])
param authMode string = 'off'

@description('Azure AD / Entra ID application (client) ID used for authentication.')
param authClientId string = ''

@description('Azure AD / Entra ID tenant ID used for authentication.')
param authTenantId string = ''

@description('Azure AD B2C policy name for sign-up and sign-in (only required when authMode is "b2c").')
param authB2CSignUpSignInPolicy string = ''

@description('Azure AD B2C policy name for password reset (only required when authMode is "b2c").')
param authB2CResetPolicy string = ''

@description('Azure AD B2C policy name for profile editing (only required when authMode is "b2c").')
param authB2CEditProfilePolicy string = ''

@description('Authentication scopes for the frontend application (space-separated).')
param authScopes string = 'openid profile email'

@description('Custom authentication authority URL (optional, will auto-generate if empty).')
param authAuthority string = ''

@description('Disable authentication entirely for testing (not recommended for production).')
param authBypass bool = false

// NOTE: App Registration must be created separately using scripts/setup-app-registration.ps1
// Bicep cannot directly manage Azure AD App Registrations due to ARM limitations

var tags = {
  Project: namePrefix
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2025-04-15' existing = {
  name: cosmosAccountName
  scope: resourceGroup(cosmosAccountResourceGroup)
}

// App Registration Configuration Documentation
// Required settings for CouncilConnect-SPA App Registration:
// - Display Name: CouncilConnect-SPA-${namePrefix}
// - Sign-in Audience: AzureADMyOrg
// - Redirect URIs: 
//   * https://${webAppName}.azurewebsites.net/
//   * https://${webAppName}.azurewebsites.net/redirect
//   * http://localhost:5173/
//   * http://localhost:5173/redirect
// - Implicit Grant: Access tokens and ID tokens enabled
// - API Permissions: Microsoft Graph (openid, profile, email)

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' existing = {
  name: storageAccountName
}

var storageKeys = storage.listKeys()
var storageAccountKey = storageKeys.keys[0].value
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storageAccountKey};EndpointSuffix=${environment().suffixes.storage}'

resource keyVault 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    enabledForTemplateDeployment: true
    enableRbacAuthorization: false
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenant().tenantId
    accessPolicies: []
  }
}

resource webPlanExisting 'Microsoft.Web/serverfarms@2024-11-01' existing = if (useExistingWebAppPlan) {
  name: webAppPlanName
}

resource webPlanNew 'Microsoft.Web/serverfarms@2024-11-01' = if (!useExistingWebAppPlan) {
  name: webAppPlanName
  location: location
  tags: tags
  kind: 'linux'
  sku: webAppPlanSku
  properties: {
    reserved: true
  }
}

var webPlanId = useExistingWebAppPlan ? webPlanExisting.id : webPlanNew.id

resource functionPlanExisting 'Microsoft.Web/serverfarms@2024-11-01' existing = if (useExistingFunctionAppPlan) {
  name: functionAppPlanName
}

resource functionPlanNew 'Microsoft.Web/serverfarms@2024-11-01' = if (!useExistingFunctionAppPlan) {
  name: functionAppPlanName
  location: functionAppLocation
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

var functionPlanId = useExistingFunctionAppPlan ? functionPlanExisting.id : functionPlanNew.id

resource webAppExisting 'Microsoft.Web/sites@2024-11-01' existing = if (useExistingWebApp) {
  name: webAppName
}

resource webApp 'Microsoft.Web/sites@2024-11-01' = if (!useExistingWebApp) {
  name: webAppName
  location: location
  tags: union(tags, { 'azd-service-name': 'frontend' })
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    reserved: true
    httpsOnly: true
    serverFarmId: webPlanId
  }
}

var webAppSiteConfigProperties = {
  linuxFxVersion: 'NODE|22-lts'
  ftpsState: 'Disabled'
  minTlsVersion: '1.2'
  scmMinTlsVersion: '1.2'
  appCommandLine: 'npx serve -s dist -p 8080'
}

// Generate authority URL if not provided
var generatedAuthority = authMode == 'entra' && !empty(authTenantId) 
  ? 'https://${environment().authentication.loginEndpoint}${authTenantId}/v2.0'
  : authMode == 'b2c' && !empty(authTenantId)
    ? 'https://${authTenantId}.b2clogin.com/${authTenantId}.onmicrosoft.com/${authB2CSignUpSignInPolicy}'
    : 'https://${environment().authentication.loginEndpoint}common'

var effectiveAuthority = !empty(authAuthority) ? authAuthority : generatedAuthority

var webAppAppSettings = {
  WEBSITE_RUN_FROM_PACKAGE: '1'
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
  VITE_API_BASE_URL: format('https://{0}.azurewebsites.net', functionAppName)
  VITE_PUBLIC_BASE_URL: format('https://{0}.azurewebsites.net/api', functionAppName)
  WEBSITE_NODE_DEFAULT_VERSION: '~22'
  VITE_AUTH_MODE: authMode
  VITE_AUTH_CLIENT_ID: authClientId
  VITE_AUTH_TENANT_ID: authTenantId
  VITE_AUTH_SCOPES: authScopes
  VITE_AUTH_AUTHORITY: effectiveAuthority
  VITE_AUTH_BYPASS: string(authBypass)
  VITE_AUTH_REDIRECT_URI: format('https://{0}.azurewebsites.net/redirect', webAppName)
  VITE_AUTH_B2C_SIGNUP_SIGNIN_POLICY: authB2CSignUpSignInPolicy
  VITE_AUTH_B2C_PASSWORD_RESET_POLICY: authB2CResetPolicy
  VITE_AUTH_B2C_EDIT_PROFILE_POLICY: authB2CEditProfilePolicy
}

// App Registration management is handled via external script
// Due to Bicep limitations with Azure AD resources, use the setup script instead

var webAppLogConfig = {
  applicationLogs: {
    fileSystem: {
      level: 'Information'
    }
  }
  httpLogs: {
    fileSystem: {
      enabled: true
      retentionInDays: 7
      retentionInMb: 50
    }
  }
  failedRequestsTracing: {
    enabled: true
  }
  detailedErrorMessages: {
    enabled: true
  }
}

resource webAppSiteConfigNew 'Microsoft.Web/sites/config@2024-11-01' = if (!useExistingWebApp) {
  name: 'web'
  parent: webApp
  properties: webAppSiteConfigProperties
}

resource webAppSiteConfigExisting 'Microsoft.Web/sites/config@2024-11-01' = if (useExistingWebApp && configureExistingWebApp) {
  name: 'web'
  parent: webAppExisting
  properties: webAppSiteConfigProperties
}

resource webAppAppSettingsNew 'Microsoft.Web/sites/config@2024-11-01' = if (!useExistingWebApp) {
  name: 'appsettings'
  parent: webApp
  properties: webAppAppSettings
}

resource webAppAppSettingsExisting 'Microsoft.Web/sites/config@2024-11-01' = if (useExistingWebApp && configureExistingWebApp) {
  name: 'appsettings'
  parent: webAppExisting
  properties: webAppAppSettings
}

resource webAppLogsNew 'Microsoft.Web/sites/config@2024-11-01' = if (!useExistingWebApp) {
  name: 'logs'
  parent: webApp
  properties: webAppLogConfig
}

resource webAppLogsExisting 'Microsoft.Web/sites/config@2024-11-01' = if (useExistingWebApp && configureExistingWebApp) {
  name: 'logs'
  parent: webAppExisting
  properties: webAppLogConfig
}

resource functionAppExisting 'Microsoft.Web/sites@2024-11-01' existing = if (useExistingFunctionApp) {
  name: functionAppName
}

resource functionApp 'Microsoft.Web/sites@2024-11-01' = if (!useExistingFunctionApp) {
  name: functionAppName
  location: functionAppLocation
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionPlanId
    httpsOnly: true
    siteConfig: {
      appCommandLine: ''
      ftpsState: 'Disabled'
      linuxFxVersion: 'Python|3.11'
      minTlsVersion: '1.2'
      use32BitWorkerProcess: false
      cors: {
        allowedOrigins: [
          'https://ms.portal.azure.com'
          format('https://{0}.azurewebsites.net', webAppName)
          'http://localhost:5000'
        ]
        supportCredentials: true
      }
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'python'
        }
        {
          name: 'PYTHON_VERSION'
          value: '3.11'
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsights.properties.InstrumentationKey
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING'
          value: 'Authorization=AAD'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(replace('${functionAppName}-content', '_', '-'))
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmosAccount.properties.documentEndpoint
        }
        {
          name: 'COSMOS_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/${cosmosKeySecretName})'
        }
        {
          name: 'COSMOS_CONN_STRING'
          value: format('AccountEndpoint={0};AccountKey=@Microsoft.KeyVault(SecretUri={1}secrets/{2});', cosmosAccount.properties.documentEndpoint, keyVault.properties.vaultUri, cosmosKeySecretName)
        }
        {
          name: 'COSMOS_DB_NAME'
          value: cosmosDatabaseName
        }
        {
          name: 'COSMOS_ONE_CONTAINER_NAME'
          value: cosmosDevContainerName
        }
        {
          name: 'COSMOS_RECIPIENTS_CONTAINER'
          value: 'Recipients'
        }
        {
          name: 'COSMOS_DISTRIBUTION_LISTS_CONTAINER'
          value: 'DistributionLists'
        }
        {
          name: 'COSMOS_OPT_OUT_LISTS_CONTAINER'
          value: 'OptOutLists'
        }
        {
          name: 'COSMOS_SENT_EMAILS_CONTAINER'
          value: 'SentEmails'
        }
        {
          name: 'COSMOS_ENGAGEMENT_ANALYTICS_CONTAINER'
          value: 'EngagementAnalytics'
        }
        {
          name: 'ACS_CONNECTION_STRING'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/${acsConnectionSecretName})'
        }
        {
          name: 'ACS_EMAIL_DOMAIN'
          value: split(emailSenderAddress, '@')[1]
        }
        {
          name: 'ACS_EMAIL_SENDER'
          value: emailSenderAddress
        }
        {
          name: 'ENABLE_EMAIL_SEND'
          value: 'true'
        }
        {
          name: 'ENABLE_ASYNC_SEND'
          value: string(enableAsyncSend)
        }
        {
          name: 'ENABLE_INLINE_SEND'
          value: string(enableInlineSend)
        }
        {
          name: 'EMAIL_SENDER'
          value: emailSenderAddress
        }
        {
          name: 'API_HOST'
          value: format('{0}.azurewebsites.net', functionAppName)
        }
        {
          name: 'API_PORT'
          value: '80'
        }
        {
          name: 'AUTH_BYPASS'
          value: string(authBypass)
        }
        {
          name: 'AUTH_TENANT_ID'
          value: authTenantId
        }
        {
          name: 'AUTH_CLIENT_ID'
          value: authClientId
        }
        {
          name: 'AUTH_COUNCILLOR_CLAIM'
          value: 'oid'
        }
        {
          name: 'AUTH_FALLBACK_COUNCILLOR'
          value: 'default-councillor'
        }
        {
          name: 'ENABLE_SEND_DIAGNOSTICS'
          value: 'true'
        }
        {
          name: 'BATCH_SIZE'
          value: '1'
        }
        {
          name: 'MAX_CONCURRENT'
          value: '2'
        }
        {
          name: 'VITE_FE_TEST_KV'
          value: 'false'
        }
        {
          name: 'PUBLIC_BASE_URL'
          value: format('https://{0}.azurewebsites.net', functionAppName)
        }
        {
          name: 'APP_ENV'
          value: 'prod'
        }
        {
          name: 'APP_ENV'
          value: 'prod'
        }
      ]
    }
  }
  dependsOn: !useExistingFunctionAppPlan ? [
    functionPlanNew
  ] : []
}

var effectiveFunctionApp = useExistingFunctionApp ? functionAppExisting : functionApp

resource keyVaultAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  name: 'add'
  parent: keyVault
  properties: {
    accessPolicies: [
      {
        tenantId: tenant().tenantId
        objectId: effectiveFunctionApp.identity.principalId
        permissions: {
          secrets: [ 'Get', 'List' ]
        }
      }
    ]
  }
}

@description('Static Web App hosting the React front-end.')
// Static Web App removed; front-end now hosted on App Service

resource keyVaultDiagnostic 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'kv-logs'
  scope: keyVault
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        category: 'AuditEvent'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
  }
}

output webAppHostname string = format('{0}.azurewebsites.net', webAppName)
output functionAppHostname string = effectiveFunctionApp.properties.defaultHostName
output keyVaultUri string = keyVault.properties.vaultUri
output cosmosAccountEndpoint string = cosmosAccount.properties.documentEndpoint
output webAppUrl string = format('https://{0}.azurewebsites.net', webAppName)
output functionAppUrl string = format('https://{0}', effectiveFunctionApp.properties.defaultHostName)
output resourceGroupName string = resourceGroup().name

// App Registration reference outputs
output appRegistrationDisplayName string = 'CouncilConnect-SPA-${namePrefix}'
output appRegistrationRedirectUris array = [
  format('https://{0}.azurewebsites.net/', webAppName)
  format('https://{0}.azurewebsites.net/redirect', webAppName)
  'http://localhost:5173/'
  'http://localhost:5173/redirect'
]
output authTenantId string = authTenantId
output authClientId string = authClientId
output authAuthority string = effectiveAuthority
