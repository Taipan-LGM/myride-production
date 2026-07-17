import React from 'react';
import { colors, radius, typography } from '../tokens';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  icon?: React.ReactNode;
}

const badgeColors: Record<BadgeVariant, { bg: string; fg: string }> = {
  success: { bg: '#D1FAE5', fg: '#059669' },
  warning: { bg: '#FEF3C7', fg: '#D97706' },
  error: { bg: '#FEE2E2', fg: '#DC2626' },
  neutral: { bg: '#F1F5F9', fg: colors.text.secondary },
};

export function Badge({ children, variant = 'neutral', icon }: BadgeProps) {
  const { bg, fg } = badgeColors[variant];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        padding: '0 12px',
        borderRadius: radius.full,
        background: bg,
        color: fg,
        fontFamily: typography.fontFamily,
        fontSize: typography.fontSize.overline,
        fontWeight: typography.fontWeight.medium,
      }}
    >
      {icon}
      {children}
    </span>
  );
}
