import React from 'react';
import { colors, radius, shadow, spacing, typography } from '../tokens';

export type BottomSheetDetent = 'peek' | 'half' | 'full';

export interface BottomSheetProps {
  title?: string;
  detent?: BottomSheetDetent;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const detentHeight: Record<BottomSheetDetent, string> = {
  peek: '40%',
  half: '60%',
  full: '90%',
};

export function BottomSheet({ title, detent = 'half', children, footer }: BottomSheetProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Sheet'}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: detentHeight[detent],
        background: colors.surface.card,
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
        boxShadow: shadow.lg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 40,
          height: 4,
          borderRadius: 2,
          background: colors.border.default,
          margin: `${spacing[3]}px auto 0`,
        }}
      />
      {title && (
        <h2
          style={{
            margin: `${spacing[4]}px ${spacing[4]}px 0`,
            fontFamily: typography.fontFamily,
            fontSize: typography.fontSize.h2,
            fontWeight: typography.fontWeight.bold,
            color: colors.text.primary,
          }}
        >
          {title}
        </h2>
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: spacing[4] }}>{children}</div>
      {footer && (
        <footer
          style={{
            padding: spacing[4],
            borderTop: `1px solid ${colors.border.default}`,
          }}
        >
          {footer}
        </footer>
      )}
    </div>
  );
}
