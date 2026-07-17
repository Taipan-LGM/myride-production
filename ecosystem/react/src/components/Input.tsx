import React from 'react';
import { colors, radius, size, typography } from '../tokens';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, style, ...props }: InputProps) {
  const inputId = id ?? (label ? label.replace(/\s+/g, '-').toLowerCase() : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{
            fontSize: typography.fontSize.caption,
            color: colors.text.secondary,
            fontFamily: typography.fontFamily,
          }}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        style={{
          width: '100%',
          minHeight: size.inputHeight,
          padding: '0 16px',
          borderRadius: radius.pill,
          border: `1px solid ${error ? colors.border.error : colors.border.default}`,
          fontFamily: typography.fontFamily,
          fontSize: typography.fontSize.bodyLg,
          color: colors.text.primary,
          background: colors.surface.card,
          outline: 'none',
          ...style,
        }}
        onFocus={(e) => {
          if (!error) e.currentTarget.style.boxShadow = '0 0 0 3px rgba(13, 148, 136, 0.15)';
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = 'none';
          props.onBlur?.(e);
        }}
        {...props}
      />
      {hint && !error && (
        <span id={`${inputId}-hint`} style={{ fontSize: typography.fontSize.caption, color: colors.text.tertiary }}>
          {hint}
        </span>
      )}
      {error && (
        <span id={`${inputId}-error`} role="alert" style={{ fontSize: typography.fontSize.caption, color: colors.semantic.error }}>
          {error}
        </span>
      )}
    </div>
  );
}
