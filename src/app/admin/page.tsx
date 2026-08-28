import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/adminSession';
import AdminDashboard from './AdminDashboard';

export default async function AdminPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/admin/login');

  return <AdminDashboard />;
}
