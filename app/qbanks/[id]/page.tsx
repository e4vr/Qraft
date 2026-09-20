import { QraftRoute } from '@/app/qraft-route';
export default async function QBankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QraftRoute view="library" qbankId={decodeURIComponent(id)} />;
}

