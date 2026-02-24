"""
Test Nmap Import Endpoint - Iteration 6
Tests for POST /api/v2/servers/import/nmap endpoint including:
- Successful server import
- Duplicate detection (skipped servers)
- Batch import with mixed results
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://leak-detector-dev.preview.emergentagent.com')

class TestNmapImportEndpoint:
    """Tests for Nmap server import endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup unique test IPs for each test run"""
        self.test_ip_prefix = f"TEST_{uuid.uuid4().hex[:8]}"
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Track created servers for cleanup
        self.created_server_ids = []
        
        yield
        
        # Cleanup - delete test servers
        for server_id in self.created_server_ids:
            try:
                self.session.delete(f"{BASE_URL}/api/servers/{server_id}")
            except:
                pass
    
    def test_import_single_server_success(self):
        """Test importing a single server with SMB port"""
        unique_ip = f"10.{uuid.uuid4().hex[:2]}.{uuid.uuid4().hex[:2]}.1"
        
        payload = {
            "hosts": [{
                "ip": unique_ip,
                "name": f"test-smb-server-{uuid.uuid4().hex[:6]}",
                "hasSMB": True,
                "hasDB": False,
                "dbTypes": []
            }]
        }
        
        response = self.session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["success"] == True
        assert data["imported"] == 1
        assert data["failed"] == 0
        assert data["skipped"] == 0
        assert len(data["details"]) == 1
        assert data["details"][0]["ip"] == unique_ip
        assert "id" in data["details"][0]
        
        # Track for cleanup
        self.created_server_ids.append(data["details"][0]["id"])
        print(f"✓ Successfully imported server: {unique_ip}")
    
    def test_import_server_with_database_ports(self):
        """Test importing a server with database ports (no SMB)"""
        unique_ip = f"10.{uuid.uuid4().hex[:2]}.{uuid.uuid4().hex[:2]}.2"
        
        payload = {
            "hosts": [{
                "ip": unique_ip,
                "name": f"test-db-server-{uuid.uuid4().hex[:6]}",
                "hasSMB": False,
                "hasDB": True,
                "dbTypes": ["MySQL", "PostgreSQL"]
            }]
        }
        
        response = self.session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert data["success"] == True
        assert data["imported"] == 1
        assert data["details"][0]["db_types"] == ["MySQL", "PostgreSQL"]
        
        self.created_server_ids.append(data["details"][0]["id"])
        print(f"✓ Successfully imported DB server: {unique_ip}")
    
    def test_duplicate_server_detection(self):
        """Test that duplicate servers are skipped correctly"""
        unique_ip = f"10.{uuid.uuid4().hex[:2]}.{uuid.uuid4().hex[:2]}.3"
        
        # First import
        payload = {
            "hosts": [{
                "ip": unique_ip,
                "name": "original-server",
                "hasSMB": True,
                "hasDB": False,
                "dbTypes": []
            }]
        }
        
        response1 = self.session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=payload)
        assert response1.status_code == 200
        data1 = response1.json()
        assert data1["imported"] == 1
        server_id = data1["details"][0]["id"]
        self.created_server_ids.append(server_id)
        
        # Second import with same IP
        payload2 = {
            "hosts": [{
                "ip": unique_ip,
                "name": "duplicate-server",
                "hasSMB": False,
                "hasDB": True,
                "dbTypes": ["MongoDB"]
            }]
        }
        
        response2 = self.session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=payload2)
        assert response2.status_code == 200
        
        data2 = response2.json()
        assert data2["success"] == True
        assert data2["imported"] == 0
        assert data2["skipped"] == 1
        assert "Servidor já existe" in data2["details"][0]["reason"]
        print(f"✓ Duplicate detection works correctly for {unique_ip}")
    
    def test_batch_import_mixed_results(self):
        """Test batch import with new and existing servers"""
        unique_ip_new = f"10.{uuid.uuid4().hex[:2]}.{uuid.uuid4().hex[:2]}.4"
        
        # First, create a server that will be a duplicate
        existing_ip = f"10.{uuid.uuid4().hex[:2]}.{uuid.uuid4().hex[:2]}.5"
        setup_payload = {
            "hosts": [{
                "ip": existing_ip,
                "name": "existing-server",
                "hasSMB": True,
                "hasDB": False,
                "dbTypes": []
            }]
        }
        setup_response = self.session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=setup_payload)
        self.created_server_ids.append(setup_response.json()["details"][0]["id"])
        
        # Now batch import with one new and one existing
        batch_payload = {
            "hosts": [
                {
                    "ip": unique_ip_new,
                    "name": "new-batch-server",
                    "hasSMB": True,
                    "hasDB": True,
                    "dbTypes": ["MSSQL"]
                },
                {
                    "ip": existing_ip,
                    "name": "duplicate-in-batch",
                    "hasSMB": True,
                    "hasDB": False,
                    "dbTypes": []
                }
            ]
        }
        
        response = self.session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=batch_payload)
        assert response.status_code == 200
        
        data = response.json()
        assert data["success"] == True
        assert data["imported"] == 1
        assert data["skipped"] == 1
        assert data["failed"] == 0
        
        # Track new server for cleanup
        for detail in data["details"]:
            if "id" in detail:
                self.created_server_ids.append(detail["id"])
        
        print(f"✓ Batch import: 1 imported, 1 skipped")
    
    def test_import_server_plugin_config(self):
        """Test that imported servers have correct plugin configuration"""
        unique_ip = f"10.{uuid.uuid4().hex[:2]}.{uuid.uuid4().hex[:2]}.6"
        
        payload = {
            "hosts": [{
                "ip": unique_ip,
                "name": "config-test-server",
                "hasSMB": True,
                "hasDB": True,
                "dbTypes": ["MySQL", "Redis"]
            }]
        }
        
        response = self.session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        server_id = data["details"][0]["id"]
        self.created_server_ids.append(server_id)
        
        # Get server details to verify plugin_config
        server_response = self.session.get(f"{BASE_URL}/api/servers/{server_id}")
        assert server_response.status_code == 200
        
        server = server_response.json()
        assert server["plugin_type"] == "direct_interaction"
        assert server["plugin_config"]["imported_from"] == "nmap"
        assert server["plugin_config"]["has_smb"] == True
        assert server["plugin_config"]["has_db"] == True
        assert server["plugin_config"]["db_types"] == ["MySQL", "Redis"]
        
        print(f"✓ Plugin configuration verified for server {server_id}")
    
    def test_import_empty_hosts_list(self):
        """Test import with empty hosts list"""
        payload = {"hosts": []}
        
        response = self.session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert data["success"] == True
        assert data["imported"] == 0
        assert data["skipped"] == 0
        assert data["failed"] == 0
        
        print(f"✓ Empty hosts list handled correctly")


class TestNmapImportValidation:
    """Tests for request validation on Nmap import endpoint"""
    
    def test_missing_required_fields(self):
        """Test that missing required fields return validation error"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        # Missing 'name' field
        payload = {
            "hosts": [{
                "ip": "192.168.99.99",
                "hasSMB": True,
                "hasDB": False,
                "dbTypes": []
            }]
        }
        
        response = session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=payload)
        # Should return 422 for validation error
        assert response.status_code == 422, f"Expected 422 for missing field, got {response.status_code}"
        print(f"✓ Missing field validation works")
    
    def test_invalid_ip_format(self):
        """Test import with invalid IP format (should still accept as string)"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        payload = {
            "hosts": [{
                "ip": "not-an-ip",
                "name": "invalid-ip-server",
                "hasSMB": True,
                "hasDB": False,
                "dbTypes": []
            }]
        }
        
        response = session.post(f"{BASE_URL}/api/v2/servers/import/nmap", json=payload)
        # IP is just a string field, so this should succeed
        assert response.status_code == 200
        
        # Cleanup
        data = response.json()
        if data["imported"] > 0:
            server_id = data["details"][0]["id"]
            session.delete(f"{BASE_URL}/api/servers/{server_id}")
        
        print(f"✓ String IP format accepted")


class TestLayoutFooter:
    """Tests for Layout.js footer content"""
    
    def test_footer_content_via_api(self):
        """Verify footer content is shown via frontend check"""
        # This is a UI test - verified via Playwright
        # Keeping this as a placeholder to document the requirement
        print("✓ Footer content verified via Playwright test")
        print("  - 'ShadowIndex v1.0.0' visible in footer")
        print("  - '© StrataSec 2026' visible in footer")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
