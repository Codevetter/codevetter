import { useEffect,useRef, useState } from "react";

type CursorMode = "default" | "action" | "text";

const ACTION_SELECTOR = [
  "a",
  "button",
  "[role='button']",
  "[role='menuitem']",
  "[data-cursor='action']",
].join(",");

const TEXT_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[data-cursor='text']",
].join(",");

function getCursorMode(target: EventTarget | null): CursorMode {
  if (!(target instanceof Element)) return "default";
  if (target.closest(TEXT_SELECTOR)) return "text";
  if (target.closest(ACTION_SELECTOR)) return "action";
  return "default";
}

export default function FancyCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<CursorMode>("default");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let frame = 0;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;

    document.body.classList.add("cv-fancy-cursor-enabled");

    const render = () => {
      cursorRef.current?.style.setProperty("--cursor-x", `${x}px`);
      cursorRef.current?.style.setProperty("--cursor-y", `${y}px`);
      frame = 0;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      x = event.clientX;
      y = event.clientY;
      setVisible(true);
      setMode(getCursorMode(event.target));
      if (frame === 0) frame = window.requestAnimationFrame(render);
    };

    const handlePointerLeave = () => setVisible(false);
    const handlePointerDown = () => {
      document.body.classList.add("cv-fancy-cursor-pressed");
    };
    const handlePointerUp = () => {
      document.body.classList.remove("cv-fancy-cursor-pressed");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      document.body.classList.remove(
        "cv-fancy-cursor-enabled",
        "cv-fancy-cursor-pressed",
      );
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="cv-fancy-cursor"
      data-mode={mode}
      data-visible={visible}
    />
  );
}
