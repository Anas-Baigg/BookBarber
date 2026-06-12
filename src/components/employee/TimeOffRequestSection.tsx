'use client';

import { useState, useEffect } from 'react';
import { format, addDays } from 'date-fns';
import type { TimeOffRequest } from '@/types';
import { Calendar, Plus, X, Clock } from 'lucide-react';
import Button from '@/components/ui/Button';

const STATUS_STYLES: Record<TimeOffRequest['status'], string> = {
  pending:  'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  approved: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  denied:   'bg-red-500/10 text-red-400 border border-red-500/20',
};

interface Props {
  initialRequests: TimeOffRequest[];
}

export default function TimeOffRequestSection({ initialRequests }: Props) {
  const [requests, setRequests]     = useState<TimeOffRequest[]>(initialRequests);
  const [showModal, setShowModal]   = useState(false);
  const [date, setDate]             = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [reason, setReason]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res = await fetch('/api/employee/time-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, reason }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Failed to submit request');
    } else {
      setRequests((prev) => [...prev, data].sort((a, b) => a.date.localeCompare(b.date)));
      setShowModal(false);
      setReason('');
      setDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    }
    setSubmitting(false);
  }

  async function handleWithdraw(id: string) {
    setWithdrawing(id);
    const res = await fetch('/api/employee/time-off', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setRequests((prev) => prev.filter((r) => r.id !== id));
    }
    setWithdrawing(null);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-gold" />
          My Time Off Requests
          {requests.filter((r) => r.status === 'pending').length > 0 && (
            <span className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded-full">
              {requests.filter((r) => r.status === 'pending').length} pending
            </span>
          )}
        </h3>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1 text-xs text-gold hover:text-gold-light transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Request Time Off
        </button>
      </div>

      {requests.length === 0 ? (
        <p className="text-xs text-gray-600 py-2">No requests yet.</p>
      ) : (
        <div className="space-y-1.5">
          {requests.map((r) => (
            <div key={r.id} className="flex items-start justify-between py-2 px-3 rounded-lg bg-dark-200 gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {format(new Date(r.date + 'T12:00:00'), 'EEE, MMM d')}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_STYLES[r.status]}`}>
                    {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5 truncate">{r.reason}</div>
                {r.admin_notes && (
                  <div className="text-xs text-gray-500 mt-0.5">Note: {r.admin_notes}</div>
                )}
              </div>
              {r.status === 'pending' && (
                <button
                  onClick={() => handleWithdraw(r.id)}
                  disabled={withdrawing === r.id}
                  className="text-xs text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 disabled:opacity-50"
                >
                  {withdrawing === r.id ? '…' : 'Withdraw'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Request modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-dark-100 border border-dark-300 rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-dark-300">
              <h3 className="font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gold" />
                Request Time Off
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-gray-300 font-medium">Date</label>
                <input
                  type="date"
                  value={date}
                  min={format(addDays(new Date(), 1), 'yyyy-MM-dd')}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-gray-300 font-medium">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why do you need time off?"
                  rows={3}
                  required
                  className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gold resize-none"
                />
              </div>
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <Button type="submit" loading={submitting} className="flex-1">
                  Submit Request
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
