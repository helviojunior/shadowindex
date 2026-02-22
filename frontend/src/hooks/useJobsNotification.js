import { useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';

// Gerar som de notificação usando Web Audio API
const playNotificationSound = (type = 'success') => {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Criar oscilador para gerar o tom
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Configurar o som baseado no tipo
    if (type === 'success') {
      // Som de sucesso: dois tons ascendentes
      oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.15); // E5
      oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.3); // G5
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } else if (type === 'complete') {
      // Som de conclusão: acorde mais elaborado
      const oscillator2 = audioContext.createOscillator();
      const gainNode2 = audioContext.createGain();
      oscillator2.connect(gainNode2);
      gainNode2.connect(audioContext.destination);
      
      // Primeiro tom
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      // Segundo tom (harmonia)
      oscillator2.frequency.setValueAtTime(554.37, audioContext.currentTime + 0.1); // C#5
      gainNode2.gain.setValueAtTime(0.2, audioContext.currentTime + 0.1);
      gainNode2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
      oscillator2.start(audioContext.currentTime + 0.1);
      oscillator2.stop(audioContext.currentTime + 0.4);
      
      // Terceiro tom (finalização)
      setTimeout(() => {
        const osc3 = audioContext.createOscillator();
        const gain3 = audioContext.createGain();
        osc3.connect(gain3);
        gain3.connect(audioContext.destination);
        osc3.frequency.setValueAtTime(659.25, audioContext.currentTime); // E5
        gain3.gain.setValueAtTime(0.25, audioContext.currentTime);
        gain3.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
        osc3.start(audioContext.currentTime);
        osc3.stop(audioContext.currentTime + 0.4);
      }, 200);
    }
    
    // Fechar contexto após o som
    setTimeout(() => {
      audioContext.close();
    }, 1000);
    
  } catch (error) {
    console.warn('Could not play notification sound:', error);
  }
};

// Hook para monitorar jobs e notificar quando todos finalizarem
export const useJobsNotification = () => {
  const { subscribe } = useWebSocket();
  
  // Rastrear estado anterior de jobs ativos
  const prevDownloadActiveRef = useRef(0);
  const prevGitleaksActiveRef = useRef(0);
  const hasPlayedDownloadRef = useRef(false);
  const hasPlayedGitleaksRef = useRef(false);
  
  // Handler para atualização de stats de downloads
  const handleDownloadStats = useCallback((data) => {
    const currentActive = (data.downloading || 0) + (data.pending || 0);
    const prevActive = prevDownloadActiveRef.current;
    
    // Se tinha jobs ativos e agora não tem mais, tocar som
    if (prevActive > 0 && currentActive === 0 && !hasPlayedDownloadRef.current) {
      console.log('🔔 Todos os downloads finalizaram!');
      playNotificationSound('complete');
      hasPlayedDownloadRef.current = true;
      
      // Reset após 5 segundos para permitir nova notificação
      setTimeout(() => {
        hasPlayedDownloadRef.current = false;
      }, 5000);
    }
    
    // Se começou novos jobs, resetar flag
    if (currentActive > 0) {
      hasPlayedDownloadRef.current = false;
    }
    
    prevDownloadActiveRef.current = currentActive;
  }, []);
  
  // Handler para atualização de stats de GitLeaks
  const handleGitleaksStats = useCallback((data) => {
    const currentActive = data.running || 0;
    const prevActive = prevGitleaksActiveRef.current;
    
    // Se tinha jobs ativos e agora não tem mais, tocar som
    if (prevActive > 0 && currentActive === 0 && !hasPlayedGitleaksRef.current) {
      console.log('🔔 Todos os scans GitLeaks finalizaram!');
      playNotificationSound('complete');
      hasPlayedGitleaksRef.current = true;
      
      // Reset após 5 segundos para permitir nova notificação
      setTimeout(() => {
        hasPlayedGitleaksRef.current = false;
      }, 5000);
    }
    
    // Se começou novos jobs, resetar flag
    if (currentActive > 0) {
      hasPlayedGitleaksRef.current = false;
    }
    
    prevGitleaksActiveRef.current = currentActive;
  }, []);
  
  // Inscrever nos eventos de stats
  useEffect(() => {
    const unsubDownload = subscribe('download_stats', handleDownloadStats);
    const unsubGitleaks = subscribe('gitleaks_stats', handleGitleaksStats);
    
    return () => {
      unsubDownload();
      unsubGitleaks();
    };
  }, [subscribe, handleDownloadStats, handleGitleaksStats]);
};

export default useJobsNotification;
