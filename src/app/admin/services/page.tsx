'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Tag, Plus, Pencil, Trash2, X, Clock, AlertTriangle } from 'lucide-react';
import type { Service, Shop } from '@/types';
import { formatPrice } from '@/lib/format';

const EMPTY_FORM = {
  shopId: '',
  name: '',
  description: '',
  duration: '25',
  price: '',
  displayOrder: '0',
  isActive: true,
};

type FormState = typeof EMPTY_FORM;

function ServiceCard({
  svc,
  toggling,
  onToggle,
  onEdit,
  onDelete,
}: {
  svc: Service;
  toggling: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-dark-100 border border-dark-300 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{svc.name}</div>
          {svc.description && (
            <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{svc.description}</div>
          )}
        </div>
        <button
          onClick={onToggle}
          disabled={toggling}
          title={svc.is_active ? 'Deactivate' : 'Activate'}
          className={`flex-shrink-0 relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
            svc.is_active ? 'bg-gold' : 'bg-dark-400'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              svc.is_active ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {svc.duration_minutes} min
        </span>
        {svc.price != null ? (
          <span>{formatPrice(svc.price)}</span>
        ) : (
          <span className="text-gray-600">No price set</span>
        )}
        <span
          className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
            svc.is_active
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-dark-300 text-gray-500'
          }`}
        >
          {svc.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-dark-300">
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-dark-200 rounded-lg transition-colors"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <Trash2 className="w-3 h-3" /> Delete
        </button>
        <span className="ml-auto text-xs text-gray-600">Order: {svc.display_order}</span>
      </div>
    </div>
  );
}

export default function AdminServicesPage() {
  const supabase = createClient();

  const [shops, setShops]       = useState<Shop[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading]   = useState(true);

  const [showForm, setShowForm]       = useState(false);
  const [editService, setEditService] = useState<Service | null>(null);
  const [form, setForm]               = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError]     = useState('');
  const [saving, setSaving]           = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null);
  const [deleting, setDeleting]           = useState(false);
  const [deleteError, setDeleteError]     = useState('');

  const [toggling, setToggling] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const [shopsRes, servicesRes] = await Promise.all([
      supabase
        .from('shops')
        .select('id, owner_id, name, slug, address, timezone, default_open_time, default_close_time, created_at')
        .eq('owner_id', session.user.id)
        .is('deleted_at', null)
        .order('name'),
      fetch('/api/admin/services'),
    ]);

    const shopsData = shopsRes.data ?? [];
    const servicesData: Service[] = servicesRes.ok ? await servicesRes.json() : [];

    setShops(shopsData as Shop[]);
    setServices(servicesData);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function openAdd() {
    setForm({ ...EMPTY_FORM, shopId: shops[0]?.id ?? '' });
    setEditService(null);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(svc: Service) {
    setForm({
      shopId:       svc.shop_id,
      name:         svc.name,
      description:  svc.description ?? '',
      duration:     String(svc.duration_minutes),
      price:        svc.price != null ? String(svc.price) : '',
      displayOrder: String(svc.display_order),
      isActive:     svc.is_active,
    });
    setEditService(svc);
    setFormError('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditService(null);
    setFormError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const dur = parseInt(form.duration, 10);
    if (!form.name.trim())            { setFormError('Service name is required.'); return; }
    if (isNaN(dur) || dur < 5 || dur > 480) { setFormError('Duration must be between 5 and 480 minutes.'); return; }

    const payload = {
      shop_id:          form.shopId,
      name:             form.name.trim(),
      description:      form.description.trim() || null,
      duration_minutes: dur,
      price:            form.price !== '' ? parseFloat(form.price) : null,
      display_order:    parseInt(form.displayOrder, 10) || 0,
      is_active:        form.isActive,
    };

    setSaving(true);
    try {
      const res = editService
        ? await fetch(`/api/admin/services/${editService.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error ?? 'Failed to save service.');
        return;
      }

      const saved: Service = await res.json();
      if (editService) {
        setServices((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
      } else {
        setServices((prev) => [...prev, saved]);
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(svc: Service) {
    setToggling(svc.id);
    const res = await fetch(`/api/admin/services/${svc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !svc.is_active }),
    });
    if (res.ok) {
      const updated: Service = await res.json();
      setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    }
    setToggling(null);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    setDeleteError('');
    const res = await fetch(`/api/admin/services/${confirmDelete.id}`, { method: 'DELETE' });
    if (res.ok) {
      setServices((prev) => prev.filter((s) => s.id !== confirmDelete.id));
      setConfirmDelete(null);
    } else {
      const data = await res.json();
      setDeleteError(data.error ?? 'Failed to delete service.');
    }
    setDeleting(false);
  }

  const multiShop = shops.length > 1;

  const grouped = shops.map((shop) => ({
    shop,
    services: services
      .filter((s) => s.shop_id === shop.id)
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name)),
  }));

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">Services</h1>
          <p className="text-gray-400 text-sm">Manage the services customers can book at your shops.</p>
        </div>
        {!loading && shops.length > 0 && (
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Service
          </Button>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          Loading services…
        </div>
      ) : shops.length === 0 ? (
        <div className="text-center py-16 bg-dark-100 border border-dark-300 rounded-2xl">
          <Tag className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No shops found. Create a shop first.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ shop, services: shopServices }) => (
            <div key={shop.id}>
              {multiShop && (
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span className="w-1 h-4 bg-gold rounded-full inline-block" />
                  {shop.name}
                </h2>
              )}

              {shopServices.length === 0 ? (
                <div className="text-center py-10 bg-dark-100 border border-dark-300 rounded-xl text-gray-500 text-sm">
                  No services yet.{' '}
                  <button onClick={openAdd} className="text-gold hover:underline">
                    Add one
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {shopServices.map((svc) => (
                    <ServiceCard
                      key={svc.id}
                      svc={svc}
                      toggling={toggling === svc.id}
                      onToggle={() => handleToggle(svc)}
                      onEdit={() => openEdit(svc)}
                      onDelete={() => { setDeleteError(''); setConfirmDelete(svc); }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-dark-100 border border-dark-300 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-dark-300">
              <h2 className="font-semibold">{editService ? 'Edit Service' : 'Add Service'}</h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Shop selector — only when adding and admin has multiple shops */}
              {multiShop && !editService && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Shop</label>
                  <select
                    value={form.shopId}
                    onChange={(e) => setForm((f) => ({ ...f, shopId: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                  >
                    {shops.map((s) => (
                      <option key={s.id} value={s.id} className="bg-dark-200">{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <Input
                label="Service name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Haircut, Beard Trim"
                required
              />

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Description <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description shown to customers"
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-gold resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Duration (minutes)"
                  type="number"
                  value={form.duration}
                  onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                  min={5}
                  max={480}
                  required
                />
                <Input
                  label="Price (optional)"
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="Leave blank"
                  min={0}
                  step={0.01}
                />
              </div>

              <Input
                label="Display order"
                type="number"
                value={form.displayOrder}
                onChange={(e) => setForm((f) => ({ ...f, displayOrder: e.target.value }))}
                hint="Lower numbers appear first on the booking page"
                min={0}
              />

              {editService && (
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-gray-300">Active</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {form.isActive ? 'Visible to customers' : 'Hidden from customers'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      form.isActive ? 'bg-gold' : 'bg-dark-400'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        form.isActive ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>
              )}

              {formError && <p className="text-sm text-red-400">{formError}</p>}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="ghost" className="flex-1" onClick={closeForm}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving} className="flex-1">
                  {editService ? 'Save Changes' : 'Add Service'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-dark-100 border border-dark-300 rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">Delete &quot;{confirmDelete.name}&quot;?</h3>
                <p className="text-sm text-gray-400">
                  Deleting this service will not affect existing bookings — they keep their recorded
                  service name and duration. Future bookings will no longer show this service. Continue?
                </p>
              </div>
            </div>
            {deleteError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-400">{deleteError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => { setConfirmDelete(null); setDeleteError(''); }}
              >
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" loading={deleting} onClick={handleDelete}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
