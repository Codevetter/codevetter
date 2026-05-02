"use client";

import { motion } from "framer-motion";
import { SearchCode } from "lucide-react";

import { Button } from "@/components/atoms/Button";

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
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-6 inset-x-0 z-50 flex justify-center px-6 pointer-events-none"
    >
      <div className="flex items-center justify-between w-full max-w-5xl h-14 px-5 rounded-full border border-white/10 bg-[#0A0A0A]/60 backdrop-blur-xl shadow-2xl pointer-events-auto">
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20">
            <SearchCode className="w-4 h-4 text-blue-400" strokeWidth={2} />
            <span className="absolute inset-0 rounded-full bg-blue-400/20 blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <span className="font-display text-sm font-bold tracking-tight text-white">
            CodeVetter
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-xs font-medium text-gray-400 hover:text-white transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="ghost" href="https://github.com/sarthakagrawal927/CodeVetter" className="hidden sm:inline-flex h-9 px-4 text-xs">
            GitHub
          </Button>
          <Button variant="primary" href="#download" className="h-9 px-5 text-xs">
            Download
          </Button>
        </div>
      </div>
    </motion.header>
  );
}