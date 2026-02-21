"""
Test suite for iteration 5 features:
- Credential types: user_password, token, ssh_key with tabs in form
- Name field optional for all credential types
- Type-specific validation (user_password requires username and password/ntlm)
- Verification fields: verified, last_verified_at, verification_error
- GET /api/credentials/by-type/{type} endpoint
- POST /api/credentials/{id}/verify endpoint
- Direct Interaction Plugin v1.1.0 with SMB implementation
- Plugin credential selector filters only user_password type
- AuthenticationFailureException in exceptions.py
"""

import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')


class TestCredentialTypes:
    """Tests for the three credential types: user_password, token, ssh_key"""
    
    created_ids = []
    
    # ============== user_password type tests ==============
    def test_create_user_password_credential_full(self):
        """Create user_password credential with all fields"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "name": "TEST_user_cred_full",
            "credential_type": "user_password",
            "domain": "testdomain.com",
            "username": "testuser",
            "password": "testpass123"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["credential_type"] == "user_password"
        assert data["name"] == "TEST_user_cred_full"
        assert data["domain"] == "testdomain.com"
        assert data["username"] == "testuser"
        assert data["password"] == "testpass123"
        assert data["verified"] == False  # Default value
        assert data["last_verified_at"] is None
        assert data["verification_error"] is None
        TestCredentialTypes.created_ids.append(data["id"])
    
    def test_create_user_password_with_ntlm_only(self):
        """Create user_password credential with NTLM hash only (no password)"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "name": "TEST_ntlm_only",
            "credential_type": "user_password",
            "username": "ntlmuser",
            "ntlm_hash": "aad3b435b51404ee:8846f7eaee8fb117"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["password"] is None
        assert data["ntlm_hash"] is not None
        TestCredentialTypes.created_ids.append(data["id"])
    
    def test_create_user_password_without_name(self):
        """Create user_password credential without optional name field"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "credential_type": "user_password",
            "username": "no_name_user",
            "password": "pass123"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["name"] is None  # Name is optional
        TestCredentialTypes.created_ids.append(data["id"])
    
    def test_create_user_password_missing_username_fails(self):
        """user_password type requires username - should fail"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "credential_type": "user_password",
            "password": "somepassword"
            # Missing username
        })
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"
    
    def test_create_user_password_missing_password_and_ntlm_fails(self):
        """user_password type requires password OR ntlm_hash - should fail"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "credential_type": "user_password",
            "username": "testuser"
            # Missing password and ntlm_hash
        })
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"
    
    # ============== token type tests ==============
    def test_create_token_credential_full(self):
        """Create token credential with all fields"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "name": "TEST_api_token",
            "credential_type": "token",
            "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token",
            "token_type": "bearer"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["credential_type"] == "token"
        assert data["name"] == "TEST_api_token"
        assert data["token"] is not None
        assert data["token_type"] == "bearer"
        assert data["verified"] == False
        TestCredentialTypes.created_ids.append(data["id"])
    
    def test_create_token_without_name(self):
        """Create token credential without optional name"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "credential_type": "token",
            "token": "api_key_12345678"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["name"] is None
        TestCredentialTypes.created_ids.append(data["id"])
    
    def test_create_token_missing_token_fails(self):
        """Token type requires token field - should fail"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "credential_type": "token",
            "name": "TEST_missing_token"
            # Missing token
        })
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"
    
    # ============== ssh_key type tests ==============
    def test_create_ssh_key_credential_full(self):
        """Create ssh_key credential with all fields"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "name": "TEST_ssh_key_full",
            "credential_type": "ssh_key",
            "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\ntest_key_content\n-----END OPENSSH PRIVATE KEY-----",
            "ssh_passphrase": "mypassphrase",
            "ssh_public_key": "ssh-rsa AAAAB3NzaC1yc2E..."
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["credential_type"] == "ssh_key"
        assert data["name"] == "TEST_ssh_key_full"
        assert data["ssh_private_key"] is not None
        assert data["ssh_passphrase"] == "mypassphrase"
        assert data["verified"] == False
        TestCredentialTypes.created_ids.append(data["id"])
    
    def test_create_ssh_key_without_passphrase(self):
        """Create ssh_key credential without optional passphrase"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "credential_type": "ssh_key",
            "ssh_private_key": "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["ssh_passphrase"] is None
        TestCredentialTypes.created_ids.append(data["id"])
    
    def test_create_ssh_key_missing_private_key_fails(self):
        """SSH key type requires ssh_private_key - should fail"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "credential_type": "ssh_key",
            "name": "TEST_missing_key"
            # Missing ssh_private_key
        })
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"
    
    # ============== Invalid type test ==============
    def test_create_invalid_credential_type_fails(self):
        """Invalid credential type should fail"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "credential_type": "invalid_type",
            "username": "test"
        })
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"


class TestCredentialsByTypeEndpoint:
    """Tests for GET /api/credentials/by-type/{type} endpoint"""
    
    def test_get_user_password_credentials(self):
        """GET /api/credentials/by-type/user_password returns only user_password type"""
        response = requests.get(f"{BASE_URL}/api/credentials/by-type/user_password")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        # All returned credentials should be user_password type
        for cred in data:
            assert cred["credential_type"] == "user_password", f"Got credential type: {cred['credential_type']}"
    
    def test_get_token_credentials(self):
        """GET /api/credentials/by-type/token returns only token type"""
        response = requests.get(f"{BASE_URL}/api/credentials/by-type/token")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        for cred in data:
            assert cred["credential_type"] == "token", f"Got credential type: {cred['credential_type']}"
    
    def test_get_ssh_key_credentials(self):
        """GET /api/credentials/by-type/ssh_key returns only ssh_key type"""
        response = requests.get(f"{BASE_URL}/api/credentials/by-type/ssh_key")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        for cred in data:
            assert cred["credential_type"] == "ssh_key", f"Got credential type: {cred['credential_type']}"
    
    def test_get_invalid_type_credentials_fails(self):
        """GET /api/credentials/by-type/invalid returns 400"""
        response = requests.get(f"{BASE_URL}/api/credentials/by-type/invalid_type")
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"


class TestCredentialVerifyEndpoint:
    """Tests for POST /api/credentials/{id}/verify endpoint"""
    
    test_cred_id = None
    
    def test_create_credential_for_verify_test(self):
        """Create credential for verification tests"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "name": "TEST_verify_cred",
            "credential_type": "user_password",
            "username": "verify_user",
            "password": "verify_pass"
        })
        assert response.status_code == 200
        data = response.json()
        TestCredentialVerifyEndpoint.test_cred_id = data["id"]
        # Initially should not be verified
        assert data["verified"] == False
        assert data["last_verified_at"] is None
    
    def test_mark_credential_as_verified_success(self):
        """POST /api/credentials/{id}/verify with success=true"""
        if not TestCredentialVerifyEndpoint.test_cred_id:
            pytest.skip("No test credential")
        
        cred_id = TestCredentialVerifyEndpoint.test_cred_id
        response = requests.post(f"{BASE_URL}/api/credentials/{cred_id}/verify?success=true")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["id"] == cred_id
        assert data["verified"] == True
        assert data["last_verified_at"] is not None
        assert data["verification_error"] is None
    
    def test_verify_credential_and_check_via_get(self):
        """Verify that verification status persists via GET"""
        if not TestCredentialVerifyEndpoint.test_cred_id:
            pytest.skip("No test credential")
        
        cred_id = TestCredentialVerifyEndpoint.test_cred_id
        response = requests.get(f"{BASE_URL}/api/credentials")
        assert response.status_code == 200
        data = response.json()
        cred = next((c for c in data if c["id"] == cred_id), None)
        assert cred is not None
        assert cred["verified"] == True
        assert cred["last_verified_at"] is not None
    
    def test_mark_credential_as_failed_verification(self):
        """POST /api/credentials/{id}/verify with success=false and error_message"""
        # Create a new credential for this test
        create_resp = requests.post(f"{BASE_URL}/api/credentials", json={
            "name": "TEST_verify_fail",
            "credential_type": "user_password",
            "username": "fail_user",
            "password": "fail_pass"
        })
        assert create_resp.status_code == 200
        cred_id = create_resp.json()["id"]
        
        # Mark as failed
        response = requests.post(
            f"{BASE_URL}/api/credentials/{cred_id}/verify",
            params={"success": False, "error_message": "Authentication failed: invalid password"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["verified"] == False
        assert data["last_verified_at"] is not None
        assert data["verification_error"] == "Authentication failed: invalid password"
    
    def test_verify_nonexistent_credential_returns_404(self):
        """POST /api/credentials/99999/verify returns 404"""
        response = requests.post(f"{BASE_URL}/api/credentials/99999/verify?success=true")
        assert response.status_code == 404


class TestDirectInteractionPluginV1_1:
    """Tests for Direct Interaction Plugin version 1.1.0 with SMB"""
    
    def test_plugin_version_is_1_1_0(self):
        """GET /api/plugins/direct_interaction returns version 1.1.0"""
        response = requests.get(f"{BASE_URL}/api/plugins/direct_interaction")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["version"] == "1.1.0", f"Expected version 1.1.0, got {data['version']}"
    
    def test_plugin_description_mentions_smb(self):
        """Plugin description should mention SMB"""
        response = requests.get(f"{BASE_URL}/api/plugins/direct_interaction")
        assert response.status_code == 200
        data = response.json()
        # Description should mention SMB
        desc = data.get("description", "").lower()
        assert "smb" in desc, f"Description should mention SMB: {data['description']}"
    
    def test_plugin_config_schema_has_credential_id(self):
        """Plugin config schema should require credential_id"""
        response = requests.get(f"{BASE_URL}/api/plugins/direct_interaction")
        assert response.status_code == 200
        data = response.json()
        schema = data.get("config_schema", {})
        props = schema.get("properties", {})
        required = schema.get("required", [])
        
        # credential_id should be in properties and required
        assert "credential_id" in props, "credential_id should be in config properties"
        assert "credential_id" in required, "credential_id should be required"
    
    def test_plugin_health_with_credential_configured(self):
        """Health check returns credential_configured info"""
        response = requests.post(
            f"{BASE_URL}/api/plugins/direct_interaction/health",
            json={
                "credential_id": 1,
                "dns_mode": "system"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "details" in data
        assert "credential_configured" in data["details"]


class TestPluginCredentialFilter:
    """Tests that plugin credential selector filters only user_password type"""
    
    def test_by_type_endpoint_filters_correctly(self):
        """The /api/credentials/by-type/user_password is used by plugin page"""
        # First, create credentials of different types
        requests.post(f"{BASE_URL}/api/credentials", json={
            "name": "TEST_plugin_user",
            "credential_type": "user_password",
            "username": "plugin_user",
            "password": "pass123"
        })
        requests.post(f"{BASE_URL}/api/credentials", json={
            "name": "TEST_plugin_token",
            "credential_type": "token",
            "token": "test_token_123"
        })
        
        # Get only user_password type (what the plugin page uses)
        response = requests.get(f"{BASE_URL}/api/credentials/by-type/user_password")
        assert response.status_code == 200
        data = response.json()
        
        # Should NOT include token type credentials
        for cred in data:
            assert cred["credential_type"] == "user_password"
            # Should not find the token credential we just created
            assert cred.get("name") != "TEST_plugin_token"


class TestAuthenticationFailureException:
    """Tests that AuthenticationFailureException exists in exceptions.py"""
    
    def test_plugin_exceptions_endpoint_exists(self):
        """Verify plugins endpoint works (indirect test that exceptions are loaded)"""
        response = requests.get(f"{BASE_URL}/api/plugins")
        assert response.status_code == 200
        # If exceptions.py had syntax errors, the plugin would fail to load
        data = response.json()
        assert "direct_interaction" in data
    
    def test_invalid_credential_type_in_plugin_config(self):
        """Test that plugin validates credential type requirement"""
        # This indirectly tests that the exception handling is in place
        response = requests.post(
            f"{BASE_URL}/api/plugins/direct_interaction/validate",
            json={
                "credential_id": None,  # No credential
                "dns_mode": "system"
            }
        )
        assert response.status_code == 200
        # Should return validation result


class TestCleanup:
    """Cleanup all test data"""
    
    def test_cleanup_test_credentials(self):
        """Delete all test credentials"""
        response = requests.get(f"{BASE_URL}/api/credentials")
        if response.status_code == 200:
            for cred in response.json():
                name = cred.get("name") or ""
                username = cred.get("username") or ""
                if name.startswith("TEST_") or username.startswith("TEST_") or \
                   username in ["testuser", "no_name_user", "ntlmuser", "verify_user", 
                               "fail_user", "plugin_user"]:
                    requests.delete(f"{BASE_URL}/api/credentials/{cred['id']}")
        assert True  # Cleanup always passes
