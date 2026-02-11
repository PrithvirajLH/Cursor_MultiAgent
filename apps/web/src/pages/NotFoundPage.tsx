import { useNavigate } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-12 animate-fade-in">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you're looking for doesn't exist or has been moved."
        primaryAction={{ label: 'Go to Dashboard', onClick: () => navigate('/dashboard') }}
      />
    </section>
  );
}
