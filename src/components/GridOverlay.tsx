import type { ReactNode } from 'react';

interface GridOverlayProps {
  divisions: number;
}

export function GridOverlay({ divisions }: GridOverlayProps) {
  const lines: ReactNode[] = [];

  for (let i = 1; i < divisions; i++) {
    const pct = (i / divisions) * 100;
    lines.push(
      <div
        key={`v-${i}`}
        className="grid-line vertical"
        style={{ left: `${pct}%` }}
      />,
      <div
        key={`h-${i}`}
        className="grid-line horizontal"
        style={{ top: `${pct}%` }}
      />
    );
  }

  const cells: ReactNode[] = [];
  for (let row = 0; row < divisions; row++) {
    for (let col = 0; col < divisions; col++) {
      cells.push(
        <div
          key={`cell-${row}-${col}`}
          className="grid-cell"
          style={{
            left: `${(col / divisions) * 100}%`,
            top: `${(row / divisions) * 100}%`,
            width: `${100 / divisions}%`,
            height: `${100 / divisions}%`,
          }}
        />
      );
    }
  }

  return (
    <div className="grid-overlay">
      {lines}
      {cells}
    </div>
  );
}
