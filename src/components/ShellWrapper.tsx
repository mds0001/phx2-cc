"use client";

import { usePathname } from "next/navigation";
import GlobalShell from "./GlobalShell";

export default function ShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuth = pathname === "/login";

  return (
    <>
      <div className={isAuth ? "" : "pl-[220px] pb-[44px]"}>
        {children}
      </div>
      {!isAuth && <GlobalShell />}
    </>
  );
}
