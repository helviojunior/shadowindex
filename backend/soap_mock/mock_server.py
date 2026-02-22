"""
SOAP Mock Server

A mock SOAP server for testing the ShadowIndex application.
Simulates the real SOAP API responses for:
- ListShares: Returns a list of file shares
- ListDirectory: Returns directory contents (files and folders)
- ResolveAddress: Resolves hostname to IP addresses
- DownloadFile: Returns file content as base64

ALL DATA IS FICTIONAL FOR TESTING PURPOSES ONLY.
"""

import os
import re
import base64
import logging
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, Request, Response
from fastapi.responses import PlainTextResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SOAP Mock Server", version="1.0.0")

# ============================================
# FICTIONAL MOCK DATA - FOR TESTING ONLY
# ============================================

MOCK_SERVER_IP = "10.20.30.40"

MOCK_SHARES = [
    {"host": MOCK_SERVER_IP, "name": "ADMIN$", "type": "Disk", "remark": "Remote Admin"},
    {"host": MOCK_SERVER_IP, "name": "C$", "type": "Disk", "remark": "Default share"},
    {"host": MOCK_SERVER_IP, "name": "D$", "type": "Disk", "remark": "Default share"},
    {"host": MOCK_SERVER_IP, "name": "SharedDocs", "type": "Disk", "remark": "Shared Documents"},
    {"host": MOCK_SERVER_IP, "name": "Projects", "type": "Disk", "remark": "Project Files"},
    {"host": MOCK_SERVER_IP, "name": "Backups", "type": "Disk", "remark": "Backup Storage"},
    {"host": MOCK_SERVER_IP, "name": "IPC$", "type": "IPC", "remark": "Remote IPC"},
    {"host": MOCK_SERVER_IP, "name": "Logs", "type": "Disk", "remark": "Application Logs"},
    {"host": MOCK_SERVER_IP, "name": "RestrictedArea", "type": "Disk", "remark": "Restricted Access"},
]

# Fictional directory structure
MOCK_DIRECTORIES = {
    # C$ root
    f"\\\\{MOCK_SERVER_IP}\\C$": [
        {"type": "Directory", "name": "Windows", "length": "0", "s_length": "---", "lastwritetime": "2024-01-15 10:30:00Z"},
        {"type": "Directory", "name": "Program Files", "length": "0", "s_length": "---", "lastwritetime": "2024-02-20 14:45:00Z"},
        {"type": "Directory", "name": "Program Files (x86)", "length": "0", "s_length": "---", "lastwritetime": "2024-02-18 09:00:00Z"},
        {"type": "Directory", "name": "Users", "length": "0", "s_length": "---", "lastwritetime": "2024-03-01 08:00:00Z"},
        {"type": "Directory", "name": "Temp", "length": "0", "s_length": "---", "lastwritetime": "2024-03-10 16:20:00Z"},
        {"type": "Directory", "name": "Data", "length": "0", "s_length": "---", "lastwritetime": "2024-03-05 11:15:00Z"},
        {"type": "File", "name": "readme.txt", "length": "1024", "s_length": "1 KB", "lastwritetime": "2024-01-01 12:00:00Z"},
        {"type": "File", "name": "config.ini", "length": "512", "s_length": "512 B", "lastwritetime": "2024-02-15 10:00:00Z"},
        {"type": "File", "name": "system.log", "length": "25600", "s_length": "25 KB", "lastwritetime": "2024-03-10 23:59:59Z"},
    ],
    # Users directory
    f"\\\\{MOCK_SERVER_IP}\\C$\\Users": [
        {"type": "Directory", "name": "Administrator", "length": "0", "s_length": "---", "lastwritetime": "2024-02-28 14:30:00Z"},
        {"type": "Directory", "name": "JohnDoe", "length": "0", "s_length": "---", "lastwritetime": "2024-03-08 09:15:00Z"},
        {"type": "Directory", "name": "JaneSmith", "length": "0", "s_length": "---", "lastwritetime": "2024-03-09 16:45:00Z"},
        {"type": "Directory", "name": "Public", "length": "0", "s_length": "---", "lastwritetime": "2024-01-20 08:00:00Z"},
        {"type": "File", "name": "desktop.ini", "length": "174", "s_length": "174 B", "lastwritetime": "2024-01-01 00:00:00Z"},
    ],
    # Program Files
    f"\\\\{MOCK_SERVER_IP}\\C$\\Program Files": [
        {"type": "Directory", "name": "Common Files", "length": "0", "s_length": "---", "lastwritetime": "2024-01-15 10:00:00Z"},
        {"type": "Directory", "name": "Microsoft Office", "length": "0", "s_length": "---", "lastwritetime": "2024-02-10 14:30:00Z"},
        {"type": "Directory", "name": "Internet Explorer", "length": "0", "s_length": "---", "lastwritetime": "2023-12-20 09:00:00Z"},
        {"type": "Directory", "name": "MyApplication", "length": "0", "s_length": "---", "lastwritetime": "2024-03-01 18:00:00Z"},
    ],
    # Temp directory
    f"\\\\{MOCK_SERVER_IP}\\C$\\Temp": [
        {"type": "File", "name": "temp_001.tmp", "length": "1024", "s_length": "1 KB", "lastwritetime": "2024-03-10 10:00:00Z"},
        {"type": "File", "name": "temp_002.tmp", "length": "2048", "s_length": "2 KB", "lastwritetime": "2024-03-10 11:00:00Z"},
        {"type": "File", "name": "install.log", "length": "15360", "s_length": "15 KB", "lastwritetime": "2024-03-09 14:30:00Z"},
        {"type": "File", "name": "session_data.dat", "length": "4096", "s_length": "4 KB", "lastwritetime": "2024-03-10 12:00:00Z"},
    ],
    # Data directory
    f"\\\\{MOCK_SERVER_IP}\\C$\\Data": [
        {"type": "Directory", "name": "Reports", "length": "0", "s_length": "---", "lastwritetime": "2024-03-05 09:00:00Z"},
        {"type": "Directory", "name": "Exports", "length": "0", "s_length": "---", "lastwritetime": "2024-03-04 14:00:00Z"},
        {"type": "File", "name": "database.db", "length": "1048576", "s_length": "1 MB", "lastwritetime": "2024-03-10 23:00:00Z"},
        {"type": "File", "name": "config.json", "length": "2048", "s_length": "2 KB", "lastwritetime": "2024-03-01 10:00:00Z"},
    ],
    # D$ root
    f"\\\\{MOCK_SERVER_IP}\\D$": [
        {"type": "Directory", "name": "Backup", "length": "0", "s_length": "---", "lastwritetime": "2024-02-28 08:00:00Z"},
        {"type": "Directory", "name": "Archives", "length": "0", "s_length": "---", "lastwritetime": "2024-03-01 16:00:00Z"},
        {"type": "Directory", "name": "Media", "length": "0", "s_length": "---", "lastwritetime": "2024-02-20 12:00:00Z"},
        {"type": "File", "name": "readme.txt", "length": "256", "s_length": "256 B", "lastwritetime": "2024-01-01 10:00:00Z"},
    ],
    # SharedDocs
    f"\\\\{MOCK_SERVER_IP}\\SharedDocs": [
        {"type": "Directory", "name": "HR", "length": "0", "s_length": "---", "lastwritetime": "2024-03-05 09:00:00Z"},
        {"type": "Directory", "name": "Finance", "length": "0", "s_length": "---", "lastwritetime": "2024-03-08 11:00:00Z"},
        {"type": "Directory", "name": "Marketing", "length": "0", "s_length": "---", "lastwritetime": "2024-03-07 15:00:00Z"},
        {"type": "File", "name": "company_policy.pdf", "length": "524288", "s_length": "512 KB", "lastwritetime": "2024-02-15 10:00:00Z"},
        {"type": "File", "name": "employee_handbook.docx", "length": "262144", "s_length": "256 KB", "lastwritetime": "2024-01-20 14:00:00Z"},
    ],
    # Projects
    f"\\\\{MOCK_SERVER_IP}\\Projects": [
        {"type": "Directory", "name": "ProjectAlpha", "length": "0", "s_length": "---", "lastwritetime": "2024-03-10 10:00:00Z"},
        {"type": "Directory", "name": "ProjectBeta", "length": "0", "s_length": "---", "lastwritetime": "2024-03-09 16:00:00Z"},
        {"type": "Directory", "name": "ProjectGamma", "length": "0", "s_length": "---", "lastwritetime": "2024-03-08 12:00:00Z"},
        {"type": "File", "name": "project_overview.xlsx", "length": "131072", "s_length": "128 KB", "lastwritetime": "2024-03-05 09:00:00Z"},
    ],
    # Logs
    f"\\\\{MOCK_SERVER_IP}\\Logs": [
        {"type": "File", "name": "app_2024-03-10.log", "length": "51200", "s_length": "50 KB", "lastwritetime": "2024-03-10 23:59:59Z"},
        {"type": "File", "name": "app_2024-03-09.log", "length": "102400", "s_length": "100 KB", "lastwritetime": "2024-03-09 23:59:59Z"},
        {"type": "File", "name": "error.log", "length": "10240", "s_length": "10 KB", "lastwritetime": "2024-03-10 18:30:00Z"},
        {"type": "File", "name": "access.log", "length": "204800", "s_length": "200 KB", "lastwritetime": "2024-03-10 23:59:59Z"},
    ],
    # RestrictedArea - Will return access denied
    f"\\\\{MOCK_SERVER_IP}\\RestrictedArea": None,
}

# Fictional file contents
MOCK_FILES = {
    f"\\\\{MOCK_SERVER_IP}\\C$\\readme.txt": "Welcome to the Mock SOAP Server!\n\nThis is a test file for development purposes.\nAll data is fictional.",
    f"\\\\{MOCK_SERVER_IP}\\C$\\config.ini": "[Settings]\nDebugMode=false\nLogLevel=INFO\nMaxConnections=100",
    f"\\\\{MOCK_SERVER_IP}\\C$\\system.log": "2024-03-10 10:00:00 INFO System started\n2024-03-10 10:05:00 INFO Service initialized\n2024-03-10 10:10:00 DEBUG Processing request\n2024-03-10 10:15:00 INFO Request completed",
    f"\\\\{MOCK_SERVER_IP}\\C$\\Temp\\temp_001.tmp": "Temporary data file content - for testing purposes only.",
    f"\\\\{MOCK_SERVER_IP}\\C$\\Temp\\temp_002.tmp": "Another temporary file with mock content.",
    f"\\\\{MOCK_SERVER_IP}\\C$\\Temp\\install.log": "Installation Log\n================\nStep 1: Preparing installation... OK\nStep 2: Copying files... OK\nStep 3: Configuring... OK\nStep 4: Completing... OK\nInstallation successful!",
    f"\\\\{MOCK_SERVER_IP}\\C$\\Data\\config.json": '{\n  "appName": "MockApp",\n  "version": "1.0.0",\n  "debug": false,\n  "database": {\n    "host": "localhost",\n    "port": 5432\n  }\n}',
    f"\\\\{MOCK_SERVER_IP}\\D$\\readme.txt": "Data Drive\n\nThis drive contains backup and archive files.",
    f"\\\\{MOCK_SERVER_IP}\\SharedDocs\\company_policy.pdf": "PDF MOCK CONTENT - Company Policy Document (Binary content would be here)",
    f"\\\\{MOCK_SERVER_IP}\\Logs\\error.log": "2024-03-10 15:30:00 ERROR Connection timeout\n2024-03-10 16:00:00 ERROR Invalid request\n2024-03-10 18:30:00 WARNING High memory usage",
}


# Helper functions
def escape_xml(text: str) -> str:
    """Escape special XML characters"""
    if text is None:
        return ""
    return (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;"))


def build_shares_response(host_ip: str = None) -> str:
    """Build ListShares SOAP response"""
    # Use the requested host or default mock IP
    target_ip = host_ip if host_ip else MOCK_SERVER_IP
    
    results = ""
    for idx, share in enumerate(MOCK_SHARES, 1):
        results += f'''<Result diffgr:id="Result{idx}" msdata:rowOrder="{idx-1}" diffgr:hasChanges="inserted"><host>{target_ip}</host><name>{escape_xml(share["name"])}</name><type>{share["type"]}</type><remark>{escape_xml(share["remark"])}</remark></Result>'''
    
    return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ListSharesResponse xmlns="http://test/"><ListSharesResult><xs:schema id="NewDataSet" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata"><xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:MainDataTable="Result" msdata:UseCurrentLocale="true"><xs:complexType><xs:choice minOccurs="0" maxOccurs="unbounded"><xs:element name="Result"><xs:complexType><xs:sequence><xs:element name="host" type="xs:string" minOccurs="0" /><xs:element name="name" type="xs:string" minOccurs="0" /><xs:element name="type" type="xs:string" minOccurs="0" /><xs:element name="remark" type="xs:string" minOccurs="0" /></xs:sequence></xs:complexType></xs:element></xs:choice></xs:complexType></xs:element></xs:schema><diffgr:diffgram xmlns:msdata="urn:schemas-microsoft-com:xml-msdata" xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement xmlns="">{results}</DocumentElement></diffgr:diffgram></ListSharesResult></ListSharesResponse></soap:Body></soap:Envelope>'''


def build_directory_response(path: str) -> str:
    """Build ListDirectory SOAP response"""
    # Normalize path
    normalized_path = path.replace("/", "\\").rstrip("\\")
    
    # Replace any IP with mock IP for matching
    import re
    normalized_for_match = re.sub(r'\\\\[\d.]+\\', f'\\\\{MOCK_SERVER_IP}\\', normalized_path)
    
    # Check if path exists in mock data
    items = None
    for mock_path, mock_items in MOCK_DIRECTORIES.items():
        if mock_path.lower() == normalized_for_match.lower():
            items = mock_items
            break
    
    # Access denied for RestrictedArea
    if items is None and "RestrictedArea" in normalized_path:
        return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ListDirectoryResponse xmlns="http://test/"><ListDirectoryResult><xs:schema id="NewDataSet" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata"><xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:MainDataTable="Result" msdata:UseCurrentLocale="true"><xs:complexType><xs:choice minOccurs="0" maxOccurs="unbounded"><xs:element name="Result"><xs:complexType><xs:sequence><xs:element name="type" type="xs:string" minOccurs="0" /><xs:element name="name" type="xs:string" minOccurs="0" /><xs:element name="length" type="xs:string" minOccurs="0" /><xs:element name="s_length" type="xs:string" minOccurs="0" /><xs:element name="lastwritetime" type="xs:string" minOccurs="0" /><xs:element name="fullname" type="xs:string" minOccurs="0" /><xs:element name="message" type="xs:string" minOccurs="0" /><xs:element name="stacktrace" type="xs:string" minOccurs="0" /></xs:sequence></xs:complexType></xs:element></xs:choice></xs:complexType></xs:element></xs:schema><diffgr:diffgram xmlns:msdata="urn:schemas-microsoft-com:xml-msdata" xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement xmlns=""><Result diffgr:id="Result1" msdata:rowOrder="0" diffgr:hasChanges="inserted"><message>Access to the path '{escape_xml(normalized_path)}' is denied.</message><stacktrace>   at System.IO.__Error.WinIOError(Int32 errorCode, String maybeFullPath)
   at System.IO.FileSystemEnumerableIterator`1.CommonInit()
   at MockService.MockService.ListDirectory(String path, String key)</stacktrace></Result></DocumentElement></diffgr:diffgram></ListDirectoryResult></ListDirectoryResponse></soap:Body></soap:Envelope>'''
    
    # Empty directory or not found - return empty result
    if not items:
        items = []
    
    # Build results - use the original path's IP for fullname
    original_ip = MOCK_SERVER_IP
    ip_match = re.search(r'\\\\([\d.]+)\\', normalized_path)
    if ip_match:
        original_ip = ip_match.group(1)
    
    results = ""
    for idx, item in enumerate(items, 1):
        fullname = f"\\\\{original_ip}\\{normalized_path.split('\\')[-1] if '\\' in normalized_path else ''}\\{item['name']}"
        if normalized_path.count('\\') > 3:
            # Build full path properly
            parts = normalized_path.split('\\')
            share_and_path = '\\'.join(parts[3:])
            fullname = f"\\\\{original_ip}\\{share_and_path}\\{item['name']}"
        else:
            share_name = normalized_path.split('\\')[-1] if '\\' in normalized_path else ''
            fullname = f"\\\\{original_ip}\\{share_name}\\{item['name']}"
        
        results += f'''<Result diffgr:id="Result{idx}" msdata:rowOrder="{idx-1}" diffgr:hasChanges="inserted"><type>{item["type"]}</type><name>{escape_xml(item["name"])}</name><length>{item["length"]}</length><s_length>{item["s_length"]}</s_length><lastwritetime>{item["lastwritetime"]}</lastwritetime><fullname>{escape_xml(fullname)}</fullname></Result>'''
    
    return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ListDirectoryResponse xmlns="http://test/"><ListDirectoryResult><xs:schema id="NewDataSet" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata"><xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:MainDataTable="Result" msdata:UseCurrentLocale="true"><xs:complexType><xs:choice minOccurs="0" maxOccurs="unbounded"><xs:element name="Result"><xs:complexType><xs:sequence><xs:element name="type" type="xs:string" minOccurs="0" /><xs:element name="name" type="xs:string" minOccurs="0" /><xs:element name="length" type="xs:string" minOccurs="0" /><xs:element name="s_length" type="xs:string" minOccurs="0" /><xs:element name="lastwritetime" type="xs:string" minOccurs="0" /><xs:element name="fullname" type="xs:string" minOccurs="0" /></xs:sequence></xs:complexType></xs:element></xs:choice></xs:complexType></xs:element></xs:schema><diffgr:diffgram xmlns:msdata="urn:schemas-microsoft-com:xml-msdata" xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement xmlns="">{results}</DocumentElement></diffgr:diffgram></ListDirectoryResult></ListDirectoryResponse></soap:Body></soap:Envelope>'''


def build_resolve_address_response(hostname: str) -> str:
    """Build ResolveAddress SOAP response"""
    # Fictional IP resolution
    if hostname.lower() in ["localhost", "127.0.0.1"]:
        result = "::1,127.0.0.1"
    elif hostname.lower() == "mock-server":
        result = MOCK_SERVER_IP
    elif hostname.lower() == "fileserver":
        result = "10.20.30.50"
    elif hostname.lower() == "dbserver":
        result = "10.20.30.60"
    elif hostname.lower() == "webserver":
        result = "10.20.30.70"
    else:
        # Generate a deterministic fake IP based on hostname
        hash_val = sum(ord(c) for c in hostname) % 255
        result = f"10.20.30.{hash_val}"
    
    return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ResolveAddressResponse xmlns="http://test/"><ResolveAddressResult>{result}</ResolveAddressResult></ResolveAddressResponse></soap:Body></soap:Envelope>'''


def build_download_file_response(path: str, offset: int = 0, length: int = 0) -> str:
    """Build DownloadFile SOAP response"""
    # Normalize path
    normalized_path = path.replace("/", "\\").rstrip("\\")
    
    # Replace any IP with mock IP for matching
    import re
    normalized_for_match = re.sub(r'\\\\[\d.]+\\', f'\\\\{MOCK_SERVER_IP}\\', normalized_path)
    
    # Check if file exists in mock data
    content = None
    for mock_path, mock_content in MOCK_FILES.items():
        if mock_path.lower() == normalized_for_match.lower():
            content = mock_content
            break
    
    if content is None:
        # File not found
        error_msg = f"File {escape_xml(normalized_path)} not found!\n   at MockService.MockService.DownloadFile(String path, String key, String offset, String length)"
        return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><DownloadFileResponse xmlns="http://test/"><DownloadFileResult>{error_msg}</DownloadFileResult></DownloadFileResponse></soap:Body></soap:Envelope>'''
    
    # Apply offset and length
    content_bytes = content.encode('utf-8')
    if length > 0:
        content_bytes = content_bytes[offset:offset + length]
    elif offset > 0:
        content_bytes = content_bytes[offset:]
    
    # Encode as base64
    content_b64 = base64.b64encode(content_bytes).decode('ascii')
    
    return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><DownloadFileResponse xmlns="http://test/"><DownloadFileResult>{content_b64}</DownloadFileResult></DownloadFileResponse></soap:Body></soap:Envelope>'''


def parse_soap_request(body: str) -> tuple[str, dict]:
    """Parse SOAP request to extract operation and parameters"""
    # Extract operation name
    operation_match = re.search(r'<(\w+)\s+xmlns="http://test/">', body)
    if not operation_match:
        # Try without namespace
        operation_match = re.search(r'<soap:Body>\s*<(\w+)', body)
    
    if not operation_match:
        return None, {}
    
    operation = operation_match.group(1)
    
    # Extract parameters based on operation
    params = {}
    
    if operation == "ListShares":
        # <host>value</host>
        host_match = re.search(r'<host>([^<]*)</host>', body)
        if host_match:
            params["host"] = host_match.group(1)
    
    elif operation == "ListDirectory":
        # <path>value</path>
        path_match = re.search(r'<path>([^<]*)</path>', body)
        if path_match:
            params["path"] = path_match.group(1)
    
    elif operation == "ResolveAddress":
        # <hostname>value</hostname>
        hostname_match = re.search(r'<hostname>([^<]*)</hostname>', body)
        if hostname_match:
            params["hostname"] = hostname_match.group(1)
    
    elif operation == "DownloadFile":
        # <path>value</path>, <offset>value</offset>, <length>value</length>
        path_match = re.search(r'<path>([^<]*)</path>', body)
        offset_match = re.search(r'<offset>([^<]*)</offset>', body)
        length_match = re.search(r'<length>([^<]*)</length>', body)
        
        if path_match:
            params["path"] = path_match.group(1)
        if offset_match:
            try:
                params["offset"] = int(offset_match.group(1) or 0)
            except ValueError:
                params["offset"] = 0
        if length_match:
            try:
                params["length"] = int(length_match.group(1) or 0)
            except ValueError:
                params["length"] = 0
    
    return operation, params


@app.post("/soap")
@app.post("/soap/")
@app.post("/Test.asmx")
@app.post("/Test.asmx/")
async def soap_endpoint(request: Request):
    """Main SOAP endpoint"""
    body = await request.body()
    body_str = body.decode('utf-8')
    
    logger.info(f"Received SOAP request")
    logger.debug(f"Body: {body_str[:500]}...")
    
    operation, params = parse_soap_request(body_str)
    
    if not operation:
        return Response(
            content='<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Client</faultcode><faultstring>Invalid SOAP request</faultstring></soap:Fault></soap:Body></soap:Envelope>',
            media_type="text/xml"
        )
    
    logger.info(f"Operation: {operation}, Params: {params}")
    
    # Handle operations
    if operation == "ListShares":
        response_xml = build_shares_response(params.get("host"))
    elif operation == "ListDirectory":
        response_xml = build_directory_response(params.get("path", ""))
    elif operation == "ResolveAddress":
        response_xml = build_resolve_address_response(params.get("hostname", "localhost"))
    elif operation == "DownloadFile":
        response_xml = build_download_file_response(
            params.get("path", ""),
            params.get("offset", 0),
            params.get("length", 0)
        )
    else:
        # Unknown operation
        return Response(
            content=f'<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Client</faultcode><faultstring>Unknown operation: {operation}</faultstring></soap:Fault></soap:Body></soap:Envelope>',
            media_type="text/xml"
        )
    
    return Response(content=response_xml, media_type="text/xml")


@app.get("/")
async def health():
    """Health check endpoint"""
    return {
        "status": "ok", 
        "service": "SOAP Mock Server", 
        "version": "1.0.0",
        "note": "All data is fictional for testing purposes"
    }


@app.get("/Test.asmx")
async def wsdl():
    """Return a simple WSDL description"""
    wsdl_content = '''<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" 
                  xmlns:tns="http://test/" 
                  xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  targetNamespace="http://test/">
  <wsdl:types>
    <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="http://test/">
    </xs:schema>
  </wsdl:types>
  <wsdl:portType name="MockSoap">
    <wsdl:operation name="ListShares"/>
    <wsdl:operation name="ListDirectory"/>
    <wsdl:operation name="ResolveAddress"/>
    <wsdl:operation name="DownloadFile"/>
  </wsdl:portType>
  <wsdl:binding name="MockSoapBinding" type="tns:MockSoap">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
  </wsdl:binding>
  <wsdl:service name="MockService">
    <wsdl:port name="MockSoap" binding="tns:MockSoapBinding">
      <soap:address location="http://localhost:9999/Test.asmx"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>'''
    return Response(content=wsdl_content, media_type="text/xml")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("SOAP_MOCK_PORT", 9999))
    print(f"Starting SOAP Mock Server on port {port}")
    print("NOTE: All data is fictional for testing purposes only!")
    uvicorn.run(app, host="0.0.0.0", port=port)
