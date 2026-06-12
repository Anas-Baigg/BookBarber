'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { AlertTriangle, X, CheckCircle } from 'lucide-react';
import Button from '@/components/ui/Button';

export interface AffectedBooking {
  id:         string;
  start_time: string;
  end_time:   string;
  customer:   { full_name: string | null; email: string } | null;
}

export interface AvailableBarber {
  id:   string;
  name: string;
}

export type ResolutionAction = 'cancel' | 'offer_reschedule' | 'reassign';

export interface BookingResolution {
  bookingId:      string;
  action:         ResolutionAction;
  newEmployeeId?: string;
}

interface Props {
  title:             string;
  description?:      string;
  affectedBookings:  AffectedBooking[];
  availableBySlot:   Record<string, AvailableBarber[]>;
  timezone:          string;
  isSubmitting:      boolean;
  onSubmit:          (resolutions: BookingResolution[]) => void;
  onCancel:          () => void;
}

export default function BookingResolutionModal({
  title,
  description,
  affectedBookings,
  availableBySlot,
  timezone,
  isSubmitting,
  onSubmit,
  onCancel,
}: Props) {
  const [actions, setActions] = useState<Record<string, { action: ResolutionAction; newEmployeeId: string }>>(
    () => Object.fromEntries(
      affectedBookings.map((b) => [b.id, { action: 'cancel', newEmployeeId: '' }])
    )
  );
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  function setAction(bookingId: string, action: ResolutionAction) {
    setActions((prev) => ({ ...prev, [bookingId]: { ...prev[bookingId], action, newEmployeeId: '' } }));
    setValidationErrors((prev) => { const n = { ...prev }; delete n[bookingId]; return n; });
  }

  function setBarber(bookingId: string, newEmployeeId: string) {
    setActions((prev) => ({ ...prev, [bookingId]: { ...prev[bookingId], newEmployeeId } }));
    setValidationErrors((prev) => { const n = { ...prev }; delete n[bookingId]; return n; });
  }

  function handleSubmit() {
    const errors: Record<string, string> = {};
    for (const b of affectedBookings) {
      const a = actions[b.id];
      if (a.action === 'reassign' && !a.newEmployeeId) {
        errors[b.id] = 'Select a replacement barber';
      }
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    onSubmit(
      affectedBookings.map((b) => ({
        bookingId:     b.id,
        action:        actions[b.id].action,
        newEmployeeId: actions[b.id].newEmployeeId || undefined,
      }))
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-dark-100 border border-dark-300 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-dark-300">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0" />
              {title}
            </h2>
            {description && (
              <p className="text-sm text-gray-400 mt-1">{description}</p>
            )}
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors ml-4 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Booking list */}
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-400">
            {affectedBookings.length} booking{affectedBookings.length !== 1 ? 's' : ''} must be resolved before proceeding. Choose an action for each:
          </p>

          {affectedBookings.map((b) => {
            const state     = actions[b.id] ?? { action: 'cancel', newEmployeeId: '' };
            const available = availableBySlot[b.id] ?? [];
            const err       = validationErrors[b.id];

            return (
              <div key={b.id} className="p-3 bg-dark-200 rounded-xl border border-dark-400 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {b.customer?.full_name ?? 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{b.customer?.email}</div>
                    <div className="text-xs text-gold mt-0.5">
                      {format(toZonedTime(new Date(b.start_time), timezone), 'EEE, MMM d • h:mm a')}
                    </div>
                  </div>
                  <select
                    value={state.action}
                    onChange={(e) => setAction(b.id, e.target.value as ResolutionAction)}
                    className="px-2 py-1.5 text-xs rounded-lg bg-dark-300 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold flex-shrink-0"
                  >
                    <option value="cancel">Cancel</option>
                    <option value="offer_reschedule">Offer Reschedule</option>
                    {available.length > 0 && <option value="reassign">Reassign</option>}
                  </select>
                </div>

                {state.action === 'reassign' && (
                  <div className="space-y-1">
                    <select
                      value={state.newEmployeeId}
                      onChange={(e) => setBarber(b.id, e.target.value)}
                      className={`w-full px-2 py-1.5 text-xs rounded-lg bg-dark-300 border text-white focus:outline-none focus:ring-1 focus:ring-gold ${err ? 'border-red-500/60' : 'border-dark-400'}`}
                    >
                      <option value="">Select replacement barber…</option>
                      {available.map((av) => (
                        <option key={av.id} value={av.id}>{av.name}</option>
                      ))}
                    </select>
                    {err && <p className="text-xs text-red-400">{err}</p>}
                  </div>
                )}

                {state.action === 'offer_reschedule' && (
                  <p className="text-xs text-blue-400">Customer receives an email to pick a new time. Slot freed immediately.</p>
                )}
                {state.action === 'cancel' && (
                  <p className="text-xs text-red-400">Booking cancelled. Customer receives cancellation email.</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-dark-300">
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isSubmitting} className="flex-1 flex items-center justify-center gap-1.5">
            <CheckCircle className="w-4 h-4" />
            Resolve &amp; Proceed
          </Button>
        </div>
      </div>
    </div>
  );
}
