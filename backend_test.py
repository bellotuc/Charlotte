#!/usr/bin/env python3
"""
Chat Stealth API Backend Test Suite
Tests all API endpoints as specified in the review request
"""

import requests
import json
import time
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

class ChatStealthAPITester:
    def __init__(self, base_url: str = "https://private-chat-130.emergent.host"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.session_data = {}
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str, response_data: Any = None):
        """Log test results"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat(),
            "response_data": response_data
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {details}")
        if response_data and not success:
            print(f"   Response: {response_data}")
    
    def test_health_endpoint(self):
        """Test GET /health endpoint"""
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "healthy":
                    self.log_test("Health Check", True, "Health endpoint returned healthy status", data)
                    return True
                else:
                    self.log_test("Health Check", False, f"Unexpected health status: {data}", data)
                    return False
            else:
                self.log_test("Health Check", False, f"HTTP {response.status_code}: {response.text}", response.text)
                return False
        except Exception as e:
            self.log_test("Health Check", False, f"Request failed: {str(e)}")
            return False
    
    def test_api_root(self):
        """Test GET /api/ endpoint"""
        try:
            response = requests.get(f"{self.api_url}/", timeout=10)
            if response.status_code == 200:
                data = response.json()
                expected_message = "Chat Stealth API"
                expected_status = "active"
                
                if data.get("message") == expected_message and data.get("status") == expected_status:
                    self.log_test("API Root", True, "API root returned correct message and status", data)
                    return True
                else:
                    self.log_test("API Root", False, f"Unexpected response format: {data}", data)
                    return False
            else:
                self.log_test("API Root", False, f"HTTP {response.status_code}: {response.text}", response.text)
                return False
        except Exception as e:
            self.log_test("API Root", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_config(self):
        """Test GET /api/config endpoint"""
        try:
            response = requests.get(f"{self.api_url}/config", timeout=10)
            if response.status_code == 200:
                data = response.json()
                required_fields = ["stripe_publishable_key", "pro_price", "free_ttl_minutes", "pro_ttl_minutes"]
                
                missing_fields = [field for field in required_fields if field not in data]
                if not missing_fields:
                    # Verify expected values
                    if (data.get("pro_price") == 999 and 
                        data.get("free_ttl_minutes") == 5 and 
                        data.get("pro_ttl_minutes") == 30):
                        self.log_test("Config Endpoint", True, "Config returned all required fields with correct values", data)
                        return True
                    else:
                        self.log_test("Config Endpoint", False, f"Config values don't match expected: {data}", data)
                        return False
                else:
                    self.log_test("Config Endpoint", False, f"Missing required fields: {missing_fields}", data)
                    return False
            else:
                self.log_test("Config Endpoint", False, f"HTTP {response.status_code}: {response.text}", response.text)
                return False
        except Exception as e:
            self.log_test("Config Endpoint", False, f"Request failed: {str(e)}")
            return False
    
    def test_create_session(self, nickname: Optional[str] = None):
        """Test POST /api/sessions endpoint"""
        try:
            payload = {}
            if nickname:
                payload["nickname"] = nickname
            
            response = requests.post(f"{self.api_url}/sessions", json=payload, timeout=10)
            if response.status_code == 200:
                data = response.json()
                required_fields = ["id", "code", "is_pro", "message_ttl_minutes", "created_at", "expires_at"]
                
                missing_fields = [field for field in required_fields if field not in data]
                if not missing_fields:
                    # Verify expected values for free session
                    if (data.get("is_pro") == False and 
                        data.get("message_ttl_minutes") == 5 and
                        len(data.get("code", "")) == 6):
                        
                        # Store session data for subsequent tests
                        self.session_data = data
                        self.log_test("Create Session", True, f"Session created successfully with code: {data['code']}", data)
                        return True
                    else:
                        self.log_test("Create Session", False, f"Session values don't match expected: {data}", data)
                        return False
                else:
                    self.log_test("Create Session", False, f"Missing required fields: {missing_fields}", data)
                    return False
            else:
                self.log_test("Create Session", False, f"HTTP {response.status_code}: {response.text}", response.text)
                return False
        except Exception as e:
            self.log_test("Create Session", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_session_by_code(self):
        """Test GET /api/sessions/{code} endpoint"""
        if not self.session_data.get("code"):
            self.log_test("Get Session by Code", False, "No session code available from previous test")
            return False
        
        try:
            code = self.session_data["code"]
            response = requests.get(f"{self.api_url}/sessions/{code}", timeout=10)
            if response.status_code == 200:
                data = response.json()
                
                # Verify the returned session matches the created one
                if (data.get("id") == self.session_data.get("id") and
                    data.get("code") == self.session_data.get("code") and
                    data.get("is_pro") == self.session_data.get("is_pro")):
                    self.log_test("Get Session by Code", True, f"Successfully retrieved session by code: {code}", data)
                    return True
                else:
                    self.log_test("Get Session by Code", False, f"Retrieved session doesn't match created session", data)
                    return False
            else:
                self.log_test("Get Session by Code", False, f"HTTP {response.status_code}: {response.text}", response.text)
                return False
        except Exception as e:
            self.log_test("Get Session by Code", False, f"Request failed: {str(e)}")
            return False
    
    def test_send_message(self, content: str, sender_id: str, message_type: str = "text"):
        """Test POST /api/messages endpoint"""
        if not self.session_data.get("id"):
            self.log_test("Send Message", False, "No session ID available from previous test")
            return False
        
        try:
            payload = {
                "session_id": self.session_data["id"],
                "content": content,
                "message_type": message_type,
                "sender_id": sender_id
            }
            
            response = requests.post(f"{self.api_url}/messages", json=payload, timeout=10)
            if response.status_code == 200:
                data = response.json()
                required_fields = ["id", "session_id", "content", "message_type", "sender_id", "created_at", "expires_at"]
                
                missing_fields = [field for field in required_fields if field not in data]
                if not missing_fields:
                    # Verify message content and expiration
                    if (data.get("content") == content and
                        data.get("sender_id") == sender_id and
                        data.get("session_id") == self.session_data["id"]):
                        
                        # Check if expires_at is approximately 5 minutes from now
                        created_at = datetime.fromisoformat(data["created_at"].replace('Z', '+00:00'))
                        expires_at = datetime.fromisoformat(data["expires_at"].replace('Z', '+00:00'))
                        expected_expiry = created_at + timedelta(minutes=5)
                        
                        # Allow 1 minute tolerance
                        time_diff = abs((expires_at - expected_expiry).total_seconds())
                        if time_diff <= 60:
                            self.log_test("Send Message", True, f"Message sent successfully, expires in ~5 minutes", data)
                            return True
                        else:
                            self.log_test("Send Message", False, f"Message expiry time incorrect. Expected ~5min, got {time_diff}s difference", data)
                            return False
                    else:
                        self.log_test("Send Message", False, f"Message content doesn't match sent data", data)
                        return False
                else:
                    self.log_test("Send Message", False, f"Missing required fields: {missing_fields}", data)
                    return False
            else:
                self.log_test("Send Message", False, f"HTTP {response.status_code}: {response.text}", response.text)
                return False
        except Exception as e:
            self.log_test("Send Message", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_messages(self):
        """Test GET /api/sessions/{session_id}/messages endpoint"""
        if not self.session_data.get("id"):
            self.log_test("Get Messages", False, "No session ID available from previous test")
            return False
        
        try:
            session_id = self.session_data["id"]
            response = requests.get(f"{self.api_url}/sessions/{session_id}/messages", timeout=10)
            if response.status_code == 200:
                data = response.json()
                
                if isinstance(data, list):
                    # Should have the messages we sent earlier
                    if len(data) > 0:
                        # Verify message structure
                        first_message = data[0]
                        required_fields = ["id", "session_id", "content", "message_type", "sender_id", "created_at", "expires_at"]
                        missing_fields = [field for field in required_fields if field not in first_message]
                        
                        if not missing_fields:
                            self.log_test("Get Messages", True, f"Retrieved {len(data)} messages successfully", data)
                            return True
                        else:
                            self.log_test("Get Messages", False, f"Message missing required fields: {missing_fields}", data)
                            return False
                    else:
                        self.log_test("Get Messages", True, "No messages found (empty list returned)", data)
                        return True
                else:
                    self.log_test("Get Messages", False, f"Expected list, got: {type(data)}", data)
                    return False
            else:
                self.log_test("Get Messages", False, f"HTTP {response.status_code}: {response.text}", response.text)
                return False
        except Exception as e:
            self.log_test("Get Messages", False, f"Request failed: {str(e)}")
            return False
    
    def run_full_test_suite(self):
        """Run the complete test suite as specified in the review request"""
        print("🚀 Starting Chat Stealth API Test Suite")
        print("=" * 50)
        
        # Test flow as specified in review request
        tests_passed = 0
        total_tests = 0
        
        # 1. Health checks
        total_tests += 1
        if self.test_health_endpoint():
            tests_passed += 1
        
        total_tests += 1
        if self.test_api_root():
            tests_passed += 1
        
        # 2. Config endpoint
        total_tests += 1
        if self.test_get_config():
            tests_passed += 1
        
        # 3. Create a session
        total_tests += 1
        if self.test_create_session("TestUser"):
            tests_passed += 1
        
        # 4. Get session by code
        total_tests += 1
        if self.test_get_session_by_code():
            tests_passed += 1
        
        # 5. Send 2-3 test messages
        test_messages = [
            ("Hello test", "user123"),
            ("This is a second message", "user456"),
            ("Final test message", "user123")
        ]
        
        for content, sender_id in test_messages:
            total_tests += 1
            if self.test_send_message(content, sender_id):
                tests_passed += 1
        
        # 6. Retrieve messages
        total_tests += 1
        if self.test_get_messages():
            tests_passed += 1
        
        # Print summary
        print("\n" + "=" * 50)
        print(f"📊 Test Summary: {tests_passed}/{total_tests} tests passed")
        
        if tests_passed == total_tests:
            print("🎉 All tests passed! Chat Stealth API is working correctly.")
            return True
        else:
            print(f"⚠️  {total_tests - tests_passed} tests failed. See details above.")
            return False
    
    def print_detailed_results(self):
        """Print detailed test results"""
        print("\n📋 Detailed Test Results:")
        print("-" * 30)
        for result in self.test_results:
            status = "✅" if result["success"] else "❌"
            print(f"{status} {result['test']}: {result['details']}")
            if not result["success"] and result.get("response_data"):
                print(f"   Response: {result['response_data']}")

def main():
    """Main test execution"""
    # Use localhost since external routing for /api/ endpoints has issues
    tester = ChatStealthAPITester("http://localhost:8001")
    
    success = tester.run_full_test_suite()
    tester.print_detailed_results()
    
    return success

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)