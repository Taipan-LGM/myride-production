import React from 'react';
import { colors, radius, size, typography } from '../tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'driverAccept';
export type ButtonSize = 'lg' | 'sm';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: `linear-gradient(135deg, ${colors.brand.primary}, ${colors.brand.primaryDark})`,
    color: colors.text.onBrand,
    border: 'none',
  },
  secondary: {
    background: colors.surface.card,
    color: colors.text.primary,
    border: `1px solid ${colors.border.default}`,
  },
  destructive: {
    background: colors.semantic.error,
    color: colors.text.onBrand,
    border: 'none',
  },
  driverAccept: {
    background: `linear-gradient(90deg, ${colors.semantic.success}, #059669)`,
    color: colors.text.onBrand,
    border: 'none',
  },
};

export function Button({
  variant = 'primary',
  size: buttonSize = 'lg',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  style,
  ...props
}: ButtonProps) {
  const height = buttonSize === 'lg' ? size.buttonHeight : size.buttonHeightSm;
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: height,
        minWidth: size.touchMin,
        width: fullWidth ? '100%' : undefined,
        padding: `0 ${spacing6()}`,
        borderRadius: radius.pill,
        fontFamily: typography.fontFamily,
        fontSize: buttonSize === 'lg' ? typography.fontSize.h3 : typography.fontSize.bodyLg,
        fontWeight: typography.fontWeight.semibold,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.4 : 1,
        transition: 'opacity 150ms ease',
        ...variantStyles[variant],
        ...style,
      }}
      {...props}
    >
      {loading ? 'Loading…' : children}
    </button>
  );
}

function spacing6() {
  return '24px';
}
