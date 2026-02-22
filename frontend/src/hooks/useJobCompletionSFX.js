import { useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import notificationSound from '@/assets/sounds/notification-sound.mp3';

/**
 * Hook para tocar som de notificação quando todos os jobs de um tipo são concluídos.
 * Monitora eventos WebSocket de estatísticas de downloads, gitleaks e OCR.
 * Toca som quando o número de jobs ativos vai de >0 para 0.
 */
export const useJobCompletionSFX = (enabled = true) => {
  const { isConnected } = useWebSocket();
  
  // Manter estado anterior dos jobs ativos
  const prevDownloadsActive = useRef(null);
  const prevGitleaksActive = useRef(null);
  const prevOcrActive = useRef(null);
  
  // Referência para o elemento de áudio
  const audioRef = useRef(null);

  // Inicializar elemento de áudio
  useEffect(() => {
    audioRef.current = new Audio(notificationSound);
    audioRef.current.volume = 0.5;
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Função para tocar o som de notificação
  const playNotificationSound = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(e => {
          console.warn('Erro ao tocar som de notificação:', e);
        });
      }
    } catch (error) {
      console.warn('Erro ao tocar som de notificação:', error);
    }
  }, []);

  // Função para verificar e tocar som quando jobs completam
  const checkAndPlaySound = useCallback((type, currentActive, prevRef) => {
    if (!enabled) return;
    
    const prevActive = prevRef.current;
    
    // Se tínhamos jobs ativos e agora temos 0, tocar som
    if (prevActive !== null && prevActive > 0 && currentActive === 0) {
      console.log(`[SFX] ${type}: ${prevActive} -> 0, tocando som`);
      playNotificationSound();
    }
    
    // Atualizar estado anterior
    prevRef.current = currentActive;
  }, [enabled, playNotificationSound]);

  // Escutar eventos de estatísticas via WebSocket
  useEffect(() => {
    if (!isConnected || !enabled) return;

    const handleDownloadStats = (event) => {
      try {
        const data = event.detail;
        if (data && data.data) {
          const active = (data.data.downloading || 0) + (data.data.pending || 0);
          checkAndPlaySound('Downloads', active, prevDownloadsActive);
        }
      } catch (e) {
        // Ignorar erros de parsing
      }
    };

    const handleGitleaksStats = (event) => {
      try {
        const data = event.detail;
        if (data && data.data) {
          const active = (data.data.running || 0) + (data.data.pending || 0);
          checkAndPlaySound('GitLeaks', active, prevGitleaksActive);
        }
      } catch (e) {
        // Ignorar erros de parsing
      }
    };

    const handleOcrStats = (event) => {
      try {
        const data = event.detail;
        if (data && data.data) {
          const active = (data.data.running || 0) + (data.data.pending || 0);
          checkAndPlaySound('OCR', active, prevOcrActive);
        }
      } catch (e) {
        // Ignorar erros de parsing
      }
    };

    // Adicionar listeners aos eventos customizados
    window.addEventListener('ws_downloads_stats', handleDownloadStats);
    window.addEventListener('ws_gitleaks_stats', handleGitleaksStats);
    window.addEventListener('ws_ocr_stats', handleOcrStats);

    return () => {
      window.removeEventListener('ws_downloads_stats', handleDownloadStats);
      window.removeEventListener('ws_gitleaks_stats', handleGitleaksStats);
      window.removeEventListener('ws_ocr_stats', handleOcrStats);
    };
  }, [isConnected, enabled, checkAndPlaySound]);

  return { playNotificationSound };
};

export default useJobCompletionSFX;
