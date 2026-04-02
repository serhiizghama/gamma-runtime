import { useCallback, useRef } from 'react';

interface Props {
  onResize: (delta: number) => void;
}

export function ResizeHandle({ onResize }: Props) {
  const startX = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX.current;
        startX.current = ev.clientX;
        onResize(delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onResize],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
    >
      <div className="h-8 w-0.5 rounded-full bg-gray-700 transition-colors group-hover:bg-gray-500 group-active:bg-blue-500" />
    </div>
  );
}
