"""
Test file for Downloads and Scans endpoints
Testing the new features:
1. Clear finished scans (POST /api/scans/clear-finished)
2. Clear finished downloads (POST /api/downloads/clear-finished) 
3. Cancel all scans (POST /api/scans/cancel-all)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestScansEndpoints:
    """Test Scans-related endpoints"""
    
    def test_get_scans_list(self):
        """Verify GET /api/scans returns list (may be empty)"""
        response = requests.get(f"{BASE_URL}/api/scans")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Scans should return a list"
        print(f"[PASS] GET /api/scans - returned {len(data)} scans")
    
    def test_clear_finished_scans(self):
        """Verify POST /api/scans/clear-finished clears finished scans"""
        response = requests.post(f"{BASE_URL}/api/scans/clear-finished")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "success" in data, "Response should have 'success' field"
        assert "cleared" in data, "Response should have 'cleared' field"
        assert data["success"] == True, "Success should be True"
        assert isinstance(data["cleared"], int), "Cleared should be an integer"
        print(f"[PASS] POST /api/scans/clear-finished - cleared {data['cleared']} scans")
    
    def test_cancel_all_scans(self):
        """Verify POST /api/scans/cancel-all works"""
        response = requests.post(f"{BASE_URL}/api/scans/cancel-all")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "success" in data, "Response should have 'success' field"
        assert "cancelled" in data, "Response should have 'cancelled' field"
        assert data["success"] == True, "Success should be True"
        print(f"[PASS] POST /api/scans/cancel-all - cancelled {data['cancelled']} scans")


class TestDownloadsEndpoints:
    """Test Downloads-related endpoints"""
    
    def test_get_downloads_list(self):
        """Verify GET /api/downloads returns list"""
        response = requests.get(f"{BASE_URL}/api/downloads")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Downloads should return a list"
        print(f"[PASS] GET /api/downloads - returned {len(data)} downloads")
    
    def test_clear_finished_downloads(self):
        """Verify POST /api/downloads/clear-finished works"""
        response = requests.post(f"{BASE_URL}/api/downloads/clear-finished")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "success" in data, "Response should have 'success' field"
        assert data["success"] == True, "Success should be True"
        print(f"[PASS] POST /api/downloads/clear-finished - cleared downloads successfully")
    
    def test_cancel_all_downloads(self):
        """Verify POST /api/downloads/cancel-all works"""
        response = requests.post(f"{BASE_URL}/api/downloads/cancel-all")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "success" in data, "Response should have 'success' field"
        assert data["success"] == True, "Success should be True"
        print(f"[PASS] POST /api/downloads/cancel-all - cancelled all downloads")


class TestAPIHealth:
    """Basic health checks"""
    
    def test_api_root(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "message" in data, "Root should return message"
        print(f"[PASS] GET /api/ - API is accessible")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
