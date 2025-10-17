#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Deploy CouncilConnect Municipal Email System using Azure Developer CLI

.DESCRIPTION
    This script automates the deployment of the CouncilConnect Municipal Email System
    using Azure Developer CLI (azd). It ensures the correct environment variables
    are set and deploys both infrastructure and applications.

.PARAMETER Environment
    The azd environment name to use (default: "main")

.PARAMETER Location
    The Azure region for resources (default: "uksouth")

.PARAMETER SubscriptionId
    The Azure subscription ID to use

.EXAMPLE
    .\scripts\deploy.ps1
    
.EXAMPLE
    .\scripts\deploy.ps1 -Environment "production" -Location "uksouth"
#>

param(
    [string]$Environment = "main",
    [string]$Location = "uksouth",
    [string]$SubscriptionId = ""
)

# Set error action preference
$ErrorActionPreference = "Stop"

Write-Host "🚀 CouncilConnect Municipal Email System Deployment" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# Check prerequisites
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow

# Check if azd is installed
try {
    azd version | Out-Null
    Write-Host "✅ Azure Developer CLI (azd) is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure Developer CLI (azd) is not installed. Please install it first." -ForegroundColor Red
    Write-Host "Install from: https://docs.microsoft.com/en-us/azure/developer/azure-developer-cli/install-azd" -ForegroundColor Yellow
    exit 1
}

# Check if Azure CLI is installed and authenticated
try {
    az account show | Out-Null
    Write-Host "✅ Azure CLI is installed and authenticated" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure CLI is not installed or not authenticated. Please run 'az login' first." -ForegroundColor Red
    exit 1
}

# Check if Node.js is installed
try {
    node --version | Out-Null
    Write-Host "✅ Node.js is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed. Please install Node.js 22+ first." -ForegroundColor Red
    exit 1
}

# Check if Python is installed
try {
    python --version | Out-Null
    Write-Host "✅ Python is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Python is not installed. Please install Python 3.11+ first." -ForegroundColor Red
    exit 1
}

# Set subscription if provided
if ($SubscriptionId) {
    Write-Host "🔧 Setting Azure subscription to: $SubscriptionId" -ForegroundColor Yellow
    az account set --subscription $SubscriptionId
}

# Initialize azd environment
Write-Host "🔧 Initializing azd environment: $Environment" -ForegroundColor Yellow
azd env select $Environment --location $Location

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "📦 Installing Python dependencies..." -ForegroundColor Yellow
Push-Location "src/backend"
try {
    pip install -r requirements.txt
} finally {
    Pop-Location
}

# Deploy infrastructure and applications
Write-Host "🚀 Deploying infrastructure and applications..." -ForegroundColor Yellow
azd up --no-prompt

# Verify deployment
Write-Host "✅ Deployment completed!" -ForegroundColor Green
Write-Host ""
Write-Host "🔍 Deployment Summary:" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan

# Get web app URL
$webAppUrl = azd env get-values | Select-String "AZURE_APP_SERVICE_WEB_URL" | ForEach-Object { $_.ToString().Split('=')[1].Trim('"') }
if ($webAppUrl) {
    Write-Host "🌐 Web App URL: $webAppUrl" -ForegroundColor Green
}

# Get function app URL
$functionAppUrl = azd env get-values | Select-String "AZURE_FUNCTION_APP_URL" | ForEach-Object { $_.ToString().Split('=')[1].Trim('"') }
if ($functionAppUrl) {
    Write-Host "⚡ Function App URL: $functionAppUrl" -ForegroundColor Green
}

Write-Host ""
Write-Host "📖 Next Steps:" -ForegroundColor Cyan
Write-Host "==============" -ForegroundColor Cyan
Write-Host "1. Verify the web app is accessible at: $webAppUrl" -ForegroundColor White
Write-Host "2. Test authentication and email functionality" -ForegroundColor White
Write-Host "3. Check Application Insights for monitoring" -ForegroundColor White
Write-Host "4. Review the DEPLOYMENT.md file for detailed configuration" -ForegroundColor White
Write-Host ""
Write-Host "🎉 Deployment completed successfully!" -ForegroundColor Green