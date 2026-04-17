"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check } from "lucide-react";

export interface CustomerOption {
  id: string;
  name: string;
  company: string | null;
}

interface Props {
  customers: CustomerOption[];
  activeCustomerId: string | null;
}

export default function CustomerSwitcher({ customers, activeCustomerId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = customers.find((c) => c.id === activeCustomerId) ?? null;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function switchCustomer(id: string | null) {
    setOpen(false);
    if (id) {
      document.cookie = `active_customer_id=${id};path=/;max-age=${60 * 60 * 24 * 30};samesite=lax`;
    } else {
      document.cookie = "active_customer_id=;path=/;max-age=0";
    }
    // Full reload bypasses the Next.js Router Cache so the server
    // re-fetches with the updated cookie on every switch.
    window.location.reload();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-cyan-500/40 rounded-xl px-3 py-2 transition-all"
      >
        <Building2 className="w-4 h-4 text-cyan-400 shrink-0" />
        <span className="text-sm font-medium text-white max-w-[160px] truncate">
          {active ? (active.company || active.name) : "All Customers"}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="p-1">
            {/* All Customers option */}
            <button
              onClick={() => switchCustomer(null)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800 transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-lg bg-gray-700 flex items-center justify-center shrink-0">
                <Building2 className="w-3.5 h-3.5 text-gray-400" />
              </div>
              <span className="text-sm text-gray-300 flex-1">All Customers</span>
              {!activeCustomerId && <Check className="w-3.5 h-3.5 text-cyan-400" />}
            </button>

            {customers.length > 0 && (
              <div className="my-1 border-t border-gray-800" />
            )}

            {customers.map((c) => {
              const isActive = c.id === activeCustomerId;
              const initials = (c.company || c.name)
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase();
              return (
                <button
                  key={c.id}
                  onClick={() => switchCustomer(c.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800 transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-cyan-400">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{c.company || c.name}</p>
                    {c.company && <p className="text-[11px] text-gray-500 truncate">{c.name}</p>}
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
