"""
Test suite for new features:
- Credentials with NTLM hash field and edit functionality
- Proxy Servers edit functionality  
- Direct Interaction Plugin endpoints and health check
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')


class TestCredentialsNTLMAndEdit:
    """Tests for credential NTLM hash field and edit functionality"""
    
    created_credential_id = None
    
    def test_create_credential_with_password_only(self):
        """Create credential with password only - should succeed"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "domain": "TEST_domain.com",
            "username": "TEST_user1",
            "password": "testpassword123"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["domain"] == "TEST_domain.com"
        assert data["username"] == "TEST_user1"
        assert data["password"] is not None
        assert data["ntlm_hash"] is None
        TestCredentialsNTLMAndEdit.created_credential_id = data["id"]
        
    def test_create_credential_with_ntlm_only(self):
        """Create credential with NTLM hash only - should succeed"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "domain": "TEST_ntlm.com",
            "username": "TEST_ntlmuser",
            "ntlm_hash": "aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["domain"] == "TEST_ntlm.com"
        assert data["password"] is None
        assert data["ntlm_hash"] is not None
        assert "aad3b435b51404ee" in data["ntlm_hash"]
    
    def test_create_credential_with_both(self):
        """Create credential with both password and NTLM hash - should succeed"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "domain": "TEST_both.com",
            "username": "TEST_bothuser",
            "password": "mypassword",
            "ntlm_hash": "aad3b435b51404eeaad3b435b51404ee:hashvalue"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["password"] is not None
        assert data["ntlm_hash"] is not None
    
    def test_create_credential_without_password_or_hash_fails(self):
        """Create credential without password or NTLM hash - should fail"""
        response = requests.post(f"{BASE_URL}/api/credentials", json={
            "domain": "TEST_fail.com",
            "username": "TEST_failuser"
        })
        assert response.status_code == 422, f"Expected 422 (validation error), got {response.status_code}"
    
    def test_update_credential_edit_domain(self):
        """Update credential - edit domain field"""
        if not TestCredentialsNTLMAndEdit.created_credential_id:
            pytest.skip("No credential created")
        
        cred_id = TestCredentialsNTLMAndEdit.created_credential_id
        response = requests.put(f"{BASE_URL}/api/credentials/{cred_id}", json={
            "domain": "TEST_updated.com"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["domain"] == "TEST_updated.com"
        assert data["updated_at"] is not None
    
    def test_update_credential_add_ntlm_hash(self):
        """Update credential - add NTLM hash while keeping password"""
        if not TestCredentialsNTLMAndEdit.created_credential_id:
            pytest.skip("No credential created")
        
        cred_id = TestCredentialsNTLMAndEdit.created_credential_id
        response = requests.put(f"{BASE_URL}/api/credentials/{cred_id}", json={
            "ntlm_hash": "newhash:value"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["ntlm_hash"] == "newhash:value"
        assert data["password"] is not None  # Password should still be there
    
    def test_update_credential_not_found(self):
        """Update credential - non-existent ID returns 404"""
        response = requests.put(f"{BASE_URL}/api/credentials/99999", json={
            "domain": "notfound.com"
        })
        assert response.status_code == 404
    
    def test_get_credentials_list(self):
        """Get all credentials - verify list includes NTLM fields"""
        response = requests.get(f"{BASE_URL}/api/credentials")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Find our test credential
        test_creds = [c for c in data if c.get("domain", "").startswith("TEST_")]
        assert len(test_creds) > 0, "No test credentials found"
        # Verify structure includes ntlm_hash and updated_at
        for cred in test_creds:
            assert "ntlm_hash" in cred
            assert "updated_at" in cred


class TestProxyServersEdit:
    """Tests for proxy server edit functionality"""
    
    created_proxy_id = None
    
    def test_create_proxy_server(self):
        """Create a proxy server for edit tests"""
        response = requests.post(f"{BASE_URL}/api/proxy-servers", json={
            "name": "TEST_edit_proxy",
            "ip": "192.168.1.100",
            "port": 8080,
            "proxy_type": "http"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        TestProxyServersEdit.created_proxy_id = data["id"]
        assert data["name"] == "TEST_edit_proxy"
        assert data["proxy_type"] == "http"
    
    def test_update_proxy_server_name(self):
        """Update proxy server name"""
        if not TestProxyServersEdit.created_proxy_id:
            pytest.skip("No proxy created")
        
        proxy_id = TestProxyServersEdit.created_proxy_id
        response = requests.put(f"{BASE_URL}/api/proxy-servers/{proxy_id}", json={
            "name": "TEST_updated_proxy"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["name"] == "TEST_updated_proxy"
    
    def test_update_proxy_server_ip_and_port(self):
        """Update proxy server IP and port"""
        if not TestProxyServersEdit.created_proxy_id:
            pytest.skip("No proxy created")
        
        proxy_id = TestProxyServersEdit.created_proxy_id
        response = requests.put(f"{BASE_URL}/api/proxy-servers/{proxy_id}", json={
            "ip": "10.0.0.1",
            "port": 3128
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["ip"] == "10.0.0.1"
        assert data["port"] == 3128
    
    def test_update_proxy_server_type_to_socks(self):
        """Update proxy server type to SOCKS5 with auth"""
        if not TestProxyServersEdit.created_proxy_id:
            pytest.skip("No proxy created")
        
        proxy_id = TestProxyServersEdit.created_proxy_id
        response = requests.put(f"{BASE_URL}/api/proxy-servers/{proxy_id}", json={
            "proxy_type": "socks5",
            "username": "socksuser",
            "password": "sockspass"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["proxy_type"] == "socks5"
        assert data["username"] == "socksuser"
    
    def test_update_proxy_server_not_found(self):
        """Update non-existent proxy returns 404"""
        response = requests.put(f"{BASE_URL}/api/proxy-servers/99999", json={
            "name": "notfound"
        })
        assert response.status_code == 404


class TestDirectInteractionPlugin:
    """Tests for Direct Interaction Plugin"""
    
    def test_get_all_plugins_includes_direct_interaction(self):
        """GET /api/plugins returns direct_interaction plugin"""
        response = requests.get(f"{BASE_URL}/api/plugins")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "direct_interaction" in data
        assert data["direct_interaction"]["name"] == "Interação Direta"
        assert data["direct_interaction"]["type"] == "direct_interaction"
    
    def test_get_direct_interaction_plugin_info(self):
        """GET /api/plugins/direct_interaction returns plugin details"""
        response = requests.get(f"{BASE_URL}/api/plugins/direct_interaction")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["name"] == "Interação Direta"
        assert data["type"] == "direct_interaction"
        assert data["version"] == "1.0.0"
        assert "config_schema" in data
        # Verify config schema includes expected fields
        schema = data["config_schema"]
        assert "properties" in schema
        props = schema["properties"]
        assert "credential_id" in props
        assert "dns_mode" in props
        assert "dns_servers" in props
    
    def test_direct_interaction_health_check_system_dns(self):
        """POST /api/plugins/direct_interaction/health with system DNS"""
        response = requests.post(
            f"{BASE_URL}/api/plugins/direct_interaction/health",
            json={
                "dns_mode": "system",
                "dns_servers": []
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        # Health check should succeed - it tries to resolve google.com
        assert "healthy" in data
        assert "message" in data
        assert "details" in data
        # Check details structure
        assert "dns_mode" in data["details"]
        assert data["details"]["dns_mode"] == "system"
    
    def test_direct_interaction_health_check_custom_dns(self):
        """POST /api/plugins/direct_interaction/health with custom DNS"""
        response = requests.post(
            f"{BASE_URL}/api/plugins/direct_interaction/health",
            json={
                "dns_mode": "custom",
                "dns_servers": ["8.8.8.8", "8.8.4.4"]
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "healthy" in data
        assert "message" in data
        assert "details" in data
        # Check details structure
        assert data["details"]["dns_mode"] == "custom"
        assert data["details"]["dns_servers"] == ["8.8.8.8", "8.8.4.4"]
    
    def test_direct_interaction_validate_config(self):
        """POST /api/plugins/direct_interaction/validate"""
        response = requests.post(
            f"{BASE_URL}/api/plugins/direct_interaction/validate",
            json={
                "credential_id": 1,
                "dns_mode": "system"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "valid" in data
    
    def test_get_nonexistent_plugin_returns_404(self):
        """GET /api/plugins/nonexistent returns 404"""
        response = requests.get(f"{BASE_URL}/api/plugins/nonexistent_plugin")
        assert response.status_code == 404


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_credentials(self):
        """Delete test credentials"""
        response = requests.get(f"{BASE_URL}/api/credentials")
        if response.status_code == 200:
            for cred in response.json():
                if cred.get("domain", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/credentials/{cred['id']}")
        assert True  # Cleanup always passes
    
    def test_cleanup_test_proxies(self):
        """Delete test proxy servers"""
        response = requests.get(f"{BASE_URL}/api/proxy-servers")
        if response.status_code == 200:
            for proxy in response.json():
                if proxy.get("name", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/proxy-servers/{proxy['id']}")
        assert True  # Cleanup always passes
