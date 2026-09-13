import { Dashboard } from '@/components/Dashboard';
import { initialDashboard } from '@/lib/server/dashboard';

export default function Page() {
  return <Dashboard initial={initialDashboard()}/>;
}
