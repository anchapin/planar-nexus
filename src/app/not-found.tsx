import { Button } from '@/components/ui/button';
import { Compass } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-md text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-primary/10 p-4">
            <Compass className="size-12 text-primary" aria-hidden="true" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="font-headline text-2xl font-bold text-foreground">
            Planeswalker Lost
          </h1>
          <p className="text-muted-foreground">
            The path you seek does not exist in this plane. Return to familiar territory.
          </p>
        </div>
        <div className="flex justify-center">
          <Button asChild>
            <Link href="/dashboard">Return to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
