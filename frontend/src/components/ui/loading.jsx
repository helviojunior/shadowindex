import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Componente de loading inline - não bloqueia a UI
 */
export const LoadingSpinner = ({ size = 'default', className }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    default: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  return (
    <Loader2 className={cn(sizeClasses[size], 'animate-spin text-muted-foreground', className)} />
  );
};

/**
 * Componente de loading com texto
 */
export const LoadingIndicator = ({ text = 'Carregando...', size = 'default', className }) => {
  return (
    <div className={cn('flex items-center gap-2 text-muted-foreground', className)}>
      <LoadingSpinner size={size} />
      <span className="text-sm">{text}</span>
    </div>
  );
};

/**
 * Overlay de loading que cobre um container
 */
export const LoadingOverlay = ({ show, text = 'Carregando...', className }) => {
  if (!show) return null;

  return (
    <div className={cn(
      'absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50',
      className
    )}>
      <LoadingIndicator text={text} size="lg" />
    </div>
  );
};

/**
 * Skeleton para cards
 */
export const CardSkeleton = ({ className }) => {
  return (
    <div className={cn('animate-pulse rounded-lg bg-muted/50 h-32', className)} />
  );
};

/**
 * Skeleton para tabelas
 */
export const TableSkeleton = ({ rows = 5, className }) => {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse h-12 bg-muted/50 rounded" />
      ))}
    </div>
  );
};

export default LoadingSpinner;
