import type { ReactNode } from "react";
import AddonsHost from "@/components/addons/AddonsHost";

// Next.js wraps every page with this file automatically, so layout.tsx and page.tsx stay untouched.
export default function Template({ children }: { children: ReactNode }) {
  return (<>{children}<AddonsHost /></>);
}
