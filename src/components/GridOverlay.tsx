interface GridOverlayProps {
  columns: number;
  rows: number;
  visible: boolean;
}

export function GridOverlay({ columns, rows, visible }: GridOverlayProps) {
  if (!visible) return null;

  const colLines = Array.from({ length: columns - 1 }, (_, i) => (i + 1) / columns);
  const rowLines = Array.from({ length: rows - 1 }, (_, i) => (i + 1) / rows);

  return (
    <div className="grid-overlay" aria-hidden>
      {colLines.map((pos) => (
        <div
          key={`col-${pos}`}
          className="grid-line vertical"
          style={{ left: `${pos * 100}%` }}
        />
      ))}
      {rowLines.map((pos) => (
        <div
          key={`row-${pos}`}
          className="grid-line horizontal"
          style={{ top: `${pos * 100}%` }}
        />
      ))}
    </div>
  );
}
