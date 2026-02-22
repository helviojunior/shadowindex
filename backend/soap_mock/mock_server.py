"""
SOAP Mock Server

A mock SOAP server for testing the ShadowIndex application.
Simulates the real SOAP API responses for:
- ListShares: Returns a list of file shares
- ListDirectory: Returns directory contents (files and folders)
- ResolveAddress: Resolves hostname to IP addresses
- DownloadFile: Returns file content as base64
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

# Mock data
MOCK_SHARES = [
    {"host": "127.0.0.1", "name": "ADMIN$", "type": "Disk", "remark": "Remote Admin"},
    {"host": "127.0.0.1", "name": "AppLogs", "type": "Disk", "remark": ""},
    {"host": "127.0.0.1", "name": "AppLogsDNA", "type": "Disk", "remark": ""},
    {"host": "127.0.0.1", "name": "C$", "type": "Disk", "remark": "Default share"},
    {"host": "127.0.0.1", "name": "Change Manager", "type": "Disk", "remark": ""},
    {"host": "127.0.0.1", "name": "D$", "type": "Disk", "remark": "Default share"},
    {"host": "127.0.0.1", "name": "IPC$", "type": "IPC", "remark": "Remote IPC"},
    {"host": "127.0.0.1", "name": "Logs", "type": "Disk", "remark": ""},
    {"host": "127.0.0.1", "name": "S$", "type": "Disk", "remark": "Default share"},
]

MOCK_DIRECTORIES = {
    # C$ root
    "\\\\127.0.0.1\\C$": [
        {"type": "Directory", "name": "$Recycle.Bin", "length": "0", "s_length": "---", "lastwritetime": "2025-06-27 10:26:30Z"},
        {"type": "Directory", "name": "Apps", "length": "0", "s_length": "---", "lastwritetime": "2025-06-02 19:11:51Z"},
        {"type": "Directory", "name": "azagent", "length": "0", "s_length": "---", "lastwritetime": "2023-04-13 10:56:14Z"},
        {"type": "Directory", "name": "Config.Msi", "length": "0", "s_length": "---", "lastwritetime": "2026-02-21 20:37:12Z"},
        {"type": "Directory", "name": "Documents and Settings", "length": "0", "s_length": "---", "lastwritetime": "2019-11-01 11:39:41Z"},
        {"type": "Directory", "name": "inetpub", "length": "0", "s_length": "---", "lastwritetime": "2019-12-12 15:08:42Z"},
        {"type": "Directory", "name": "Program Files", "length": "0", "s_length": "---", "lastwritetime": "2026-01-28 23:35:29Z"},
        {"type": "Directory", "name": "Program Files (x86)", "length": "0", "s_length": "---", "lastwritetime": "2025-11-07 14:06:54Z"},
        {"type": "Directory", "name": "ProgramData", "length": "0", "s_length": "---", "lastwritetime": "2025-10-22 15:38:02Z"},
        {"type": "Directory", "name": "Users", "length": "0", "s_length": "---", "lastwritetime": "2026-02-21 20:35:17Z"},
        {"type": "Directory", "name": "Windows", "length": "0", "s_length": "---", "lastwritetime": "2026-02-21 20:35:54Z"},
        {"type": "Directory", "name": "Temp", "length": "0", "s_length": "---", "lastwritetime": "2025-09-05 13:35:42Z"},
        {"type": "File", "name": ".scanner.log", "length": "10129", "s_length": "9,9 KB", "lastwritetime": "2026-02-11 15:51:36Z"},
        {"type": "File", "name": "filtros.txt", "length": "974686", "s_length": "951,8 KB", "lastwritetime": "2022-02-07 15:36:47Z"},
        {"type": "File", "name": "pagefile.sys", "length": "5905580032", "s_length": "5,5 GB", "lastwritetime": "2026-02-21 20:37:15Z"},
        {"type": "File", "name": "vcredist.exe", "length": "5207896", "s_length": "5 MB", "lastwritetime": "2020-05-06 13:30:40Z"},
    ],
    # Users directory
    "\\\\127.0.0.1\\C$\\Users": [
        {"type": "Directory", "name": "Administrator", "length": "0", "s_length": "---", "lastwritetime": "2025-10-15 14:30:00Z"},
        {"type": "Directory", "name": "Default", "length": "0", "s_length": "---", "lastwritetime": "2023-05-20 09:15:00Z"},
        {"type": "Directory", "name": "Public", "length": "0", "s_length": "---", "lastwritetime": "2024-08-10 16:45:00Z"},
        {"type": "File", "name": "desktop.ini", "length": "174", "s_length": "174 B", "lastwritetime": "2019-11-01 11:39:41Z"},
    ],
    # Program Files
    "\\\\127.0.0.1\\C$\\Program Files": [
        {"type": "Directory", "name": "Common Files", "length": "0", "s_length": "---", "lastwritetime": "2024-01-15 10:00:00Z"},
        {"type": "Directory", "name": "Internet Explorer", "length": "0", "s_length": "---", "lastwritetime": "2023-06-20 14:30:00Z"},
        {"type": "Directory", "name": "Microsoft", "length": "0", "s_length": "---", "lastwritetime": "2025-12-01 09:00:00Z"},
        {"type": "Directory", "name": "Windows Defender", "length": "0", "s_length": "---", "lastwritetime": "2025-11-30 18:00:00Z"},
    ],
    # Temp directory
    "\\\\127.0.0.1\\C$\\Temp": [
        {"type": "File", "name": "temp_log_001.txt", "length": "1024", "s_length": "1 KB", "lastwritetime": "2026-02-20 10:00:00Z"},
        {"type": "File", "name": "temp_log_002.txt", "length": "2048", "s_length": "2 KB", "lastwritetime": "2026-02-20 11:00:00Z"},
        {"type": "File", "name": "install.log", "length": "15360", "s_length": "15 KB", "lastwritetime": "2026-02-19 14:30:00Z"},
    ],
    # D$ root
    "\\\\127.0.0.1\\D$": [
        {"type": "Directory", "name": "Backup", "length": "0", "s_length": "---", "lastwritetime": "2025-12-15 08:00:00Z"},
        {"type": "Directory", "name": "Data", "length": "0", "s_length": "---", "lastwritetime": "2026-01-10 16:00:00Z"},
        {"type": "Directory", "name": "Logs", "length": "0", "s_length": "---", "lastwritetime": "2026-02-21 12:00:00Z"},
        {"type": "File", "name": "readme.txt", "length": "256", "s_length": "256 B", "lastwritetime": "2025-06-01 10:00:00Z"},
    ],
    # Access denied example
    "\\\\127.0.0.1\\AppLogs": None,  # Will return access denied
}

MOCK_FILES = {
    "\\\\127.0.0.1\\C$\\.scanner.log": "Scanner log content\nLine 2\nLine 3",
    "\\\\127.0.0.1\\C$\\filtros.txt": "Filter content example\nMultiple lines\nWith various data",
    "\\\\127.0.0.1\\C$\\Temp\\temp_log_001.txt": "Temporary log file content",
    "\\\\127.0.0.1\\C$\\Temp\\temp_log_002.txt": "Another temporary log file",
    "\\\\127.0.0.1\\C$\\Temp\\install.log": "Installation log\nStep 1: Complete\nStep 2: Complete\nInstallation finished",
    "\\\\127.0.0.1\\D$\\readme.txt": "Readme file content\nThis is a test file",
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


def build_shares_response(host_ip: str = "127.0.0.1") -> str:
    """Build ListShares SOAP response"""
    results = ""
    for idx, share in enumerate(MOCK_SHARES, 1):
        results += f'''<Result diffgr:id="Result{idx}" msdata:rowOrder="{idx-1}" diffgr:hasChanges="inserted"><host>{share["host"]}</host><name>{escape_xml(share["name"])}</name><type>{share["type"]}</type><remark>{escape_xml(share["remark"])}</remark></Result>'''
    
    return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ListSharesResponse xmlns="http://test/"><ListSharesResult><xs:schema id="NewDataSet" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata"><xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:MainDataTable="Result" msdata:UseCurrentLocale="true"><xs:complexType><xs:choice minOccurs="0" maxOccurs="unbounded"><xs:element name="Result"><xs:complexType><xs:sequence><xs:element name="host" type="xs:string" minOccurs="0" /><xs:element name="name" type="xs:string" minOccurs="0" /><xs:element name="type" type="xs:string" minOccurs="0" /><xs:element name="remark" type="xs:string" minOccurs="0" /></xs:sequence></xs:complexType></xs:element></xs:choice></xs:complexType></xs:element></xs:schema><diffgr:diffgram xmlns:msdata="urn:schemas-microsoft-com:xml-msdata" xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement xmlns="">{results}</DocumentElement></diffgr:diffgram></ListSharesResult></ListSharesResponse></soap:Body></soap:Envelope>'''


def build_directory_response(path: str) -> str:
    """Build ListDirectory SOAP response"""
    # Normalize path
    normalized_path = path.replace("/", "\\").rstrip("\\")
    
    # Check if path exists in mock data
    items = None
    for mock_path, mock_items in MOCK_DIRECTORIES.items():
        if mock_path.lower() == normalized_path.lower():
            items = mock_items
            break
    
    # Access denied
    if items is None and "AppLogs" in normalized_path and "DNA" not in normalized_path:
        return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ListDirectoryResponse xmlns="http://test/"><ListDirectoryResult><xs:schema id="NewDataSet" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata"><xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:MainDataTable="Result" msdata:UseCurrentLocale="true"><xs:complexType><xs:choice minOccurs="0" maxOccurs="unbounded"><xs:element name="Result"><xs:complexType><xs:sequence><xs:element name="type" type="xs:string" minOccurs="0" /><xs:element name="name" type="xs:string" minOccurs="0" /><xs:element name="length" type="xs:string" minOccurs="0" /><xs:element name="s_length" type="xs:string" minOccurs="0" /><xs:element name="lastwritetime" type="xs:string" minOccurs="0" /><xs:element name="fullname" type="xs:string" minOccurs="0" /><xs:element name="message" type="xs:string" minOccurs="0" /><xs:element name="stacktrace" type="xs:string" minOccurs="0" /></xs:sequence></xs:complexType></xs:element></xs:choice></xs:complexType></xs:element></xs:schema><diffgr:diffgram xmlns:msdata="urn:schemas-microsoft-com:xml-msdata" xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement xmlns=""><Result diffgr:id="Result1" msdata:rowOrder="0" diffgr:hasChanges="inserted"><message>Access to the path '{escape_xml(normalized_path)}' is denied.</message><stacktrace>   at System.IO.__Error.WinIOError(Int32 errorCode, String maybeFullPath)
   at System.IO.FileSystemEnumerableIterator`1.CommonInit()
   at Test.Test.ListDirectory(String path, String key)</stacktrace></Result></DocumentElement></diffgr:diffgram></ListDirectoryResult></ListDirectoryResponse></soap:Body></soap:Envelope>'''
    
    # Empty directory or not found - return empty result
    if not items:
        items = []
    
    # Build results
    results = ""
    for idx, item in enumerate(items, 1):
        fullname = f"{normalized_path}\\{item['name']}"
        results += f'''<Result diffgr:id="Result{idx}" msdata:rowOrder="{idx-1}" diffgr:hasChanges="inserted"><type>{item["type"]}</type><name>{escape_xml(item["name"])}</name><length>{item["length"]}</length><s_length>{item["s_length"]}</s_length><lastwritetime>{item["lastwritetime"]}</lastwritetime><fullname>{escape_xml(fullname)}</fullname></Result>'''
    
    return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ListDirectoryResponse xmlns="http://test/"><ListDirectoryResult><xs:schema id="NewDataSet" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata"><xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:MainDataTable="Result" msdata:UseCurrentLocale="true"><xs:complexType><xs:choice minOccurs="0" maxOccurs="unbounded"><xs:element name="Result"><xs:complexType><xs:sequence><xs:element name="type" type="xs:string" minOccurs="0" /><xs:element name="name" type="xs:string" minOccurs="0" /><xs:element name="length" type="xs:string" minOccurs="0" /><xs:element name="s_length" type="xs:string" minOccurs="0" /><xs:element name="lastwritetime" type="xs:string" minOccurs="0" /><xs:element name="fullname" type="xs:string" minOccurs="0" /></xs:sequence></xs:complexType></xs:element></xs:choice></xs:complexType></xs:element></xs:schema><diffgr:diffgram xmlns:msdata="urn:schemas-microsoft-com:xml-msdata" xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement xmlns="">{results}</DocumentElement></diffgr:diffgram></ListDirectoryResult></ListDirectoryResponse></soap:Body></soap:Envelope>'''


def build_resolve_address_response(hostname: str) -> str:
    """Build ResolveAddress SOAP response"""
    # Simple mock resolution
    if hostname.lower() in ["localhost", "127.0.0.1"]:
        result = "::1,127.0.0.1"
    elif hostname.lower() == "mock-server":
        result = "192.168.1.100"
    else:
        # Generate a fake IP based on hostname
        hash_val = sum(ord(c) for c in hostname) % 255
        result = f"10.0.0.{hash_val}"
    
    return f'''<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ResolveAddressResponse xmlns="http://test/"><ResolveAddressResult>{result}</ResolveAddressResult></ResolveAddressResponse></soap:Body></soap:Envelope>'''


def build_download_file_response(path: str, offset: int = 0, length: int = 0) -> str:
    """Build DownloadFile SOAP response"""
    # Normalize path
    normalized_path = path.replace("/", "\\").rstrip("\\")
    
    # Check if file exists in mock data
    content = None
    for mock_path, mock_content in MOCK_FILES.items():
        if mock_path.lower() == normalized_path.lower():
            content = mock_content
            break
    
    if content is None:
        # File not found
        error_msg = f"File {escape_xml(normalized_path)} not found!\n   at Test.Test.DownloadFile(String path, String key, String offset, String length)"
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
            params["offset"] = int(offset_match.group(1) or 0)
        if length_match:
            params["length"] = int(length_match.group(1) or 0)
    
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
        response_xml = build_shares_response(params.get("host", "127.0.0.1"))
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
    return {"status": "ok", "service": "SOAP Mock Server", "version": "1.0.0"}


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
  <wsdl:portType name="TestSoap">
    <wsdl:operation name="ListShares"/>
    <wsdl:operation name="ListDirectory"/>
    <wsdl:operation name="ResolveAddress"/>
    <wsdl:operation name="DownloadFile"/>
  </wsdl:portType>
  <wsdl:binding name="TestSoapBinding" type="tns:TestSoap">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
  </wsdl:binding>
  <wsdl:service name="Test">
    <wsdl:port name="TestSoap" binding="tns:TestSoapBinding">
      <soap:address location="http://localhost:9999/Test.asmx"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>'''
    return Response(content=wsdl_content, media_type="text/xml")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("SOAP_MOCK_PORT", 9999))
    uvicorn.run(app, host="0.0.0.0", port=port)
