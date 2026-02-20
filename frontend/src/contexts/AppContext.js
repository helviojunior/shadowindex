import { createContext, useContext, useState, useEffect } from 'react';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [ignoreCache, setIgnoreCache] = useState(() => {
    const saved = localStorage.getItem('ignoreCache');
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('ignoreCache', ignoreCache);
  }, [ignoreCache]);

  return (
    <AppContext.Provider value={{ ignoreCache, setIgnoreCache }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};
