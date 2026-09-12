import { useRef } from 'react';
import { useUI } from '@/lib/ui-store';

export function InspectorResize() {
  const width = useUI((state) => state.inspectorWidth);
  const setWidth = useUI((state) => state.setInspectorWidth);
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="inspector-resize"
      role="separator"
      aria-label="Ayrıntı panelinin genişliği"
      aria-orientation="vertical"
      aria-valuemin={320}
      aria-valuemax={600}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Paneli boyutlandırmak için sürükle veya ok tuşlarını kullan"
      onPointerDown={(event) => {
        start.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (start.current) setWidth(start.current.width + start.current.x - event.clientX);
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onDoubleClick={() => setWidth(380)}
      onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          setWidth(
            event.key === 'Home'
              ? 320
              : event.key === 'End'
                ? 600
                : width + (event.key === 'ArrowLeft' ? 20 : -20),
          );
        }
      }}
    />
  );
}
