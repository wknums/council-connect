"""JWT authentication and authorization helpers for Azure Functions backend."""
from __future__ import annotations

import json
import logging
import os
from typing import Dict, Any, Optional
import jwt
import requests
from jwt import PyJWTError
import azure.functions as func


class AuthenticationError(Exception):
    """Raised when token validation fails."""
    pass


class AuthorizationError(Exception):
    """Raised when user lacks required permissions."""
    pass


class JWTValidator:
    """Validates JWT tokens from Microsoft identity platform."""
    
    def __init__(self):
        self.tenant_id = os.getenv('AUTH_TENANT_ID')
        self.client_id = os.getenv('AUTH_CLIENT_ID')  # API app client ID
        self.allowed_audiences = self._get_allowed_audiences()
        self.jwks_cache = {}
        self.logger = logging.getLogger(__name__)
        
    def _get_allowed_audiences(self) -> list[str]:
        """Get list of allowed token audiences."""
        audiences = []
        if self.client_id:
            audiences.extend([
                self.client_id,
                f"api://{self.client_id}",
                f"api://{self.client_id.lower()}-api"
            ])
        # Add any additional audiences from environment
        extra_audiences = os.getenv('AUTH_ALLOWED_AUDIENCES', '')
        if extra_audiences:
            audiences.extend(extra_audiences.split(','))
        return audiences
    
    def _get_jwks_uri(self) -> str:
        """Get JWKS URI for token validation."""
        if self.tenant_id:
            return f"https://login.microsoftonline.com/{self.tenant_id}/discovery/v2.0/keys"
        return "https://login.microsoftonline.com/common/discovery/v2.0/keys"
    
    def _fetch_jwks(self) -> Dict[str, Any]:
        """Fetch JSON Web Key Set from Microsoft."""
        if 'keys' in self.jwks_cache:
            return self.jwks_cache
            
        try:
            response = requests.get(self._get_jwks_uri(), timeout=10)
            response.raise_for_status()
            self.jwks_cache = response.json()
            return self.jwks_cache
        except requests.RequestException as e:
            self.logger.error(f"Failed to fetch JWKS: {e}")
            raise AuthenticationError("Unable to fetch signing keys")
    
    def _get_signing_key(self, kid: str) -> str:
        """Get the signing key for a given key ID."""
        jwks = self._fetch_jwks()
        for key in jwks.get('keys', []):
            if key.get('kid') == kid:
                return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
        raise AuthenticationError(f"Signing key not found: {kid}")
    
    def validate_token(self, token: str) -> Dict[str, Any]:
        """Validate JWT token and return claims."""
        try:
            # Decode header to get key ID
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get('kid')
            if not kid:
                raise AuthenticationError("Token missing key ID")
            
            # Get signing key
            signing_key = self._get_signing_key(kid)
            
            # Validate token
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=['RS256'],
                audience=self.allowed_audiences,
                issuer=f"https://login.microsoftonline.com/{self.tenant_id}/v2.0" if self.tenant_id else None,
                options={
                    "verify_exp": True,
                    "verify_aud": True,
                    "verify_iss": bool(self.tenant_id),
                    "require": ["exp", "aud"]
                }
            )
            
            return claims
            
        except PyJWTError as e:
            self.logger.warning(f"JWT validation failed: {e}")
            raise AuthenticationError(f"Invalid token: {e}")
        except Exception as e:
            self.logger.error(f"Token validation error: {e}")
            raise AuthenticationError("Token validation failed")


class AuthGuard:
    """Authentication and authorization guard for Azure Functions."""
    
    def __init__(self):
        self.validator = JWTValidator()
        self.bypass_auth = os.getenv('AUTH_BYPASS', 'false').lower() == 'true'
        self.councillor_claim = os.getenv('AUTH_COUNCILLOR_CLAIM', 'oid')
        self.ward_claim = os.getenv('AUTH_WARD_CLAIM', '')
        self.fallback_councillor = os.getenv('AUTH_FALLBACK_COUNCILLOR', 'default-councillor')
        self.logger = logging.getLogger(__name__)
        
    def should_bypass(self, req: func.HttpRequest) -> bool:
        """Check if authentication should be bypassed."""
        if self.bypass_auth:
            return True
            
        # Allow bypass for specific paths (like unsubscribe)
        path = req.url.lower()
        bypass_paths = ['/unsubscribe', '/track/pixel']
        return any(bypass_path in path for bypass_path in bypass_paths)
    
    def extract_token(self, req: func.HttpRequest) -> Optional[str]:
        """Extract bearer token from request."""
        auth_header = req.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            return auth_header[7:]
        return None
    
    def get_councillor_id(self, claims: Dict[str, Any]) -> str:
        """Extract councillor ID from token claims."""
        # Try custom claim first
        councillor_id = claims.get(self.councillor_claim)
        if councillor_id and isinstance(councillor_id, str):
            return councillor_id
            
        # Fallback to user object ID
        oid = claims.get('oid')
        if oid and isinstance(oid, str):
            return oid
            
        # Last resort fallback
        return self.fallback_councillor
    
    def get_ward_id(self, claims: Dict[str, Any]) -> Optional[str]:
        """Extract ward ID from token claims."""
        if not self.ward_claim:
            return None
            
        ward_id = claims.get(self.ward_claim)
        return ward_id if isinstance(ward_id, str) else None
    
    def authenticate_request(self, req: func.HttpRequest) -> Dict[str, Any]:
        """Authenticate request and return user context."""
        # Check if we should bypass authentication
        if self.should_bypass(req):
            # Legacy fallback - get councillor ID from header for bypass mode
            legacy_councillor = req.headers.get('x-councillor-id')
            if legacy_councillor:
                return {
                    'councillor_id': legacy_councillor,
                    'ward_id': None,
                    'bypassed': True,
                    'claims': {}
                }
            # URL parameter fallback for unsubscribe pages
            councillor_param = req.params.get('councillorId')
            if councillor_param:
                return {
                    'councillor_id': councillor_param,
                    'ward_id': req.params.get('ward'),
                    'bypassed': True,
                    'claims': {}
                }
            return {
                'councillor_id': self.fallback_councillor,
                'ward_id': None,
                'bypassed': True,
                'claims': {}
            }
        
        # Extract and validate token
        token = self.extract_token(req)
        if not token:
            raise AuthenticationError("Missing authorization token")
        
        claims = self.validator.validate_token(token)
        councillor_id = self.get_councillor_id(claims)
        ward_id = self.get_ward_id(claims)
        
        self.logger.info(f"Authenticated user: {councillor_id}")
        
        return {
            'councillor_id': councillor_id,
            'ward_id': ward_id,
            'bypassed': False,
            'claims': claims
        }


# Global auth guard instance
_auth_guard = None

def get_auth_guard() -> AuthGuard:
    """Get the singleton auth guard instance."""
    global _auth_guard
    if _auth_guard is None:
        _auth_guard = AuthGuard()
    return _auth_guard


def require_auth(req: func.HttpRequest) -> Dict[str, Any]:
    """Authenticate request and return user context. Raises on auth failure."""
    return get_auth_guard().authenticate_request(req)


def require_councillor(req: func.HttpRequest) -> str:
    """Extract councillor ID from authenticated request."""
    auth_context = require_auth(req)
    return auth_context['councillor_id']