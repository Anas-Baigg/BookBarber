'use client';

import { useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import NotificationBell from '@/components/admin/NotificationBell';
import { Menu } from 'lucide-react';

interface Props {
  userId: string | undefined;
  children: React.ReactNode;
}

export default function AdminShell({ userId, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-dark flex">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Dark overlay — mobile/tablet only, behind sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Right-hand content column — offset from sidebar on desktop */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 h-14 flex items-center justify-between px-4 sm:px-8 bg-dark border-b border-dark-300">
          {/* Hamburger — mobile/tablet only */}
          <button
            className="lg:hidden text-gray-400 hover:text-white transition-colors p-1 -ml-1"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          {/* Spacer so the bell stays on the right on desktop */}
          <div className="hidden lg:block" />
          {userId && <NotificationBell userId={userId} />}
        </header>
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
