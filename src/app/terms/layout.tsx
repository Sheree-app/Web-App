import { LegalShell } from "@/components/legal/legal-shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <LegalShell>{children}</LegalShell>;
}
