import { cn } from '@/lib/utils';
import type { BookingStatus } from '@/types';

interface BadgeProps {
  status: BookingStatus;
  className?: string;
}

const statusConfig: Record<BookingStatus, { label: string; classes: string }> = {
  confirmed: {
    label: 'Confirmed',
    classes: 'bg-green-500/10 text-green-400 border-green-500/20',
  },
  cancelled: {
    label: 'Cancelled',
    classes: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
  rescheduled: {
    label: 'Rescheduled',
    classes: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  pending_reschedule: {
    label: 'Action Required',
    classes: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  },
  checked_in: {
    label: 'Checked In',
    classes: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  },
  completed: {
    label: 'Completed',
    classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  no_show: {
    label: 'No Show',
    classes: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  },
};

export default function Badge({ status, className }: BadgeProps) {
  const config = statusConfig[status] ?? { label: status, classes: 'bg-gray-500/10 text-gray-400 border-gray-500/20' };
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
        config.classes,
        className
      )}
    >
      {config.label}
    </span>
  );
}
