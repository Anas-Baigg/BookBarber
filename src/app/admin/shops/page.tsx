'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import { slugify, getDayName } from '@/lib/utils';
import type { Shop, ShopSpecialHours } from '@/types';
import {
  Plus,
  Store,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  ChevronUp,
  Globe,
  Clock,
  Pencil,
  X,
} from 'lucide-react';
import BookingResolutionModal, {
  type AffectedBooking,
  type AvailableBarber,
  type BookingResolution,
} from '@/components/admin/BookingResolutionModal';
import type { UnavailabilityAction } from '@/types';

const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto',
  'Europe/Dublin', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore',
  'Australia/Sydney',
];

interface ShopForm {
  name: string;
  address: string;
  timezone: string;
  default_open_time: string;
  default_close_time: string;
}

const defaultForm: ShopForm = {
  name: '',
  address: '',
  timezone: 'UTC',
  default_open_time: '09:00',
  default_close_time: '18:00',
};

// ── Per-shop card component ───────────────────────────────────────────────────
// Owns: edit form, special hours form, special hours list, conflict resolution.
// This prevents form state from leaking across cards (Fix 4).

interface ShopCardProps {
  shop:       Shop;
  isExpanded: boolean;
  isCopied:   boolean;
  isDeleting: boolean;
  onToggleExpand: () => void;
  onCopyLink:     () => void;
  onDelete:       () => void;
  onUpdated:      (updated: Shop) => void;
}

function ShopCard({
  shop, isExpanded, isCopied, isDeleting,
  onToggleExpand, onCopyLink, onDelete, onUpdated,
}: ShopCardProps) {
  // Edit form state
  const [editing, setEditing]         = useState(false);
  const [editForm, setEditForm]       = useState<ShopForm>(defaultForm);
  const [savingEdit, setSavingEdit]   = useState(false);
  const [editError, setEditError]     = useState('');

  // Special hours form state (scoped to this card — Fix 4)
  const [shDate, setShDate]       = useState('');
  const [shOpen, setShOpen]       = useState('');
  const [shClose, setShClose]     = useState('');
  const [shClosed, setShClosed]   = useState(false);
  const [savingSpecial, setSavingSpecial] = useState(false);

  // Special hours list (Fix 3)
  const [specialHours, setSpecialHours]       = useState<ShopSpecialHours[]>([]);
  const [loadingHours, setLoadingHours]       = useState(false);
  const [deletingDate, setDeletingDate]       = useState<string | null>(null);

  // Booking Settings
  const [slotIntervalDraft, setSlotIntervalDraft] = useState('15');
  const [bufferDraft, setBufferDraft]             = useState('5');
  const [configSaving, setConfigSaving]           = useState(false);
  const [savedInterval, setSavedInterval]         = useState(15);
  const [savedBuffer, setSavedBuffer]             = useState(5);

  // Conflict resolution for closures AND reduced hours (Fix 5)
  const [conflict, setConflict] = useState<{
    date:             string;
    isClosed:         boolean;
    openTime:         string | null;
    closeTime:        string | null;
    affectedBookings: AffectedBooking[];
    availableBySlot:  Record<string, AvailableBarber[]>;
    isSubmitting:     boolean;
  } | null>(null);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const today  = new Date().toISOString().slice(0, 10);

  // Load special hours and booking config when card expands
  useEffect(() => {
    if (!isExpanded) return;
    setLoadingHours(true);
    fetch(`/api/admin/shops/${shop.id}/special-hours`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setSpecialHours(data ?? []))
      .catch(() => setSpecialHours([]))
      .finally(() => setLoadingHours(false));

    fetch(`/api/admin/shops/${shop.id}/config`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { slot_interval_minutes: number; buffer_minutes: number } | null) => {
        if (data) {
          setSlotIntervalDraft(String(data.slot_interval_minutes));
          setBufferDraft(String(data.buffer_minutes));
          setSavedInterval(data.slot_interval_minutes);
          setSavedBuffer(data.buffer_minutes);
        }
      })
      .catch(() => {});
  }, [isExpanded, shop.id]);

  // Reset form when card collapses (Fix 4)
  useEffect(() => {
    if (!isExpanded) {
      setShDate(''); setShOpen(''); setShClose(''); setShClosed(false);
    }
  }, [isExpanded]);

  function startEdit() {
    setEditing(true);
    setEditError('');
    setEditForm({
      name:               shop.name,
      address:            shop.address ?? '',
      timezone:           shop.timezone,
      default_open_time:  shop.default_open_time,
      default_close_time: shop.default_close_time,
    });
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setSavingEdit(true);
    setEditError('');
    const supabase = createClient();
    const { error: err } = await supabase
      .from('shops')
      .update({
        name:               editForm.name,
        address:            editForm.address || null,
        timezone:           editForm.timezone,
        default_open_time:  editForm.default_open_time,
        default_close_time: editForm.default_close_time,
      })
      .eq('id', shop.id);
    if (err) {
      setEditError(err.message);
    } else {
      onUpdated({ ...shop, ...editForm, address: editForm.address || null });
      setEditing(false);
    }
    setSavingEdit(false);
  }

  async function handleAddSpecialHours(e: React.FormEvent) {
    e.preventDefault();
    setSavingSpecial(true);

    const res = await fetch(`/api/admin/shops/${shop.id}/special-hours`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date:      shDate,
        openTime:  shClosed ? null : shOpen  || null,
        closeTime: shClosed ? null : shClose || null,
        isClosed:  shClosed,
      }),
    });

    if (res.status === 409) {
      const { affectedBookings, availableBySlot } = await res.json();
      setConflict({
        date:     shDate,
        isClosed: shClosed,
        openTime: shClosed ? null : shOpen  || null,
        closeTime: shClosed ? null : shClose || null,
        affectedBookings,
        availableBySlot,
        isSubmitting: false,
      });
    } else if (res.ok) {
      setShDate(''); setShOpen(''); setShClose(''); setShClosed(false);
      // Refresh list
      const listRes = await fetch(`/api/admin/shops/${shop.id}/special-hours`);
      if (listRes.ok) setSpecialHours(await listRes.json());
    }
    setSavingSpecial(false);
  }

  async function handleConflictResolved(resolutions: BookingResolution[]) {
    if (!conflict) return;
    setConflict((prev) => prev ? { ...prev, isSubmitting: true } : null);

    const res = await fetch(`/api/admin/shops/${shop.id}/special-hours`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date:      conflict.date,
        isClosed:  conflict.isClosed,
        openTime:  conflict.openTime,
        closeTime: conflict.closeTime,
        actions:   resolutions.map((r): UnavailabilityAction => ({
          bookingId:     r.bookingId,
          action:        r.action,
          newEmployeeId: r.newEmployeeId,
        })),
      }),
    });

    if (res.ok) {
      setConflict(null);
      setShDate(''); setShOpen(''); setShClose(''); setShClosed(false);
      // Refresh list
      const listRes = await fetch(`/api/admin/shops/${shop.id}/special-hours`);
      if (listRes.ok) setSpecialHours(await listRes.json());
    } else {
      setConflict((prev) => prev ? { ...prev, isSubmitting: false } : null);
    }
  }

  async function handleSaveConfig() {
    setConfigSaving(true);
    const res = await fetch(`/api/admin/shops/${shop.id}/config`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot_interval_minutes: parseInt(slotIntervalDraft, 10),
        buffer_minutes:        parseInt(bufferDraft, 10),
      }),
    });
    if (res.ok) {
      setSavedInterval(parseInt(slotIntervalDraft, 10));
      setSavedBuffer(parseInt(bufferDraft, 10));
    }
    setConfigSaving(false);
  }

  async function handleDeleteSpecialHours(date: string) {
    setDeletingDate(date);
    const res = await fetch(`/api/admin/shops/${shop.id}/special-hours`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    });
    if (res.ok) {
      setSpecialHours((prev) => prev.filter((h) => h.date !== date));
    }
    setDeletingDate(null);
  }

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-gold flex items-center justify-center flex-shrink-0">
              <Store className="w-5 h-5 text-dark" />
            </div>
            <div>
              <h3 className="font-semibold">{shop.name}</h3>
              {shop.address && <p className="text-sm text-gray-400">{shop.address}</p>}
              <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {shop.timezone}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {shop.default_open_time} — {shop.default_close_time}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onCopyLink}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dark-400 hover:border-gold text-gray-400 hover:text-gold transition-all"
              title="Copy booking link"
            >
              {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {isCopied ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              onClick={() => editing ? setEditing(false) : startEdit()}
              className="text-xs px-2 py-1.5 rounded-lg border border-dark-400 hover:border-gold text-gray-400 hover:text-gold transition-all"
              title="Edit shop settings"
            >
              {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onToggleExpand}
              className="text-xs px-3 py-1.5 rounded-lg border border-dark-400 hover:border-dark-500 text-gray-400 hover:text-white transition-all"
            >
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="text-xs px-2 py-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting
                ? <div className="w-3.5 h-3.5 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Booking URL */}
        <div className="mt-4 flex items-center gap-2 p-3 bg-dark-200 rounded-lg border border-dark-400">
          <span className="text-xs text-gray-500 flex-shrink-0">Booking URL:</span>
          <code className="text-xs text-gold flex-1 truncate">{appUrl}/shop/{shop.slug}</code>
        </div>

        {/* Edit shop settings */}
        {editing && (
          <div className="mt-4 pt-4 border-t border-dark-300">
            <h4 className="text-sm font-semibold mb-3">Edit Shop Settings</h4>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Shop name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
                <Input label="Address" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="123 Main St, City" />
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-300">Timezone</label>
                  <select value={editForm.timezone} onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })} className="w-full px-4 py-2.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold">
                    {TIMEZONES.map((tz) => <option key={tz} value={tz} className="bg-dark-200">{tz}</option>)}
                  </select>
                </div>
                <Input label="Default open time" type="time" value={editForm.default_open_time} onChange={(e) => setEditForm({ ...editForm, default_open_time: e.target.value })} />
                <Input label="Default close time" type="time" value={editForm.default_close_time} onChange={(e) => setEditForm({ ...editForm, default_close_time: e.target.value })} />
              </div>
              {editError && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{editError}</div>}
              <div className="flex gap-3">
                <Button type="submit" loading={savingEdit} size="sm">Save Changes</Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)} type="button">Cancel</Button>
              </div>
            </form>
          </div>
        )}

        {/* Expanded: Special hours */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-dark-300">
            <h4 className="text-sm font-semibold mb-3">Special / Holiday Hours</h4>

            {/* Existing entries list (Fix 3) */}
            {loadingHours ? (
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-4">
                <div className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                Loading…
              </div>
            ) : specialHours.length > 0 ? (
              <div className="mb-5 rounded-lg border border-dark-400 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-dark-200 border-b border-dark-400">
                      <th className="text-left text-xs text-gray-500 font-medium px-3 py-2">Date</th>
                      <th className="text-left text-xs text-gray-500 font-medium px-3 py-2">Type</th>
                      <th className="text-left text-xs text-gray-500 font-medium px-3 py-2">Hours</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-400">
                    {specialHours.map((h) => {
                      const isPast = h.date < today;
                      return (
                        <tr key={h.date} className={isPast ? 'opacity-40' : ''}>
                          <td className="px-3 py-2 text-xs font-mono">{h.date}</td>
                          <td className="px-3 py-2 text-xs">
                            {h.is_closed
                              ? <span className="text-red-400">Closed</span>
                              : <span className="text-amber-400">Custom Hours</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-400">
                            {!h.is_closed && h.open_time && h.close_time
                              ? `${h.open_time.slice(0, 5)} – ${h.close_time.slice(0, 5)}`
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleDeleteSpecialHours(h.date)}
                              disabled={deletingDate === h.date}
                              className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                              title="Delete"
                            >
                              {deletingDate === h.date
                                ? <div className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-gray-500 mb-4">No special hours configured.</p>
            )}

            {/* Add new entry form */}
            <form onSubmit={handleAddSpecialHours} className="flex flex-wrap gap-3 items-end">
              <Input label="Date" type="date" value={shDate} onChange={(e) => setShDate(e.target.value)} required />
              {!shClosed && (
                <>
                  <Input label="Open" type="time" value={shOpen} onChange={(e) => setShOpen(e.target.value)} />
                  <Input label="Close" type="time" value={shClose} onChange={(e) => setShClose(e.target.value)} />
                </>
              )}
              <div className="flex items-center gap-2 pb-1">
                <input
                  type="checkbox"
                  id={`closed-${shop.id}`}
                  checked={shClosed}
                  onChange={(e) => setShClosed(e.target.checked)}
                  className="accent-gold"
                />
                <label htmlFor={`closed-${shop.id}`} className="text-sm text-gray-300">Closed</label>
              </div>
              <Button type="submit" size="sm" loading={savingSpecial}>Save</Button>
            </form>

            {/* Booking Settings */}
            <div className="mt-6 pt-4 border-t border-dark-300">
              <h4 className="text-sm font-semibold mb-3">Booking Settings</h4>
              {(parseInt(slotIntervalDraft, 10) !== savedInterval || parseInt(bufferDraft, 10) !== savedBuffer) && (
                <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                  Changing these settings affects how appointment slots are generated for future bookings at this shop.
                </div>
              )}
              <div className="flex flex-wrap gap-4 items-end">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-400">Slot interval</label>
                  <select
                    value={slotIntervalDraft}
                    onChange={(e) => setSlotIntervalDraft(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg bg-dark-200 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold"
                  >
                    <option value="10">10 min</option>
                    <option value="15">15 min</option>
                    <option value="20">20 min</option>
                    <option value="30">30 min</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-400">Buffer between bookings</label>
                  <select
                    value={bufferDraft}
                    onChange={(e) => setBufferDraft(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg bg-dark-200 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold"
                  >
                    <option value="0">0 min</option>
                    <option value="5">5 min</option>
                    <option value="10">10 min</option>
                    <option value="15">15 min</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 pb-0.5">
                  <span className="text-xs text-gray-400">Preview (25 min service)</span>
                  <span className="text-sm font-medium text-gold">
                    {Math.ceil((25 + parseInt(bufferDraft, 10)) / parseInt(slotIntervalDraft, 10)) * parseInt(slotIntervalDraft, 10)} min blocked
                  </span>
                </div>
                <Button size="sm" loading={configSaving} onClick={handleSaveConfig} type="button">
                  Save Settings
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Booking conflict resolution modal (closure + reduced hours) */}
      {conflict && (
        <BookingResolutionModal
          title={
            conflict.isClosed
              ? `Resolve Bookings Before Closing Shop on ${conflict.date}`
              : `Resolve Bookings Outside New Hours on ${conflict.date}`
          }
          description={
            conflict.isClosed
              ? `${conflict.affectedBookings.length} booking(s) exist on this date. Resolve each one before saving the closure.`
              : `${conflict.affectedBookings.length} booking(s) fall outside the new hours (${conflict.openTime?.slice(0, 5) ?? '?'} – ${conflict.closeTime?.slice(0, 5) ?? '?'}). Resolve each one before saving.`
          }
          affectedBookings={conflict.affectedBookings}
          availableBySlot={conflict.availableBySlot}
          timezone={shop.timezone}
          isSubmitting={conflict.isSubmitting}
          onSubmit={handleConflictResolved}
          onCancel={() => setConflict(null)}
        />
      )}
    </>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export default function AdminShopsPage() {
  const supabase = createClient();
  const [shops, setShops]       = useState<Shop[]>([]);
  const [form, setForm]         = useState<ShopForm>(defaultForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [copiedId, setCopiedId]       = useState<string | null>(null);
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  async function fetchShops() {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
    const { data } = await supabase
      .from('shops').select('*').eq('owner_id', user.id).is('deleted_at', null).order('created_at');
    setShops(data ?? []);
    setLoading(false);
  }

  useEffect(() => { fetchShops(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
    const slug = slugify(form.name);
    const { error: err } = await supabase.from('shops').insert({
      owner_id: user.id,
      name: form.name,
      slug,
      address: form.address || null,
      timezone: form.timezone,
      default_open_time: form.default_open_time,
      default_close_time: form.default_close_time,
    });
    if (err) {
      setError(err.message.includes('unique') ? 'A shop with that name already exists.' : err.message);
    } else {
      setForm(defaultForm);
      setShowForm(false);
      await fetchShops();
    }
    setSaving(false);
  }

  async function handleDelete(shopId: string, shopName: string) {
    setDeleteError('');
    setDeletingId(shopId);
    try {
      const checkRes  = await fetch(`/api/admin/shops/${shopId}/deletion-check`);
      const checkData = await checkRes.json();
      if (!checkRes.ok) { setDeleteError(checkData.error ?? 'Failed to check shop status.'); return; }
      if (checkData.futureBookings > 0) {
        const n = checkData.futureBookings;
        setDeleteError(`Cannot archive "${shopName}" — ${n} upcoming booking${n !== 1 ? 's' : ''} must be resolved first.`);
        return;
      }
      const parts: string[] = [];
      if (checkData.employees > 0) parts.push(`${checkData.employees} employee${checkData.employees !== 1 ? 's' : ''}`);
      if (checkData.services  > 0) parts.push(`${checkData.services} service${checkData.services !== 1 ? 's' : ''}`);
      const detail = parts.length > 0 ? ` This will also archive ${parts.join(' and ')}.` : '';
      if (!confirm(`Archive "${shopName}"?${detail} The shop will no longer be visible to customers.`)) return;
      const delRes = await fetch(`/api/admin/shops/${shopId}`, { method: 'PATCH' });
      if (!delRes.ok) { const d = await delRes.json(); setDeleteError(d.error ?? 'Failed to archive shop.'); return; }
      setShops((prev) => prev.filter((s) => s.id !== shopId));
    } finally {
      setDeletingId(null);
    }
  }

  function copyLink(slug: string, id: string) {
    navigator.clipboard.writeText(`${window.location.origin}/shop/${slug}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // getDayName is imported but only used inside ShopCard via the utils import at the top;
  // keep the import to avoid TS unused-import errors if it's referenced elsewhere.
  void getDayName;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Shops</h1>
          <p className="text-gray-400 text-sm">Manage your barbershop locations</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          <Plus className="w-4 h-4" />
          Add Shop
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="mb-6 border-gold/20">
          <h3 className="font-semibold mb-4">New Shop</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Shop name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Fades by Carlos" required />
              <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main St, City" />
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-300">Timezone</label>
                <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="w-full px-4 py-2.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold">
                  {TIMEZONES.map((tz) => <option key={tz} value={tz} className="bg-dark-200">{tz}</option>)}
                </select>
              </div>
              <Input label="Default open time" type="time" value={form.default_open_time} onChange={(e) => setForm({ ...form, default_open_time: e.target.value })} />
              <Input label="Default close time" type="time" value={form.default_close_time} onChange={(e) => setForm({ ...form, default_close_time: e.target.value })} />
            </div>
            {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
            <div className="flex gap-3">
              <Button type="submit" loading={saving} size="sm">Create Shop</Button>
              <Button variant="secondary" size="sm" onClick={() => setShowForm(false)} type="button">Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {deleteError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">{deleteError}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          Loading shops…
        </div>
      ) : shops.length === 0 ? (
        <div className="text-center py-16 bg-dark-100 border border-dark-300 rounded-2xl">
          <Store className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No shops yet. Create your first shop above.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {shops.map((shop) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              isExpanded={expandedId === shop.id}
              isCopied={copiedId === shop.id}
              isDeleting={deletingId === shop.id}
              onToggleExpand={() => setExpandedId(expandedId === shop.id ? null : shop.id)}
              onCopyLink={() => copyLink(shop.slug, shop.id)}
              onDelete={() => handleDelete(shop.id, shop.name)}
              onUpdated={(updated) => setShops((prev) => prev.map((s) => s.id === updated.id ? updated : s))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
