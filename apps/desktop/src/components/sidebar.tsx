import { Home, Settings,Zap } from "lucide-react";
import { type ReactNode,useEffect, useRef, useState } from "react";
import { Link, useLocation,useNavigate } from "react-router-dom";

import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  shortcut: string;
}

const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: <Home size={18} />, shortcut: "H" },
  { label: "Review", href: "/review", icon: <Zap size={18} />, shortcut: "R" },
  { label: "Settings", href: "/settings", icon: <Settings size={18} />, shortcut: "," },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide state
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  // Find current page label
  const currentPage =
    navItems.find((item) => isActive(item.href))?.label ?? "";

  // Global "g then <key>" navigation (Linear-style)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!pendingG.current) {
          pendingG.current = true;
          if (gTimer.current) clearTimeout(gTimer.current);
          gTimer.current = setTimeout(() => {
            pendingG.current = false;
          }, 500);
          return;
        }
      }

      if (pendingG.current) {
        pendingG.current = false;
        if (gTimer.current) clearTimeout(gTimer.current);

        const key = e.key.toLowerCase();
        const match = navItems.find(
          (item) => item.shortcut.toLowerCase() === key
        );
        if (match) {
          e.preventDefault();
          navigate(match.href);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  // Show nav when mouse is near the top of the window
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (e.clientY < 50) {
        setVisible(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setVisible(false), 2000);
      }
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Start hide timer on initial mount (hide after 2s if user doesn't hover)
  useEffect(() => {
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(hideTimer.current);
  }, []);

  const handleMouseEnter = () => {
    clearTimeout(hideTimer.current);
    setVisible(true);
  };

  const handleMouseLeave = () => {
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`no-drag fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[#1a1a1a] bg-[#0a0a0a]/90 px-4 py-2 shadow-xl backdrop-blur-md transition-all duration-300 ease-in-out ${
          visible
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
        }`}
      >
        {/* App icon */}
        <span className="mr-2 text-base font-bold text-amber-400">
          {"\u25C8"}
        </span>

        {/* Separator */}
        <Separator orientation="vertical" className="mx-1 h-5 bg-[#1a1a1a]" />

        {/* Nav items */}
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  to={item.href}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-[18px] transition-colors duration-200 ${
                    active
                      ? "bg-amber-500/15 text-amber-400"
                      : "text-slate-500 hover:bg-[#1a1a1a] hover:text-slate-200"
                  }`}
                >
                  {item.icon}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px]">
                {item.label}
                <span className="ml-1.5 font-mono text-slate-500">
                  g {item.shortcut.toLowerCase()}
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Separator */}
        <Separator orientation="vertical" className="mx-1 h-5 bg-[#1a1a1a]" />

        {/* Current page name — hidden at very narrow widths */}
        <span className="ml-1 text-[11px] font-medium text-slate-500 hidden sm:inline">
          {currentPage}
        </span>
      </nav>
    </TooltipProvider>
  );
}
