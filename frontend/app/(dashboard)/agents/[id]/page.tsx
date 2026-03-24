import { redirect } from 'next/navigation';

export default async function AgentRootPage({ params }: { params: Promise<{ id: string }> }) {
  const resolved = await params;
  redirect(`/agents/${encodeURIComponent(resolved.id)}/brainstorm`);
}

