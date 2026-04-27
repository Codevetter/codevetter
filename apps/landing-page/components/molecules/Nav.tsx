"use client";

import { Button } from "@/components/atoms/Button";
import { ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

const links = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#providers", label: "Providers" },
  { href: "#pricing", label: "Pricing" },
];

export function Nav() {
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-[--color-bg]/70 border-b border-[--color-line]"
    >
      <div className="max-w-7xl mx-auto h-16 px-6 flex items-center justify-between">
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="relative">
            <ShieldCheck className="w-5 h-5 text-[--color-accent]" strokeWidth={1.5} />
            <span className="absolute -inset-1 rounded-full bg-[--color-accent]/20 blur-md opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <span className="font-mono text-[13px] tracking-[0.22em] uppercase font-semibold">
            CodeVetter
            <span className="text-[--color-text-mute]">_v2</span>
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-[--color-text-dim] hover:text-[--color-text] transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Button variant="ghost" href="https://github.com/sarthakagrawal927/CodeVetter" className="hidden sm:inline-flex">
            GitHub
          </Button>
          <Button variant="primary" href="#download">
            Download
          </Button>
        </div>
      </div>
    </motion.header>
  );
}
