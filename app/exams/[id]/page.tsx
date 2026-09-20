import { QraftRoute } from '@/app/qraft-route';
export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QraftRoute view="test" testId={id === 'active' ? undefined : decodeURIComponent(id)} />;
}

