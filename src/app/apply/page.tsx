import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import ApplyForm from './ApplyForm';

export default async function ApplyPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  return (
    <Suspense fallback={null}>
      <ApplyForm />
    </Suspense>
  );
}
