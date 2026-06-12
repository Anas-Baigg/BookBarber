'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Store,
  Tag,
  Users,
  CalendarRange,
  Scissors,
  LogOut,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

const navItems = [
  { href: '/admin',          label: 'Overview',  icon: LayoutDashboard, exact: true },
  { href: '/admin/shops',    label: 'Shops',     icon: Store },
  { href: '/admin/services', label: 'Services',  icon: Tag },
  { href: '/admin/employees',label: 'Employees', icon: Users },
  { href: '/admin/bookings', label: 'Bookings',  icon: CalendarRange },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminSidebar({ isOpen, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    onClose();
    router.push('/');
    router.refresh();
  }

  return (
    <aside
      className={cn(
        // Base: fixed drawer, always present in the DOM
        'fixed left-0 top-0 h-full w-64 bg-dark-100 border-r border-dark-300 flex flex-col z-50',
        // Smooth slide animation
        'transition-transform duration-300 ease-in-out',
        // Mobile/tablet: hidden by default, shown when isOpen
        // Desktop (lg+): always visible regardless of isOpen
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}
    >
      {/* Logo */}
      <div className="p-6 border-b border-dark-300">
        <Link href="/admin" className="flex items-center gap-2" onClick={onClose}>
          <div className="w-8 h-8 rounded-lg bg-gradient-gold flex items-center justify-center">
            <Scissors className="w-4 h-4 text-dark" />
          </div>
          <div>
            <div className="font-bold text-sm">
              Book<span className="text-gradient-gold">Barber</span>
            </div>
            <div className="text-xs text-gray-500">Admin Panel</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-gold-muted text-gold border border-gold/20'
                  : 'text-gray-400 hover:text-white hover:bg-dark-200'
              )}
            >
              <item.icon className={cn('w-4 h-4', active ? 'text-gold' : 'text-gray-500')} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="p-4 border-t border-dark-300">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all w-full"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
