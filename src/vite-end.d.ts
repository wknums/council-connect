/// <reference types="vite/client" />
declare const GITHUB_RUNTIME_PERMANENT_NAME: string
declare const BASE_KV_SERVICE_URL: string

interface ImportMetaEnv {
	readonly VITE_API_HOST?: string
	readonly VITE_API_PORT?: string
	readonly VITE_AUTH_MODE?: string
	readonly VITE_AUTH_CLIENT_ID?: string
	readonly VITE_AUTH_TENANT_ID?: string
	readonly VITE_AUTH_SCOPES?: string
	readonly VITE_AUTH_REDIRECT_URI?: string
	readonly VITE_AUTH_POST_LOGOUT_REDIRECT_URI?: string
	readonly VITE_AUTH_COUNCILLOR_CLAIM?: string
	readonly VITE_AUTH_WARD_CLAIM?: string
	readonly VITE_AUTH_FALLBACK_COUNCILLOR?: string
	readonly VITE_AUTH_BYPASS?: string
	readonly VITE_AUTH_B2C_TENANT?: string
	readonly VITE_AUTH_B2C_DOMAIN?: string
	readonly VITE_AUTH_B2C_SIGNIN_POLICY?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}