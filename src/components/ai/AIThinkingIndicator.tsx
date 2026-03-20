'use client';

import React from 'react';

interface AIThinkingIndicatorProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

/**
 * Visual feedback for AI background tasks.
 * 
 * Provides a non-blocking pulse indicator to inform the user
 * that the AI is performing complex calculations.
 */
export const AIThinkingIndicator: React.FC<AIThinkingIndicatorProps> = ({
  size = 'md',
  label = 'AI Thinking...',
  className = '',
}) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-10 w-10',
  };

  const dotSizeClasses = {
    sm: 'h-1 w-1',
    md: 'h-2 w-2',
    lg: 'h-3 w-3',
  };

  return (
    <div 
      className={`flex items-center space-x-2 text-slate-500 transition-opacity duration-300 ${className}`}
      data-testid="ai-thinking-indicator"
    >
      <div className={`relative flex ${sizeClasses[size]}`}>
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
        <span className={`relative inline-flex rounded-full bg-indigo-500 ${sizeClasses[size]} items-center justify-center`}>
          <div className="flex space-x-0.5">
            <span className={`animate-bounce rounded-full bg-white ${dotSizeClasses[size]}`} style={{ animationDelay: '0s' }}></span>
            <span className={`animate-bounce rounded-full bg-white ${dotSizeClasses[size]}`} style={{ animationDelay: '0.2s' }}></span>
            <span className={`animate-bounce rounded-full bg-white ${dotSizeClasses[size]}`} style={{ animationDelay: '0.4s' }}></span>
          </div>
        </span>
      </div>
      {label && (
        <span className="text-sm font-medium italic tracking-wide">
          {label}
        </span>
      )}
    </div>
  );
};

export default AIThinkingIndicator;
