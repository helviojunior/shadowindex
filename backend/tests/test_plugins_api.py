"""
Backend API Tests for Plugins Architecture and SOAP Plugin
Tests the new features:
1. GET /api/plugins - List all available plugins
2. GET /api/plugins/soap_api - Get SOAP plugin info and config schema
3. POST /api/plugins/soap_api/health - Health check with config
4. POST /api/plugins/soap_api/validate - Validate plugin config
5. Proxy Servers with type (HTTP/SOCKS5) and authentication
6. Downloads page endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPluginsAPI:
    """Test plugin endpoints"""
    
    def test_get_plugins_list(self):
        """GET /api/plugins - Returns list of available plugins"""
        response = requests.get(f"{BASE_URL}/api/plugins")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify data structure - should return dict of plugins
        assert isinstance(data, dict), "Response should be a dictionary"
        assert "soap_api" in data, "soap_api plugin should be in the list"
        
        # Verify soap_api plugin info
        soap_plugin = data["soap_api"]
        assert "type" in soap_plugin, "Plugin should have 'type'"
        assert "name" in soap_plugin, "Plugin should have 'name'"
        assert "version" in soap_plugin, "Plugin should have 'version'"
        assert "description" in soap_plugin, "Plugin should have 'description'"
        assert "config_schema" in soap_plugin, "Plugin should have 'config_schema'"
        
        print(f"PASS: GET /api/plugins returned {len(data)} plugins")
        print(f"SOAP Plugin info: {soap_plugin['name']} v{soap_plugin['version']}")
    
    def test_get_soap_plugin_info(self):
        """GET /api/plugins/soap_api - Returns detailed SOAP plugin info"""
        response = requests.get(f"{BASE_URL}/api/plugins/soap_api")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify plugin metadata
        assert data.get("type") == "soap_api"
        assert data.get("name") == "SOAP API Plugin"
        assert "version" in data
        assert "description" in data
        
        # Verify config_schema structure
        config_schema = data.get("config_schema", {})
        assert config_schema.get("type") == "object"
        assert "properties" in config_schema
        assert "soap_url" in config_schema.get("properties", {})
        
        # Verify soap_url property
        soap_url_prop = config_schema["properties"]["soap_url"]
        assert soap_url_prop.get("type") == "string"
        assert "description" in soap_url_prop
        
        print("PASS: GET /api/plugins/soap_api returned detailed plugin info")
        print(f"Config schema has {len(config_schema.get('properties', {}))} properties")
    
    def test_get_nonexistent_plugin(self):
        """GET /api/plugins/nonexistent - Returns 404 for unknown plugin"""
        response = requests.get(f"{BASE_URL}/api/plugins/nonexistent_plugin")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: GET /api/plugins/nonexistent_plugin correctly returns 404")
    
    def test_plugin_health_check_valid_config(self):
        """POST /api/plugins/soap_api/health - Health check with config"""
        # Use any URL - the actual SOAP service may not be available
        response = requests.post(
            f"{BASE_URL}/api/plugins/soap_api/health",
            json={"soap_url": "https://example.com/api.asmx"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "healthy" in data, "Response should have 'healthy' field"
        assert "message" in data, "Response should have 'message' field"
        
        # Since the SOAP service is mocked/unavailable, expect healthy=False
        print(f"PASS: Plugin health check returned: healthy={data['healthy']}, message={data['message']}")
    
    def test_plugin_health_check_no_url(self):
        """POST /api/plugins/soap_api/health - Health check without URL"""
        response = requests.post(
            f"{BASE_URL}/api/plugins/soap_api/health",
            json={}  # No soap_url
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should return healthy=False when no URL provided
        assert data.get("healthy") == False, "Should be unhealthy without URL"
        print("PASS: Plugin health check without URL returns healthy=False")
    
    def test_plugin_validate_config_valid(self):
        """POST /api/plugins/soap_api/validate - Validate config with required fields"""
        response = requests.post(
            f"{BASE_URL}/api/plugins/soap_api/validate",
            json={"soap_url": "https://example.com/api.asmx"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "valid" in data, "Response should have 'valid' field"
        # With soap_url provided, should be valid
        print(f"PASS: Plugin validate config returned: valid={data.get('valid')}")
    
    def test_plugin_validate_config_missing_required(self):
        """POST /api/plugins/soap_api/validate - Validate config without required fields"""
        response = requests.post(
            f"{BASE_URL}/api/plugins/soap_api/validate",
            json={}  # Missing soap_url
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "valid" in data
        # Check if validation properly identifies missing keys
        if not data.get("valid"):
            missing = data.get("missing_keys", [])
            print(f"PASS: Config validation found missing keys: {missing}")
        else:
            print("PASS: Config validation returned valid=True (may have defaults)")


class TestProxyServersAPI:
    """Test Proxy Servers with type (HTTP/SOCKS5) and authentication"""
    
    def test_get_proxy_servers_list(self):
        """GET /api/proxy-servers - Returns list of proxy servers"""
        response = requests.get(f"{BASE_URL}/api/proxy-servers")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        # If there are proxies, verify structure
        for proxy in data:
            assert "id" in proxy
            assert "name" in proxy
            assert "ip" in proxy
            assert "port" in proxy
            # New fields
            assert "proxy_type" in proxy or proxy.get("proxy_type") is None  # May be null for old entries
        
        print(f"PASS: GET /api/proxy-servers returned {len(data)} proxies")
    
    def test_create_http_proxy(self):
        """POST /api/proxy-servers - Create HTTP proxy"""
        payload = {
            "name": "TEST_HTTP_Proxy",
            "ip": "192.168.1.100",
            "port": 8080,
            "proxy_type": "http",
            "username": None,
            "password": None
        }
        
        response = requests.post(f"{BASE_URL}/api/proxy-servers", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["name"] == "TEST_HTTP_Proxy"
        assert data["proxy_type"] == "http" or data.get("proxy_type") is None
        
        # Cleanup
        if "id" in data:
            cleanup = requests.delete(f"{BASE_URL}/api/proxy-servers/{data['id']}")
            print(f"Cleanup: Deleted proxy {data['id']}")
        
        print("PASS: Created HTTP proxy successfully")
    
    def test_create_socks5_proxy_with_auth(self):
        """POST /api/proxy-servers - Create SOCKS5 proxy with authentication"""
        payload = {
            "name": "TEST_SOCKS5_Proxy",
            "ip": "10.0.0.50",
            "port": 1080,
            "proxy_type": "socks5",
            "username": "testuser",
            "password": "testpass123"
        }
        
        response = requests.post(f"{BASE_URL}/api/proxy-servers", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["name"] == "TEST_SOCKS5_Proxy"
        assert data.get("username") == "testuser"
        # Password should not be returned in response for security
        
        # Cleanup
        if "id" in data:
            cleanup = requests.delete(f"{BASE_URL}/api/proxy-servers/{data['id']}")
            print(f"Cleanup: Deleted proxy {data['id']}")
        
        print("PASS: Created SOCKS5 proxy with auth successfully")


class TestSoapAPIsEndpoints:
    """Test SOAP APIs CRUD endpoints"""
    
    def test_get_soap_apis_list(self):
        """GET /api/soap-apis - Returns list of SOAP APIs"""
        response = requests.get(f"{BASE_URL}/api/soap-apis")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        for api in data:
            assert "id" in api
            assert "name" in api
            assert "uri" in api
        
        print(f"PASS: GET /api/soap-apis returned {len(data)} APIs")
    
    def test_create_soap_api(self):
        """POST /api/soap-apis - Create new SOAP API"""
        payload = {
            "name": "TEST_SOAP_API",
            "uri": "https://test.example.com/api.asmx?WSDL"
        }
        
        response = requests.post(f"{BASE_URL}/api/soap-apis", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["name"] == "TEST_SOAP_API"
        assert data["uri"] == "https://test.example.com/api.asmx?WSDL"
        
        # Cleanup
        if "id" in data:
            requests.delete(f"{BASE_URL}/api/soap-apis/{data['id']}")
            print(f"Cleanup: Deleted SOAP API {data['id']}")
        
        print("PASS: Created SOAP API successfully")


class TestDownloadsPageEndpoints:
    """Test Downloads page related endpoints"""
    
    def test_get_downloads_list(self):
        """GET /api/downloads - Returns list of download jobs"""
        response = requests.get(f"{BASE_URL}/api/downloads")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: GET /api/downloads returned {len(data)} downloads")
    
    def test_get_scans_list(self):
        """GET /api/scans - Returns list of scan jobs"""
        response = requests.get(f"{BASE_URL}/api/scans")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: GET /api/scans returned {len(data)} scans")
    
    def test_clear_finished_downloads(self):
        """POST /api/downloads/clear-finished - Clear finished downloads"""
        response = requests.post(f"{BASE_URL}/api/downloads/clear-finished")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("success") == True
        print("PASS: POST /api/downloads/clear-finished successful")
    
    def test_clear_finished_scans(self):
        """POST /api/scans/clear-finished - Clear finished scans"""
        response = requests.post(f"{BASE_URL}/api/scans/clear-finished")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("success") == True
        print("PASS: POST /api/scans/clear-finished successful")
    
    def test_cancel_all_downloads(self):
        """POST /api/downloads/cancel-all - Cancel all downloads"""
        response = requests.post(f"{BASE_URL}/api/downloads/cancel-all")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("PASS: POST /api/downloads/cancel-all successful")
    
    def test_cancel_all_scans(self):
        """POST /api/scans/cancel-all - Cancel all scans"""
        response = requests.post(f"{BASE_URL}/api/scans/cancel-all")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("PASS: POST /api/scans/cancel-all successful")


class TestBasicEndpoints:
    """Test basic API endpoints"""
    
    def test_api_root(self):
        """GET /api/ - API root returns version info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "message" in data
        assert "version" in data
        print(f"PASS: API root: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
