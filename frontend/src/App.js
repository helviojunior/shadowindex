import { useEffect, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Credentials from "@/pages/Credentials";
import DatabaseConnections from "@/pages/DatabaseConnections";
import ProxyServers from "@/pages/ProxyServers";
import SoapApis from "@/pages/SoapApis";
import SoapOperations from "@/pages/SoapOperations";
import Servers from "@/pages/Servers";
import ServerBrowser from "@/pages/ServerBrowser";
import ImportServers from "@/pages/ImportServers";
import AdDomains from "@/pages/AdDomains";
import AdBrowse from "@/pages/AdBrowse";
import FileNavigation from "@/pages/FileNavigation";
import Leaks from "@/pages/Leaks";
import BeautifyTest from "@/pages/BeautifyTest";
import SqlExecutor from "@/pages/SqlExecutor";
import SqlPresets from "@/pages/SqlPresets";
import Downloads from "@/pages/Downloads";
import OCRJobs from "@/pages/OCRJobs";
import GeneralSettings from "@/pages/GeneralSettings";
import CriticalSearchSettings from "@/pages/CriticalSearchSettings";
import PluginSoapConfig from "@/pages/PluginSoapConfig";
import PluginDirectConfig from "@/pages/PluginDirectConfig";
import ScanPools from "@/pages/ScanPools";
import ShareScan from "@/pages/ShareScan";
import ShareScanJobs from "@/pages/ShareScanJobs";
import AdvancedSearch from "@/pages/AdvancedSearch";
import ChangeDomainPassword from "@/pages/ChangeDomainPassword";
import { Toaster } from "@/components/ui/sonner";
import { AppProvider } from "@/contexts/AppContext";
import { UiSettingsProvider } from "@/contexts/UiSettingsContext";
import { ConnectionStatusProvider } from "@/contexts/ConnectionStatusContext";
import { WebSocketProvider } from "@/hooks/useWebSocket";
import ConnectionBridge from "@/components/ConnectionBridge";

function App() {
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <div className="App">
      <ConnectionStatusProvider>
        <WebSocketProvider>
          <ConnectionBridge>
            <AppProvider>
              <UiSettingsProvider>
              <BrowserRouter>
                <Layout darkMode={darkMode} setDarkMode={setDarkMode}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/servers" element={<Servers />} />
                    <Route path="/servers/import" element={<ImportServers />} />
                    <Route path="/servers/share-scan" element={<ShareScan />} />
                    <Route path="/servers/:serverId" element={<ServerBrowser />} />
                    <Route path="/servers/:serverId/browse" element={<ServerBrowser />} />
                    <Route path="/ad" element={<AdDomains />} />
                    <Route path="/ad/:domainId/browse" element={<AdBrowse />} />
                    <Route path="/search" element={<AdvancedSearch />} />
                    <Route path="/files/browse" element={<FileNavigation />} />
                    <Route path="/downloads" element={<Downloads />} />
                    <Route path="/leaks" element={<Leaks />} />
                    <Route path="/ocr" element={<OCRJobs />} />
                    <Route path="/jobs/share-scan" element={<ShareScanJobs />} />
                    <Route path="/credentials" element={<Credentials />} />
                    <Route path="/sql" element={<DatabaseConnections />} />
                    <Route path="/sql/presets" element={<SqlPresets />} />
                    <Route path="/sql/execute/:connectionId" element={<SqlExecutor />} />
                    <Route path="/db-connections" element={<DatabaseConnections />} />
                    <Route path="/proxy-servers" element={<ProxyServers />} />
                    <Route path="/soap-apis" element={<SoapApis />} />
                    <Route path="/soap-operations" element={<SoapOperations />} />
                    <Route path="/tools/change-password" element={<ChangeDomainPassword />} />
                    <Route path="/settings" element={<GeneralSettings />} />
                    <Route path="/settings/critical-search" element={<CriticalSearchSettings />} />
                    <Route path="/settings/scan-pools" element={<ScanPools />} />
                    <Route path="/plugins/soap" element={<PluginSoapConfig />} />
                    <Route path="/plugins/direct" element={<PluginDirectConfig />} />
                    <Route path="/beautify-test" element={<BeautifyTest />} />
                  </Routes>
                </Layout>
              </BrowserRouter>
              <Toaster position="top-right" richColors />
              </UiSettingsProvider>
            </AppProvider>
          </ConnectionBridge>
        </WebSocketProvider>
      </ConnectionStatusProvider>
    </div>
  );
}

export default App;