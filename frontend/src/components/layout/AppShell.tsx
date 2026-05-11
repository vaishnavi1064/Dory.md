import { type ReactNode, useRef } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { DiscoveryCard } from '@/components/discovery/DiscoveryCard';
import { useDiscoveryPolling } from '@/lib/useDiscoveryPolling';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { discovery, dismiss } = useDiscoveryPolling();
  const discoveryRef = useRef<HTMLDivElement>(null);

  function scrollToDiscovery() {
    discoveryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--text-1)]">
      <Header hasDiscovery={discovery !== null} onDiscoveryClick={scrollToDiscovery} />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto">
          {discovery && (
            <div ref={discoveryRef} className="px-4 pt-4 md:px-6">
              <DiscoveryCard discovery={discovery} onDismiss={dismiss} />
            </div>
          )}
          <div className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-6 md:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
