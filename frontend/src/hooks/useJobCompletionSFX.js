import { useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';

/**
 * Hook para tocar som de notificação quando todos os jobs de um tipo são concluídos.
 * Monitora eventos WebSocket de estatísticas de downloads e gitleaks.
 * Toca som quando o número de jobs ativos vai de >0 para 0.
 */
export const useJobCompletionSFX = (enabled = true) => {
  const { isConnected } = useWebSocket();
  
  // Manter estado anterior dos jobs ativos
  const prevDownloadsActive = useRef(null);
  const prevGitleaksActive = useRef(null);
  const prevOcrActive = useRef(null);
  
  // AudioContext para gerar som
  const audioContextRef = useRef(null);

  // Função para tocar um som de notificação usando Web Audio API
  const playNotificationSound = useCallback(() => {
    try {
      // Criar AudioContext se não existir
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      
      // Criar oscilador para som de "ding"
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      // Configurar som agradável de notificação (duas notas)
      oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5
      oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1); // C#6
      
      oscillator.type = 'sine';
      
      // Envelope de volume
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.5);
      
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
        const data = JSON.parse(event.data);
        if (data.type === 'downloads_stats_updated' && data.data) {
          const active = (data.data.downloading || 0) + (data.data.pending || 0);
          checkAndPlaySound('Downloads', active, prevDownloadsActive);
        }
      } catch (e) {
        // Ignorar erros de parsing
      }
    };

    const handleGitleaksStats = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'gitleaks_stats_updated' && data.data) {
          const active = (data.data.running || 0) + (data.data.pending || 0);
          checkAndPlaySound('GitLeaks', active, prevGitleaksActive);
        }
      } catch (e) {
        // Ignorar erros de parsing
      }
    };

    const handleOcrStats = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ocr_stats_updated' && data.data) {
          const active = (data.data.running || 0) + (data.data.pending || 0);
          checkAndPlaySound('OCR', active, prevOcrActive);
        }
      } catch (e) {
        // Ignorar erros de parsing
      }
    };

    // Adicionar listeners ao WebSocket global
    window.addEventListener('ws_downloads_stats', handleDownloadStats);
    window.addEventListener('ws_gitleaks_stats', handleGitleaksStats);
    window.addEventListener('ws_ocr_stats', handleOcrStats);

    return () => {
      window.removeEventListener('ws_downloads_stats', handleDownloadStats);
      window.removeEventListener('ws_gitleaks_stats', handleGitleaksStats);
      window.removeEventListener('ws_ocr_stats', handleOcrStats);
    };
  }, [isConnected, enabled, checkAndPlaySound]);

  // Limpar AudioContext ao desmontar
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return { playNotificationSound };
};

export default useJobCompletionSFX;
