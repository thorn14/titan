import { type ReactNode, useState, useRef, useCallback, useEffect } from "react";

interface LayoutProps {
  sidebar: ReactNode;
  centerContent: ReactNode;
  terminal: ReactNode;
  showTerminal: boolean;
}

const MIN_LEFT = 180;
const MIN_CENTER = 220;
const MIN_RIGHT = 300;

export default function Layout({
  sidebar,
  centerContent,
  terminal,
  showTerminal,
}: LayoutProps) {
  const [leftWidth, setLeftWidth] = useState(240);
  const [centerWidth, setCenterWidth] = useState(300);
  const dragging = useRef<"left" | "right" | null>(null);
  const startX = useRef(0);
  const startLeft = useRef(0);
  const startCenter = useRef(0);

  const onMouseDown = useCallback(
    (handle: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = handle;
      startX.current = e.clientX;
      startLeft.current = leftWidth;
      startCenter.current = centerWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [leftWidth, centerWidth],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;

      if (dragging.current === "left") {
        const newLeft = Math.max(MIN_LEFT, startLeft.current + dx);
        setLeftWidth(newLeft);
      } else {
        const newCenter = Math.max(MIN_CENTER, startCenter.current + dx);
        setCenterWidth(newCenter);
      }
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div className="layout">
      <div className="panel panel-left" style={{ width: leftWidth }}>
        {sidebar}
      </div>
      <div
        className="resize-handle"
        onMouseDown={onMouseDown("left")}
        role="separator"
      />
      <div
        className="panel panel-center"
        style={{
          width: showTerminal ? centerWidth : undefined,
          flex: showTerminal ? undefined : 1,
        }}
      >
        {centerContent}
      </div>
      {/* Always render terminal + resize handle to preserve PTY state */}
      <div
        className="resize-handle"
        onMouseDown={onMouseDown("right")}
        role="separator"
        style={{ display: showTerminal ? undefined : "none" }}
      />
      <div
        className="panel panel-right"
        style={{
          minWidth: showTerminal ? MIN_RIGHT : 0,
          display: showTerminal ? undefined : "none",
        }}
      >
        {terminal}
      </div>
    </div>
  );
}
