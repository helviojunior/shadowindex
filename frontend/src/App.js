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
import BeautifyTest from "@/pages/BeautifyTest";
import SqlExecutor from "@/pages/SqlExecutor";
import SqlPresets from "@/pages/SqlPresets";
import Downloads from "@/pages/Downloads";
import GeneralSettings from "@/pages/GeneralSettings";
import { Toaster } from "@/components/ui/sonner";
import { AppProvider } from "@/contexts/AppContext";

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
      <AppProvider>
        <BrowserRouter>
          <Layout darkMode={darkMode} setDarkMode={setDarkMode}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/servers" element={<Servers />} />
              <Route path="/servers/:serverId" element={<ServerBrowser />} />
              <Route path="/servers/:serverId/browse" element={<ServerBrowser />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/credentials" element={<Credentials />} />
              <Route path="/sql" element={<DatabaseConnections />} />
              <Route path="/sql/presets" element={<SqlPresets />} />
              <Route path="/sql/execute/:connectionId" element={<SqlExecutor />} />
              <Route path="/db-connections" element={<DatabaseConnections />} />
              <Route path="/proxy-servers" element={<ProxyServers />} />
              <Route path="/soap-apis" element={<SoapApis />} />
              <Route path="/soap-operations" element={<SoapOperations />} />
              <Route path="/settings" element={<GeneralSettings />} />
              <Route path="/beautify-test" element={<BeautifyTest />} />
            </Routes>
          </Layout>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AppProvider>
    </div>
  );
}

export default App;