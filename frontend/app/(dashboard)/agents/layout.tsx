import { AgentsShell } from '@/components/agents-shell';

export default function AgentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AgentsShell>{children}</AgentsShell>;
}

