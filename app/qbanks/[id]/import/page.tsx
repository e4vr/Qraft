import { ImportWorkspace } from '@/components/import-workspace';

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportWorkspace bankId={decodeURIComponent(id)} />;
}
