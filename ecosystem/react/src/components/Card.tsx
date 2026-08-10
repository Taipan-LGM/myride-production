import React from 'react';
import { colors, radius, shadow, spacing, typography } from '../tokens';

export interface CardProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  padding?: keyof typeof spacing;
  elevated?: boolean;
  style?: React.CSSProperties;
}

export function Card({
  children,
  title,
  subtitle,
  padding = 4,
  elevated = false,
  style,
}: CardProps) {
  return (
    <section
      style={{
        background: colors.surface.card,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radius.md,
        padding: spacing[padding],
        boxShadow: elevated ? shadow.md : shadow.sm,
        ...style,
      }}
    >
      {(title || subtitle) && (
        <header style={{ marginBottom: spacing[3] }}>
          {title && (
            <h3
              style={{
                margin: 0,
                fontFamily: typography.fontFamily,
                fontSize: typography.fontSize.h3,
                fontWeight: typography.fontWeight.semibold,
                color: colors.text.primary,
              }}
            >
              {title}
            </h3>
          )}
          {subtitle && (
            <p
              style={{
                margin: '4px 0 0',
                fontFamily: typography.fontFamily,
                fontSize: typography.fontSize.caption,
                color: colors.text.secondary,
              }}
            >
              {subtitle}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
