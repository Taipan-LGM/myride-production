import React from 'react';
import { colors, radius, spacing, typography } from '../tokens';

export interface VehicleOptionProps {
  name: string;
  fareRange: string;
  icon: React.ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}

export function VehicleOption({ name, fareRange, icon, selected = false, onSelect }: VehicleOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: spacing[2],
        minWidth: 100,
        minHeight: 88,
        padding: spacing[3],
        borderRadius: radius.md,
        border: `2px solid ${selected ? colors.brand.primary : colors.border.default}`,
        background: selected ? colors.brand.primaryLight : colors.surface.card,
        cursor: 'pointer',
        fontFamily: typography.fontFamily,
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span
        style={{
          fontSize: typography.fontSize.caption,
          fontWeight: typography.fontWeight.semibold,
          color: colors.text.primary,
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontSize: typography.fontSize.overline,
          color: selected ? colors.brand.primary : colors.text.secondary,
        }}
      >
        {fareRange}
      </span>
    </button>
  );
}
